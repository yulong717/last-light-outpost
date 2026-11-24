import Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import type { DamageInfo } from '../combat/Damage';
import { STAMINA, getMelee, type MeleeDef, type MeleeStep } from '../data/weapons';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { rumble } from '../feel/Haptics';
import type { InputState } from '../input/InputManager';
import { Fx } from '../fx/Fx';
import { pixelText } from '../utils/text';
import { GameEvents } from './GameEvents';

type Phase = 'idle' | 'windup' | 'active' | 'recovery';

export interface MeleeResult {
  hits: number;
  kills: number;
}

/** 收招後多久內再揮，還算同一串連段 */
const COMBO_WINDOW = 0.45;
/** 連擊數（畫面上的「N 連擊」）多久沒打中就歸零 */
const STREAK_WINDOW = 1.4;
/** 揮擊中預先按下的下一刀，記多久（遊戲時間，卡肉時不算）；太早按的會作廢，不會很久之後自己多揮一下 */
const SWING_BUFFER = 0.3;
/** 揮擊中按換彈：記多久，收招後自動開始換 */
const RELOAD_BUFFER = 0.8;
/** 刀類連段中後面幾刀的起手縮短（越砍越順手） */
const CHAIN_WINDUP = 0.6;

/** 近戰模式下的移動倍率：沒有槍的重量，比拿手槍還輕快 */
const STANCE_MOVE = 1.1;
/** 近戰模式的體力回復：等待時間縮短、回得較快 */
const STANCE_REGEN = { delayMul: 2, rateMul: 1.35, swingMul: 0.5 };
/** 揮擊中的移動倍率：刀可以邊砍邊走，鈍器掄下去幾乎站定 */
const SWING_MOVE = { light: 0.8, heavy: 0.35 };
/** 收招長度倍率：打中變短，揮空變長；打中後收招進行到 cancel 就能直接接下一下 */
const HIT_RECOVERY = { hit: 0.75, whiff: 1.15, cancel: 0.5 };
/** 重擊打飛（收尾、處決）：起飛速度 px/s、水平距離 px、多停幾毫秒、鏡頭放大 */
const LAUNCH_HIT = { power: 230, dist: 48, extraStop: 20, zoom: 1.04, zoomMs: 100 };
/** 卡肉上限（毫秒） */
const HIT_STOP_MAX = 110;
/** 卡肉期間被打的那隻左右抖幾 px */
const VICTIM_SHAKE = { light: 1, mid: 3, heavy: 4 };

/**
 * 近戰：完整的一套打法，不只是應急。
 *
 * 兩種用法：
 * - 拿槍時隨時快速揮一下（右鍵／V／E／觸控「近戰」鍵），揮完回到槍
 * - 切到「近戰模式」（4／X 鍵，或觸控「持刀」鍵）：槍收起來，左鍵／點畫面就是揮，
 *   按住就一直連下去；移動比拿槍輕快
 *
 * 一刀分三段：起手（windup）→ 判定（active，這段碰到的霧屍才算中）→ 收招（recovery）。
 * 判定是 2.5D 地面上的扇形：以腳底為圓心、觸及距離為半徑、面向方向張開 arc 度。
 *
 * 武器分兩派（數值見 src/data/weapons.ts）：
 * - 刀類（軍用刀、開山刀）：幾乎不擊退，但收招很早就能接下一刀（chainCancel），
 *   一串 3～4 刀、越砍越快，最後一下突刺收尾（加倍傷害、推開一點）
 * - 鈍器與斧頭（鋁棒、大鐵鎚、消防斧）：一下打飛整排、打暈，但每下都要收完整招、
 *   再重新掄起（heft），連續性弱；揮擊中幾乎站定
 *
 * 打擊感：卡肉（hit-stop）、鏡頭震動與推鏡、命中閃光／衝擊環、手機震動、
 * 連段越後面音調越高、收尾重擊有額外的悶響；畫面上顯示連擊數。
 *
 * 平衡：
 * - 每刀耗體力，體力不夠照樣能揮但變慢、傷害減半（見 STAMINA）
 * - 打中硬直中的霧屍有處決加成（staggerBonus）：先用鋁棒打暈再用斧頭收
 * - 揮擊中不能開槍；揮擊會打斷換彈匣（白換），一顆顆塞的保留已塞的
 */
