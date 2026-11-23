import Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import type { DamageInfo } from '../combat/Damage';
import { STAMINA, getMelee, type MeleeDef } from '../data/weapons';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { CameraFeel } from '../feel/CameraFeel';
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
/** 刀類連段中後面幾刀的起手縮短（越砍越順手） */
const CHAIN_WINDUP = 0.6;

/** 近戰模式下的移動倍率：沒有槍的重量，比拿手槍還輕快 */
const STANCE_MOVE = 1.1;
/** 近戰模式的體力回復：等待時間縮短、回得較快 */
const STANCE_REGEN = { delayMul: 2, rateMul: 1.35, swingMul: 0.5 };
/** 揮擊中的移動倍率：刀可以邊砍邊走，鈍器掄下去幾乎站定 */
const SWING_MOVE = { light: 0.8, heavy: 0.35 };

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
  private hitSet = new Set<Zombie>();
  private hitCount = 0;
  private dir = 1;
  private facing = 1;
  /** 連擊數：連續打中的次數，畫面上顯示 */
  private streak = 0;
  private streakT = 0;
  private streakText?: Phaser.GameObjects.Text;
  /** 主角技能給的近戰加成（阿凱奔跑中），由 HeroSystem 每幀設定 */
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
  get pose(): { phase: 'ready' | 'windup' | 'active' | 'recovery'; k: number; dir: number; thrust: boolean } | null {
    if (this.phase === 'idle') return this.stance ? { phase: 'ready', k: 0, dir: this.dir, thrust: false } : null;
    const len = this.phaseLen(this.phase);
    return { phase: this.phase, k: Math.min(1, this.t / Math.max(0.001, len)), dir: this.dir, thrust: this.finisher };
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** 目前連段進度（給 HUD）：第幾下／一串幾下 */
  get chain(): { idx: number; len: number; streak: number } {
    return { idx: this.comboTimer > 0 || this.busy ? this.chainIdx : 0, len: this.def.comboEvery, streak: this.streak };
  }

  /** 技能耗體力（奔跑、閃身、擊倒）：扣完之後一段時間不回復。不夠就回傳 false、不扣 */
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
  handleInput(inp: InputState): { swing: boolean; gunAllowed: boolean } {
    if (inp.toggleMelee) this.setStance(!this.stance);
    if (this.stance && !this.stanceLocked && (inp.nextWeapon || inp.selectWeapon >= 0)) {
      this.setStance(false);
      inp.nextWeapon = false;
    }
    const attack = this.stance && (inp.firePressed || inp.fireHeld);
    const swing = inp.meleePressed || inp.meleeHeld || attack;
    return { swing, gunAllowed: !this.stance && !this.busy };
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
  trySwing(player: Player, aimX?: number): boolean {
    if (!player.alive) return false;
    if (this.busy || this.heftT > 0) {
      this.queued = true;
      return true;
    }
    this.start(player, aimX);
    return true;
  }

  private phaseLen(phase: 'windup' | 'active' | 'recovery'): number {
    const d = this.def;
    if (phase === 'windup') return d.windup * this.speed * (this.chainIdx > 1 && !this.finisher ? CHAIN_WINDUP : 1);
    if (phase === 'active') return d.active * this.speed;
    // 收尾那一下收招比較久，讓連段有節奏
    return d.recovery * this.speed * (this.finisher ? 1.4 : 1);
  }

  private start(player: Player, aimX?: number): void {
    const d = this.def;
    // 刀類：在連段時間內接著揮就是下一刀；一串打完重新開始
    const continuing = this.comboTimer > 0 && d.comboEvery > 1 && this.chainIdx < d.comboEvery;
    this.chainIdx = continuing ? this.chainIdx + 1 : 1;
    const cost = d.stamina * (this.chainIdx > 1 ? 0.8 : 1);
    this.tired = this.stamina < cost;
    this.stamina = Math.max(0, this.stamina - cost);
    this.regenWait = STAMINA.regenDelay;
    this.speed = this.tired ? STAMINA.tiredSpeed : 1;
    this.swingBonus = { ...this.bonus };
    this.comboTimer = 0;
    this.queued = false;
    this.phase = 'windup';
    this.t = 0;
    this.hitSet.clear();
    this.hitCount = 0;
    this.dir = -this.dir;
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
    this.updateStreak(dt, player);
    if (this.phase === 'idle') {
      // 近戰模式：專心用刀的人換氣比較快（純近戰主角也要撐得完一整夜）
      this.regenWait = Math.max(0, this.regenWait - dt * (this.stance ? STANCE_REGEN.delayMul : 1));
      if (this.regenWait <= 0) this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * (this.stance ? STANCE_REGEN.rateMul : 1) * dt);
      player.swingLean += (0 - player.swingLean) * Math.min(1, dt * 14);
      if (this.heftT > 0) {
        this.heftT = Math.max(0, this.heftT - dt);
        if (this.heftT <= 0 && this.queued) this.start(player);
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
          player.push(this.facing * d.lunge * (this.finisher ? 2.2 : 1));
          this.drawTrail(player);
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
        if (canChain) {
          this.comboTimer = COMBO_WINDOW;
          this.start(player);
          break;
        }
        if (k >= 1) {
          this.phase = 'idle';
          // 收尾重擊後一串結束；鈍器要重新掄起才能再揮
          this.comboTimer = this.finisher ? 0 : COMBO_WINDOW;
          this.heftT = this.finisher ? Math.max(d.heft, 0.08) : d.heft;
          if (this.queued && this.heftT <= 0) this.start(player);
        }
        break;
      }
    }
    return res;
  }

  /** 判定期間每幀掃一次扇形，同一刀同一隻只打一次 */
  private sweep(player: Player, zombies: Zombie[], res: MeleeResult): void {
    const d = this.def;
    if (this.hitCount >= d.maxTargets) return;
    const halfArc = Phaser.Math.DegToRad(d.arc / 2);
    const reachMul = this.finisher ? 1.25 : 1;
    const cands: { z: Zombie; dist: number }[] = [];
    for (const z of zombies) {
      if (z.dead || this.hitSet.has(z)) continue;
      const s = z.def.scale ?? 1;
      const fwd = (z.footX - player.footX) * this.facing;
      const side = (z.footY - player.footY) * 2;
      const dist = Math.hypot(fwd, side);
      if (dist > d.reach * reachMul + 10 * s || fwd < -6) continue;
      const ang = Math.atan2(Math.abs(side), Math.max(0.01, fwd));
      if (ang > halfArc && dist > 10) continue;
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
    for (const { z } of cands) {
      if (this.hitCount >= d.maxTargets) break;
      this.hitSet.add(z);
      this.hitCount++;
      const execute = z.stunned && d.staggerBonus > 1;
      const b = this.swingBonus;
      const mul = (this.tired ? STAMINA.tiredDamage : 1) * (fin ? d.comboMul : 1) * (execute ? d.staggerBonus : 1) * b.damageMul;
      const info: DamageInfo = {
        amount: d.damage * mul,
        type: d.damageType,
        penetration: d.penetration,
        knockback: (fin ? d.finisherKnock : d.knockback) + b.knockback,
        stagger: Math.max(d.stagger * (this.tired ? 0.5 : 1) * (fin ? 2 : 1), b.stagger),
        headshot: false,
        dirX: this.facing,
        source: 'player',
        weaponId: d.id,
      };
      const hx = z.footX - 4 * this.facing;
      const hy = z.footY - 30 * (z.def.scale ?? 1);
      fx?.blood(hx, hy, this.facing, z.footY, blunt ? 4 : fin ? 10 : 6, blunt ? 0.8 : fin ? 1.4 : 1.1);
      fx?.meleeImpact(hx, hy, this.facing, blunt ? 'blunt' : heavy || fin ? 'heavy-slash' : 'slash', z.footY);
      const killed = z.takeHit(info);
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
      const extra = (hitsNow - 1) * 10 + (killsNow > 0 ? 15 : 0) + (fin ? 45 : 0) + (execNow ? 25 : 0);
      fx?.freeze(d.hitStop + extra);
      const cam = CameraFeel.of(this.scene);
      cam?.addTrauma(d.trauma * (1 + 0.2 * (hitsNow - 1)) * (fin ? 1.8 : 1));
      // 鏡頭往打擊方向推一下：鈍器推得多
      cam?.kick(this.facing > 0 ? Math.PI : 0, heavy ? 4 + hitsNow : fin ? 3 : 1);
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
    t.setText(`${this.streak} 連擊`).setColor(color).setVisible(true).setAlpha(1).setPosition(player.footX, player.footY - 72);
    this.scene.tweens.killTweensOf(t);
    t.setScale(big ? 1.6 : 1.3);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
  }

  /** 揮擊軌跡：身體高度的一道弧，很快淡掉；收尾突刺是一道直線 */
  private drawTrail(player: Player): void {
    const d = this.def;
    const g = this.scene.add.graphics().setDepth(DEPTH_FX + 1);
    const cx = player.footX;
    const cy = player.footY - 28;
    const heavy = d.swing === 'heavy';
    if (this.finisher) {
      const len = d.reach * 1.25 + 10;
      for (let layer = 0; layer < 3; layer++) {
        g.lineStyle(4 - layer, layer === 0 ? 0xffffff : d.trailColor, 0.95 - layer * 0.25);
        g.lineBetween(cx + this.facing * 4, cy - 1 + layer, cx + this.facing * (len - layer * 4), cy + layer);
      }
      g.fillStyle(0xffffff, 0.9).fillTriangle(
        cx + this.facing * (len + 6),
        cy,
        cx + this.facing * (len - 4),
        cy - 4,
        cx + this.facing * (len - 4),
        cy + 4,
      );
      this.scene.tweens.add({ targets: g, alpha: 0, scaleX: 1.05, duration: 160, onComplete: () => g.destroy() });
      return;
    }
    const r = d.reach + 6;
    const half = Phaser.Math.DegToRad(Math.min(150, d.arc) / 2);
    const mid = this.facing > 0 ? 0 : Math.PI;
    // 刀刃左右來回，鈍器由上往下
    const a0 = mid - half * this.dir;
    const a1 = mid + half * this.dir;
    const steps = 12;
    const layers = heavy ? 4 : 3;
    for (let layer = 0; layer < layers; layer++) {
      g.lineStyle((heavy ? 5 : 3) - layer, layer === 0 ? 0xffffff : d.trailColor, 0.9 - layer * 0.2);
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = Phaser.Math.Linear(a0, a1, i / steps);
        // 2.5D：弧壓扁成橢圓，貼合地面帶；弧尾細、弧頭粗
        const rr = r - layer * 3 - (1 - i / steps) * 4;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.55;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 90 + d.active * 700, onComplete: () => g.destroy() });
  }
}
