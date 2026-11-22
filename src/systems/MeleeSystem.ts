import Phaser from 'phaser';
import { DEPTH_FX } from '../config';
import type { DamageInfo } from '../combat/Damage';
import { STAMINA, getMelee, type MeleeDef } from '../data/weapons';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { CameraFeel } from '../feel/CameraFeel';
import { Fx } from '../fx/Fx';
import { GameEvents } from './GameEvents';

type Phase = 'idle' | 'windup' | 'active' | 'recovery';

export interface MeleeResult {
  hits: number;
  kills: number;
}

/** 收招後多久內再揮算連段 */
const COMBO_WINDOW = 0.45;
/** 判定中到收招這個比例之前先按，就排進下一刀（連打不吃鍵）；收招後段再按就直接接 */
const BUFFER_UNTIL = 1;

/**
 * 近戰：隨時可用（右鍵／V／E），不必切武器。
 *
 * 一刀分三段：起手（windup）→ 判定（active，這段碰到的霧屍才算中）→ 收招（recovery）。
 * 判定是 2.5D 地面上的扇形：以腳底為圓心、觸及距離為半徑、面向方向張開 arc 度，
 * y 方向放大計算（前後比左右「擠」），所以鈍器大角度能一次掃好幾隻。
 *
 * 平衡：
 * - 每刀耗體力，體力不夠照樣能揮但變慢、傷害減半（見 STAMINA）
 * - 打中硬直中的霧屍有處決加成（staggerBonus）：先用鋁棒打暈再用斧頭收
 * - 揮擊中不能開槍；揮擊會打斷換彈匣（白換），一顆顆塞的保留已塞的
 */
export class MeleeSystem {
  readonly def: MeleeDef;
  stamina: number = STAMINA.max;
  private regenWait = 0;
  private phase: Phase = 'idle';
  private t = 0;
  private speed = 1;
  private tired = false;
  private combo = 0;
  private comboTimer = 0;
  private queued = false;
  private hitSet = new Set<Zombie>();
  private hitCount = 0;
  private dir = 1;
  private facing = 1;

  constructor(
    private scene: Phaser.Scene,
    id: string,
  ) {
    this.def = getMelee(id) ?? getMelee('knife')!;
  }