export class MeleeSystem {
  readonly def: MeleeDef;
  stamina: number = STAMINA.max;
  /** 近戰模式：槍收起來，攻擊鍵改成揮擊 */
  stance = false;
  /** 鎖在近戰模式（禁止開槍的關卡） */
  private stanceLocked = false;
  private regenWait = 0;
  private phase: Phase = 'idle';
  private t = 0;
  private speed = 1;
  private tired = false;
  /** 這一串連段打到第幾下（1 起算） */
  private chainIdx = 0;
  private comboTimer = 0;
  /** 收完招後的重新掄起時間（鈍器） */
  private heftT = 0;
  private queued = false;
  /** 排隊那一刀往哪邊揮（按下時的瞄準點；undefined＝照目前面向） */
  private queuedAim?: number;
  private queueT = 0;
  private reloadBuf = 0;
  private hitSet = new Set<Zombie>();
  private hitCount = 0;
  private dir = 1;
  private facing = 1;
  /** 連擊數：連續打中的次數，畫面上顯示 */
  private streak = 0;
  private streakT = 0;
  private streakText?: Phaser.GameObjects.Text;
  /** 衝刺中（阿凱）：這時出手是衝刺攻擊，由 HeroSystem 每幀設定 */
  dashing = false;
  /** 這一下是衝刺攻擊 */
  private dashSwing = false;
  /** 主角技能給的近戰加成，由 HeroSystem 每幀設定 */
  bonus = { damageMul: 1, knockback: 0, stagger: 0 };
  /** 這一刀起手時的加成（揮到一半停止奔跑也算數） */
  private swingBonus = { damageMul: 1, knockback: 0, stagger: 0 };

  constructor(
    private scene: Phaser.Scene,
    id: string,
  ) {
    this.def = getMelee(id) ?? getMelee('knife')!;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.streakText?.destroy());
  }

  /** 刀類：可以快速連砍、幾乎不擊退 */
  get isBlade(): boolean {
    return this.def.comboEvery > 1;
  }

  /** 揮擊姿勢給 WeaponRig 畫手上的武器；近戰模式沒在揮時是「備戰」姿勢 */
  get pose(): { phase: 'ready' | 'windup' | 'active' | 'recovery'; k: number; dir: number; thrust: boolean; contact: boolean; step: number; weapon: string; dash: boolean } | null {
    const weapon = this.def.id;
    if (this.phase === 'idle') return this.stance ? { phase: 'ready', k: 0, dir: this.dir, thrust: false, contact: false, step: 0, weapon, dash: false } : null;
    const len = this.phaseLen(this.phase);
    // 打中之後判定段停在「打到」那一格，卡肉時看得到球棒壓在對方身上
    const contact = this.phase === 'active' && this.hitCount > 0;
    const st = this.step;
    const thrust = st ? !!st.thrust : this.finisher;
    return { phase: this.phase, k: Math.min(1, this.t / Math.max(0.001, len)), dir: this.dir, thrust, contact, step: this.dashSwing ? 1 : this.chainIdx, weapon, dash: this.dashSwing };
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** 目前連段進度（給 HUD）：第幾下／一串幾下 */
  get chain(): { idx: number; len: number; streak: number; names?: string[] } {
    return { idx: this.comboTimer > 0 || this.busy ? this.chainIdx : 0, len: this.def.comboEvery, streak: this.streak, names: this.def.steps?.map((s) => s.name) };
  }

  /** 技能耗體力（閃身、擊倒）：扣完之後一段時間不回復。不夠就回傳 false、不扣 */
  spend(n: number, allowPartial = false): boolean {
    if (this.stamina < n && !allowPartial) return false;
    this.stamina = Math.max(0, this.stamina - n);
    this.regenWait = STAMINA.regenDelay;
    return true;
  }

  get staminaRatio(): number {
    return this.stamina / STAMINA.max;
  }

  /** 切換近戰模式（播換武器聲）；鎖住時不能切回槍 */
  setStance(on: boolean): void {
    if (this.stanceLocked && !on) return;
    if (on === this.stance) return;
    this.stance = on;
    GameEvents.of(this.scene).emit('player:weapon-switch', { weaponId: this.def.id });
  }

  /** 禁止開槍的關卡：一直拿著近戰武器 */
  lockStance(): void {
    this.stance = true;
    this.stanceLocked = true;
  }

  /**
   * 把這一幀的輸入翻成近戰動作。場景在處理換槍之前呼叫：
   * - 近戰模式切換鍵 → 切換
   * - 近戰模式中按換槍／1～3 → 回到槍（換槍鍵這一幀被吃掉，不會順便換下一把）
   * 回傳這一幀要不要揮、能不能開槍
   */
  handleInput(inp: InputState): { swing: boolean; pressed: boolean; gunAllowed: boolean } {
    if (inp.toggleMelee) this.setStance(!this.stance);
    if (this.stance && !this.stanceLocked && (inp.nextWeapon || inp.selectWeapon >= 0)) {
      this.setStance(false);
      inp.nextWeapon = false;
    }
    const attack = this.stance && (inp.firePressed || inp.fireHeld);
    const swing = inp.meleePressed || inp.meleeHeld || attack;
    const pressed = inp.meleePressed || (this.stance && inp.firePressed);
    return { swing, pressed, gunAllowed: !this.stance && !this.busy };
  }

  /** 移動倍率：揮擊中變慢（鈍器幾乎站定），近戰模式比拿槍輕快 */
  moveMul(gunMul: number): number {
    if (this.busy) return SWING_MOVE[this.def.swing];
    return this.stance ? STANCE_MOVE : gunMul;
  }

  /** 揮擊中鎖住面向（不會揮到一半轉身）；回傳給 Player.update 的 aimX */
  aimX(player: Player, aimX: number): number {
    return this.busy ? player.footX + this.facing * 100 : aimX;
  }

  /** 按下（或按住）近戰。aimX：往哪邊揮（沒給就照目前面向） */
  trySwing(player: Player, aimX?: number, pressed = true): boolean {
    if (!player.alive) return false;
    if (this.busy || this.heftT > 0) {
      // 只有「按下」才排下一下；按著不放不會在揮的途中多排一下（點一下＝揮一下）
      if (pressed) {
        this.queued = true;
        this.queuedAim = aimX;
        this.queueT = SWING_BUFFER;
      }
      return true;
    }
    this.start(player, aimX);
    return true;
  }

  /**
   * 換彈要不要現在開始：揮擊中按的先記著，收招後再換（不吃鍵）。
   * 近戰模式不換彈（槍收著）。dt 用真實時間。
   */
  reloadNow(pressed: boolean, dt: number): boolean {
    if (pressed) this.reloadBuf = RELOAD_BUFFER;
    else this.reloadBuf = Math.max(0, this.reloadBuf - dt);
    if (this.stance) this.reloadBuf = 0;
    if (this.reloadBuf > 0 && !this.busy) {
      this.reloadBuf = 0;
      return true;
    }
    return false;
  }

  /** 排隊的那一刀出手（帶著按下時的方向） */
  private startQueued(player: Player): void {
    this.start(player, this.queuedAim);
  }

  /** 這一下是連段招式表裡的哪一招（沒有招式表就是 undefined） */
  private get step(): MeleeStep | undefined {
    if (this.dashSwing && this.def.dashStep) return this.def.dashStep;
    return this.def.steps?.[Math.max(0, this.chainIdx - 1)];
  }

  private phaseLen(phase: 'windup' | 'active' | 'recovery'): number {
    const d = this.def;
    const st = this.step;
    if (st) {
      // 招式表：每一招自己的節奏
      const hitMul = phase === 'recovery' ? (this.hitCount > 0 ? HIT_RECOVERY.hit : HIT_RECOVERY.whiff) : 1;
      return st[phase] * this.speed * hitMul;
    }
    if (phase === 'windup') return d.windup * this.speed * (this.chainIdx > 1 && !this.finisher ? CHAIN_WINDUP : 1);
    if (phase === 'active') return d.active * this.speed;
    // 收尾那一下收招比較久，讓連段有節奏；打中收招變短、揮空吃完整破綻
    return d.recovery * this.speed * (this.finisher ? 1.4 : 1) * (this.hitCount > 0 ? HIT_RECOVERY.hit : HIT_RECOVERY.whiff);
  }

  private start(player: Player, aimX?: number): void {
    const d = this.def;
    // 刀類：在連段時間內接著揮就是下一刀；一串打完重新開始
    const continuing = this.comboTimer > 0 && d.comboEvery > 1 && this.chainIdx < d.comboEvery;
    this.chainIdx = continuing ? this.chainIdx + 1 : 1;
    // 衝刺攻擊：獨立的一招，打完連段就結束（當成收尾）
    this.dashSwing = this.dashing && !!d.dashStep && !continuing;
    if (this.dashSwing) this.chainIdx = Math.max(1, d.comboEvery);
    const cost = d.stamina * (this.chainIdx > 1 ? 0.8 : 1);
    this.tired = this.stamina < cost;
    this.stamina = Math.max(0, this.stamina - cost);
    this.regenWait = STAMINA.regenDelay;
    this.speed = this.tired ? STAMINA.tiredSpeed : 1;
    this.swingBonus = { ...this.bonus };
    this.comboTimer = 0;
    this.queued = false;
    this.queuedAim = undefined;
    this.phase = 'windup';
    this.t = 0;
    this.hitSet.clear();
    this.hitCount = 0;
    // 連段第一下固定由上往下，之後左右來回（橫掃、回掃）
    this.dir = this.chainIdx === 1 || this.dashSwing ? 1 : -this.dir;
    // 連段中可以轉身：往按下的那一邊揮
    this.facing = aimX !== undefined ? (aimX >= player.footX ? 1 : -1) : player.facing;
    player.facing = this.facing;
    const bus = GameEvents.of(this.scene);
    if (this.tired) bus.emit('player:exhausted', { stamina: this.stamina });
    bus.emit('player:melee-swing', {
      weaponId: d.id,
      x: player.footX,
      y: player.footY,
      heavy: d.swing === 'heavy',
      tired: this.tired,
      combo: this.chainIdx,
      finisher: this.finisher,
    });
  }

  /** 這一刀是不是連段最後的收尾重擊 */
  private get finisher(): boolean {
    return this.def.comboEvery > 1 && this.chainIdx === this.def.comboEvery;
  }

  update(dt: number, player: Player, zombies: Zombie[]): MeleeResult {
    const d = this.def;
    const res: MeleeResult = { hits: 0, kills: 0 };
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.queued) {
      this.queueT -= dt;
      if (this.queueT <= 0) {
        this.queued = false;
        this.queuedAim = undefined;
      }
    }
    this.updateStreak(dt, player);
    if (this.phase === 'idle') {
      // 近戰模式：專心用刀的人換氣比較快（純近戰主角也要撐得完一整夜）
      this.regenWait = Math.max(0, this.regenWait - dt * (this.stance ? STANCE_REGEN.delayMul : 1));
      if (this.regenWait <= 0) this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * (this.stance ? STANCE_REGEN.rateMul : 1) * dt);
      player.swingLean += (0 - player.swingLean) * Math.min(1, dt * 14);
      if (this.heftT > 0) {
        this.heftT = Math.max(0, this.heftT - dt);
        if (this.heftT <= 0 && this.queued) this.startQueued(player);
      }
      return res;
    }

    this.t += dt;
    // 近戰模式邊打邊換氣：揮擊中也回一半（連續猛攻約 10 秒才會累垮）
    if (this.stance) this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * STANCE_REGEN.rateMul * STANCE_REGEN.swingMul * dt);
    const heavy = d.swing === 'heavy';
    switch (this.phase) {
      case 'windup': {
        // 起手往後拉
        const k = Math.min(1, this.t / this.phaseLen('windup'));
        player.swingLean = -(heavy ? 18 : this.finisher ? 4 : 8) * k;
        if (k >= 1) {
          this.phase = 'active';
          this.t = 0;
          player.push(this.facing * (this.step ? this.step.lunge : d.lunge * (this.finisher ? 2.2 : 1)));
          GameEvents.of(this.scene).emit('player:melee-active', { x: player.footX, y: player.footY, heavy: heavy || this.finisher });
          this.drawTrail(player);
          const sl = this.step?.slam;
          if (sl) this.slamFx(player.footX + this.facing * 16, player.footY, sl);
        }
        break;
      }
      case 'active': {
        player.swingLean = heavy ? 22 : this.finisher ? 16 : 12;
        this.sweep(player, zombies, res);
        if (this.t >= this.phaseLen('active')) {
          this.phase = 'recovery';
          this.t = 0;
        }
        break;
      }
      case 'recovery': {
        const k = Math.min(1, this.t / this.phaseLen('recovery'));
        player.swingLean = (heavy ? 22 : 12) * (1 - k);
        // 刀類：收招早早就能接下一刀（連打不吃鍵，也不用等收完）
        const canChain = this.queued && d.comboEvery > 1 && this.chainIdx < d.comboEvery && k >= d.chainCancel;
        // 打中確認取消：鈍器打中之後收招後半段就能再揮（不用重新掄起）
        const hitCancel = this.queued && d.comboEvery <= 1 && this.hitCount > 0 && !this.finisher && k >= HIT_RECOVERY.cancel;
        if (hitCancel) {
          this.startQueued(player);
          break;
        }
        if (canChain) {
          this.comboTimer = COMBO_WINDOW;
          this.startQueued(player);
          break;
        }
        if (k >= 1) {
          this.phase = 'idle';
          // 收尾重擊後一串結束；鈍器要重新掄起才能再揮
          this.comboTimer = this.finisher ? 0 : COMBO_WINDOW;
          this.heftT = this.finisher ? Math.max(d.heft, 0.08) : d.heft;
          if (this.queued && this.heftT <= 0) this.startQueued(player);
        }
        break;
      }
    }
    return res;
  }

  /** 判定期間每幀掃一次扇形，同一刀同一隻只打一次 */
  private sweep(player: Player, zombies: Zombie[], res: MeleeResult): void {
    const d = this.def;
    const st = this.step;
    const maxTargets = st?.maxTargets ?? d.maxTargets;
    if (this.hitCount >= maxTargets) return;
    const halfArc = Phaser.Math.DegToRad((st ? st.arc : d.arc) / 2);
    const reachMul = st ? st.reach / d.reach : this.finisher ? 1.25 : 1;
    // 砸地：以前方落點為圓心；迴旋：以自己為圓心、前後都算
    const slam = st?.slam ?? 0;
    const ox = player.footX + (slam ? this.facing * 16 : 0);
    const cands: { z: Zombie; dist: number }[] = [];
    for (const z of zombies) {
      if (z.dead || this.hitSet.has(z)) continue;
      const s = z.def.scale ?? 1;
      const fwd = (z.footX - ox) * this.facing;
      const side = (z.footY - player.footY) * 2;
      const dist = Math.hypot(fwd, side);
      if (slam) {
        if (dist > slam + 8 * s) continue;
      } else if (st?.spin) {
        if (dist > d.reach * reachMul + 10 * s) continue;
      } else {
        if (dist > d.reach * reachMul + 10 * s || fwd < -6) continue;
        const ang = Math.atan2(Math.abs(side), Math.max(0.01, fwd));
        if (ang > halfArc && dist > 10) continue;
      }
      cands.push({ z, dist });
    }
    cands.sort((a, b) => a.dist - b.dist);

    const fx = Fx.of(this.scene);
    const bus = GameEvents.of(this.scene);
    const blunt = d.damageType === 'blunt';
    const heavy = d.swing === 'heavy';
    const fin = this.finisher;
    let hitsNow = 0;
    let killsNow = 0;
    let execNow = false;
    let launchNow = false;
    const victims: { z: Zombie; tier: 'light' | 'mid' | 'heavy' }[] = [];
    for (const { z, dist } of cands) {
      if (this.hitCount >= maxTargets) break;
      // 迴旋、砸地：被打的往遠離自己（落點）的方向飛
      const away = st?.spin || slam ? Math.sign(z.footX - ox) || this.facing : this.facing;
      this.hitSet.add(z);
      this.hitCount++;
      const execute = z.stunned && d.staggerBonus > 1;
      const b = this.swingBonus;
      // 砸地：離落點越遠越輕（邊緣剩六成）
      const slamMul = slam ? 1 - 0.4 * Math.min(1, dist / slam) : 1;
      const stepMul = (st ? st.damageMul : fin ? d.comboMul : 1) * slamMul;
      const mul = (this.tired ? STAMINA.tiredDamage : 1) * stepMul * (execute ? d.staggerBonus : 1) * b.damageMul;
      // 受力分級：收尾或處決＝重（打飛），鈍器／重武器＝中（滑出去），其他＝輕
      // 有招式表的武器只有收尾那招會打飛（連段中途打飛就接不下去了）
      const tier = (st ? st.launch : fin || execute) ? 'heavy' : blunt || heavy ? 'mid' : 'light';
      const info: DamageInfo = {
        heavy: tier === 'heavy',
        amount: d.damage * mul,
        type: d.damageType,
        penetration: d.penetration,
        knockback: (st ? st.knockback : fin ? d.finisherKnock : d.knockback) + b.knockback,
        stagger: Math.max((st ? st.stagger : d.stagger * (fin ? 2 : 1)) * (this.tired ? 0.5 : 1), b.stagger),
        headshot: false,
        dirX: away,
        source: 'player',
        weaponId: d.id,
        gore: d.gore,
      };
      const hx = z.footX - 4 * away;
      const hy = z.footY - (slam ? 14 : 30) * (z.def.scale ?? 1);
      fx?.blood(hx, hy, away, z.footY, blunt ? 3 : fin ? 6 : 3, blunt ? 0.8 : fin ? 1.3 : 1);
      fx?.meleeImpact(hx, hy, away, blunt ? 'blunt' : heavy || fin ? 'heavy-slash' : 'slash', z.footY);
      const killed = z.takeHit(info);
      if (!killed) {
        if (tier === 'heavy' && (blunt || heavy)) {
          z.launch(away, LAUNCH_HIT.power * (slam ? 0.8 : 1), LAUNCH_HIT.dist * (slam ? 0.6 : 1));
          launchNow = true;
        }
        victims.push({ z, tier });
      }
      res.hits++;
      hitsNow++;
      if (killed) {
        res.kills++;
        killsNow++;
      }
      if (execute) execNow = true;
      bus.emit('enemy:hit', { enemyId: z.def.id, x: hx, y: hy, damage: info.amount, headshot: false, killed });
      bus.emit('player:melee-hit', { weaponId: d.id, x: hx, y: hy, type: d.damageType, killed, execute, combo: this.chainIdx, finisher: fin });
      if (execute) fx?.popText(hx, hy - 18, '處決', '#ff8a65');
      else if (b.damageMul > 1) fx?.popText(hx, hy - 18, '衝撞', '#80d8ff');
    }
    if (hitsNow > 0) {
      // 打中才卡肉、震鏡頭：重武器頓得更久，打越多隻越重；收尾重擊多頓一拍
      // 上限 110 ms：以前疊到 170 ms，手機上幀率一低，玩家感覺是「打下去卡住」而不是重量感
      const extra = (hitsNow - 1) * 6 + (killsNow > 0 ? 10 : 0) + (fin && !st ? 30 : 0) + (execNow ? 15 : 0) + (launchNow ? LAUNCH_HIT.extraStop : 0);
      const stop = Math.min(HIT_STOP_MAX, (st ? st.hitStop : d.hitStop) + extra);
      fx?.freeze(stop);
      // 卡肉時只有被打的那隻在抖，攻擊者定格
      for (const v of victims) v.z.hitShake(stop + 20, VICTIM_SHAKE[v.tier]);
      // 鏡頭不晃、不推、不放大（全畫面晃動刺眼又暈），力道全靠卡肉、被打的那隻抖和身體反應
      // 攻擊者也吃到反作用力：身體壓扁一下（卡肉時定格在壓扁的樣子）
      player.impact(heavy || fin ? 1 : 0.6);
      // 被打的腳下揚塵，看得出力道傳到地上
      for (const v of victims) if (v.tier !== 'light') fx?.dust(v.z.footX, v.z.footY, v.tier === 'heavy' ? 6 : 3);
      rumble(heavy ? 45 : fin ? 35 : 14, heavy ? 0.85 : fin ? 0.6 : 0.3);
      // 鈍器打在肉上會反震：人往後頓一點
      if (blunt) player.push(-this.facing * 30);
      this.streak += hitsNow;
      this.streakT = STREAK_WINDOW;
      this.showStreak(player, fin);
    }
  }

  /** 連擊數跟著主角頭頂；斷了就淡掉 */
  private updateStreak(dt: number, player: Player): void {
    if (this.streakT <= 0) return;
    this.streakT -= dt;
    const t = this.streakText;
    if (t) {
      t.setPosition(player.footX, player.footY - 72);
      if (this.streakT < 0.35) t.setAlpha(Math.max(0, this.streakT / 0.35));
    }
    if (this.streakT <= 0) {
      this.streak = 0;
      t?.setVisible(false);
    }
  }

  private showStreak(player: Player, big: boolean): void {
    if (this.streak < 2) return;
    if (!this.streakText) {
      this.streakText = pixelText(this.scene, 0, 0, '', 9, '#ffe082').setOrigin(0.5).setDepth(DEPTH_FX + 5).setStroke('#000000', 3);
    }
    const t = this.streakText;
    const color = this.streak >= 12 ? '#ff7043' : this.streak >= 6 ? '#ffca28' : '#ffe082';
    // setColor 和 setText 各會重畫一次文字貼圖：顏色沒變就不要設
    if (t.style.color !== color) t.setColor(color);
    t.setText(`${this.streak} 連擊`).setVisible(true).setAlpha(1).setPosition(player.footX, player.footY - 72);
    this.scene.tweens.killTweensOf(t);
    t.setScale(big ? 1.6 : 1.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
  }

  /** 砸地：落點一圈震波（扁橢圓往外擴、淡掉）＋ 一圈揚塵（只在地上，不晃鏡頭） */
  private slamFx(x: number, y: number, r: number): void {
    const sc = this.scene;
    const ring = sc.add.ellipse(x, y, 8, 3).setStrokeStyle(1, 0xd8cbb0, 0.35).setDepth(3);
    sc.tweens.add({ targets: ring, width: r * 2, height: r * 0.7, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    const fx = Fx.of(sc);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      fx?.dust(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.2, 2);
    }
    rumble(60, 0.9);
  }

  /**
   * 揮擊軌跡：只畫兩條很淡的細速度線（不畫白弧、不發光），只在揮到的那一端，一下就消失。
   * 左揮、右揮是壓扁的橫向弧（方向相反），下揮是直立的弧，刀類收尾突刺是幾條直線。
   */
  private drawTrail(player: Player): void {
    const d = this.def;
    const st = this.step;
    const g = this.scene.add.graphics().setDepth(DEPTH_FX + 1);
    const cx = player.footX;
    const cy = player.footY - 28;
    const f = this.facing;
    const color = d.trailColor;
    const arc = (a0: number, a1: number, r: number, sx: number, sy: number, oy = 0): void => {
      // 只畫弧的後 45%（揮到的那一端），兩條細線錯開半徑；顏色用武器本色、不用純白
      for (let line = 0; line < 2; line++) {
        const rr = r - line * 3;
        g.lineStyle(1, color, line === 0 ? 0.42 : 0.2);
        g.beginPath();
        const steps = 8;
        for (let i = 0; i <= steps; i++) {
          const a = Phaser.Math.Linear(a0, a1, 0.55 + 0.45 * (i / steps));
          const px = cx + f * Math.cos(a) * rr * sx;
          const py = cy + oy + Math.sin(a) * rr * sy;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.strokePath();
      }
    };
    const deg = Math.PI / 180;
    if (st?.slam) {
      // 砸地：從頭頂直直砸到落點（地上的震波另外畫）
      arc(-100 * deg, 60 * deg, (st.reach ?? d.reach) + 4, 0.7, 0.75, 4);
    } else if (st?.spin) {
      // 迴旋：繞身體一圈的細線（只畫一條、半透明，不要整圈白）
      g.lineStyle(1, color, 0.22);
      g.strokeEllipse(cx, cy + 10, (st.reach + 4) * 2, (st.reach + 4) * 0.7);
    } else if (st?.thrust) {
      // 刺擊：幾條往前的直線
      const len = st.reach + 8;
      for (let i = -1; i <= 1; i += 2) {
        g.lineStyle(1, color, 0.35);
        g.lineBetween(cx + f * 8, cy + 2 + i * 2, cx + f * (len - Math.abs(i) * 6), cy + 2 + i * 2);
      }
    } else if (st?.launch && !this.dashSwing) {
      // 下揮：從頭頂劈到前方地面
      arc(-110 * deg, 35 * deg, (st.reach ?? d.reach) + 6, 0.8, 0.7, 6);
    } else if (this.finisher && !st) {
      // 刀類收尾突刺：三條直線
      const len = d.reach * 1.25 + 8;
      for (let i = -1; i <= 1; i += 2) {
        g.lineStyle(1, color, 0.35);
        g.lineBetween(cx + f * 8, cy + i * 3, cx + f * (len - Math.abs(i) * 6), cy + i * 3);
      }
    } else {
      // 左揮／右揮：dir 決定由上往下或由下往上
      const r = (st ? st.reach : d.reach) + 4;
      const half = Math.min(150, st ? st.arc : d.arc) / 2;
      arc(-half * this.dir * deg, half * this.dir * deg, r, 1, 0.55);
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 80, onComplete: () => g.destroy() });
  }

}