  /** 揮擊姿勢給 WeaponRig 畫手上的武器：哪一段、這段進行到幾成、這刀往哪邊揮 */
  get pose(): { phase: 'windup' | 'active' | 'recovery'; k: number; dir: number } | null {
    if (this.phase === 'idle') return null;
    const d = this.def;
    const len = (this.phase === 'windup' ? d.windup : this.phase === 'active' ? d.active : d.recovery) * this.speed;
    return { phase: this.phase, k: Math.min(1, this.t / Math.max(0.001, len)), dir: this.dir };
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  get staminaRatio(): number {
    return this.stamina / STAMINA.max;
  }

  /** 按下近戰。回傳這次有沒有真的開始揮（或排進下一刀） */
  trySwing(player: Player): boolean {
    if (!player.alive) return false;
    if (this.phase === 'active' || (this.phase === 'recovery' && this.t < this.def.recovery * this.speed * BUFFER_UNTIL)) {
      this.queued = true;
      return true;
    }
    if (this.busy) return false;
    this.start(player);
    return true;
  }

  private start(player: Player): void {
    const d = this.def;
    this.tired = this.stamina < d.stamina;
    this.stamina = Math.max(0, this.stamina - d.stamina);
    this.regenWait = STAMINA.regenDelay;
    this.speed = this.tired ? STAMINA.tiredSpeed : 1;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.phase = 'windup';
    this.t = 0;
    this.hitSet.clear();
    this.hitCount = 0;
    this.dir = -this.dir;
    this.facing = player.facing;
    const bus = GameEvents.of(this.scene);
    if (this.tired) bus.emit('player:exhausted', { stamina: this.stamina });
    bus.emit('player:melee-swing', { weaponId: d.id, x: player.footX, y: player.footY, heavy: d.swing === 'heavy', tired: this.tired });
  }

  /** 是不是連段的加重那一下 */
  private get comboHit(): boolean {
    return this.def.comboEvery > 0 && this.combo % this.def.comboEvery === 0;
  }

  update(dt: number, player: Player, zombies: Zombie[]): MeleeResult {
    const d = this.def;
    const res: MeleeResult = { hits: 0, kills: 0 };
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.phase === 'idle') {
      this.regenWait = Math.max(0, this.regenWait - dt);
      if (this.regenWait <= 0) this.stamina = Math.min(STAMINA.max, this.stamina + STAMINA.regen * dt);
      player.swingLean += (0 - player.swingLean) * Math.min(1, dt * 14);
      return res;
    }

    this.t += dt;
    const heavy = d.swing === 'heavy';
    switch (this.phase) {
      case 'windup': {
        // 起手往後拉
        const k = Math.min(1, this.t / (d.windup * this.speed));
        player.swingLean = -(heavy ? 16 : 8) * k;
        if (k >= 1) {
          this.phase = 'active';
          this.t = 0;
          player.push(this.facing * d.lunge);
          this.drawTrail(player);
        }
        break;
      }
      case 'active': {
        player.swingLean = heavy ? 20 : 12;
        this.sweep(player, zombies, res);
        if (this.t >= d.active * this.speed) {
          this.phase = 'recovery';
          this.t = 0;
        }
        break;
      }
      case 'recovery': {
        const k = Math.min(1, this.t / (d.recovery * this.speed));
        player.swingLean = (heavy ? 20 : 12) * (1 - k);
        if (k >= 1) {
          this.phase = 'idle';
          this.comboTimer = COMBO_WINDOW;
          if (this.queued) {
            this.queued = false;
            this.start(player);
          }
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
    const cands: { z: Zombie; dist: number }[] = [];
    for (const z of zombies) {
      if (z.dead || this.hitSet.has(z)) continue;
      const s = z.def.scale ?? 1;
      const fwd = (z.footX - player.footX) * this.facing;
      const side = (z.footY - player.footY) * 2;
      const dist = Math.hypot(fwd, side);
      if (dist > d.reach + 10 * s || fwd < -6) continue;
      const ang = Math.atan2(Math.abs(side), Math.max(0.01, fwd));
      if (ang > halfArc && dist > 10) continue;
      cands.push({ z, dist });
    }
    cands.sort((a, b) => a.dist - b.dist);

    const fx = Fx.of(this.scene);
    const bus = GameEvents.of(this.scene);
    for (const { z } of cands) {
      if (this.hitCount >= d.maxTargets) break;
      this.hitSet.add(z);
      this.hitCount++;
      const execute = z.stunned && d.staggerBonus > 1;
      const mul = (this.tired ? STAMINA.tiredDamage : 1) * (this.comboHit ? d.comboMul : 1) * (execute ? d.staggerBonus : 1);
      const info: DamageInfo = {
        amount: d.damage * mul,
        type: d.damageType,
        penetration: d.penetration,
        knockback: d.knockback * (this.comboHit ? 1.5 : 1),
        stagger: d.stagger * (this.tired ? 0.5 : 1),
        headshot: false,
        dirX: this.facing,
        source: 'player',
        weaponId: d.id,
      };
      const hx = z.footX - 4 * this.facing;
      const hy = z.footY - 30 * (z.def.scale ?? 1);
      fx?.blood(hx, hy, this.facing, z.footY, d.damageType === 'slash' ? 7 : 4, d.damageType === 'slash' ? 1.1 : 0.8);
      const killed = z.takeHit(info);
      res.hits++;
      if (killed) res.kills++;
      bus.emit('enemy:hit', { enemyId: z.def.id, x: hx, y: hy, damage: info.amount, headshot: false, killed });
      bus.emit('player:melee-hit', { weaponId: d.id, x: hx, y: hy, type: d.damageType, killed, execute });
      if (execute) fx?.popText(hx, hy - 18, '處決', '#ff8a65');
    }
    if (res.hits > 0) {
      // 打中才卡肉、震鏡頭：重武器頓得更久，打越多隻越重
      fx?.freeze(d.hitStop + (res.hits - 1) * 10 + (res.kills > 0 ? 15 : 0));
      CameraFeel.of(this.scene)?.addTrauma(d.trauma * (1 + 0.2 * (res.hits - 1)));
    }
  }

  /** 揮擊軌跡：身體高度的一道弧，很快淡掉 */
  private drawTrail(player: Player): void {
    const d = this.def;
    const g = this.scene.add.graphics().setDepth(DEPTH_FX + 1);
    const cx = player.footX;
    const cy = player.footY - 28;
    const r = d.reach + 6;
    const half = Phaser.Math.DegToRad(Math.min(150, d.arc) / 2);
    const mid = this.facing > 0 ? 0 : Math.PI;
    // 刀刃左右來回，鈍器由上往下
    const a0 = mid - half * this.dir;
    const a1 = mid + half * this.dir;
    const steps = 10;
    for (let layer = 0; layer < 3; layer++) {
      g.lineStyle(3 - layer, d.trailColor, 0.9 - layer * 0.25);
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const a = Phaser.Math.Linear(a0, a1, i / steps);
        // 2.5D：弧壓扁成橢圓，貼合地面帶
        const px = cx + Math.cos(a) * (r - layer * 3);
        const py = cy + Math.sin(a) * (r - layer * 3) * 0.55;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();
    }
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 90 + d.active * 600, onComplete: () => g.destroy() });
  }
}
