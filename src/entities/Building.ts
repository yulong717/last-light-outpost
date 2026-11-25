import Phaser from 'phaser';
import { depthForY } from '../config';
import {
  BUILDINGS,
  LAMP,
  SPIKES,
  TURRET,
  buildingMaxHp,
  type BuildingKind,
  type SlotDef,
} from '../data/buildings';
import { Fx } from '../fx/Fx';
import { FX } from '../fx/FxTextures';
import type { Zombie } from './Zombie';

/**
 * 蓋在固定槽位上的一座建築。四種建築共用這個類別，行為依 kind 分支：
 * - sandbag 有耐久，被霧屍拆（阻擋判定在 Outpost.blockerFor）
 * - spikes 每刺一下掉耐久，壞掉就不再生效
 * - lamp 光圈內的霧屍減速（Outpost.speedMul）
 * - turret 自動射擊前方最近的霧屍
 */
export class Building {
  readonly kind: BuildingKind;
  readonly slot: SlotDef;
  level: number;
  hp: number;
  private sprite: Phaser.GameObjects.Image;
  private glow?: Phaser.GameObjects.Image;
  private timer = 0;
  private flickerEvent?: Phaser.Time.TimerEvent;

  constructor(private scene: Phaser.Scene, slot: SlotDef, kind: BuildingKind, level = 1, hp?: number) {
    this.slot = slot;
    this.kind = kind;
    this.level = level;
    this.hp = hp ?? buildingMaxHp(kind, level);
    // 陷阱貼在地上，畫在同一排霧屍的腳底下
    const depth = kind === 'spikes' ? depthForY(slot.y) - 1.5 : depthForY(slot.y);
    this.sprite = scene.add.image(slot.x, slot.y + (kind === 'spikes' ? 4 : 0), BUILDINGS[kind].texture, 0)
      .setOrigin(0.5, 1)
      .setDepth(depth)
      .setFlipX(this.dir < 0);
    if (kind === 'lamp') {
      this.glow = scene.add
        .image(slot.x, slot.y - 6, FX.glow)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(9);
      this.flicker();
    }
    this.refreshLook();
    // 蓋好時從地上「彈」出來
    this.sprite.setScale(1, 0.2);
    scene.tweens.add({ targets: this.sprite, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
  }

  get maxHp(): number {
    return buildingMaxHp(this.kind, this.level);
  }

  /** 照明燈和砲塔不會被打壞；沙包和陷阱耐久歸零就失效 */
  get working(): boolean {
    return this.hp > 0;
  }

  get canBreak(): boolean {
    return this.kind === 'sandbag' || this.kind === 'spikes';
  }

  /** 霧屍從哪一側來：1 = 右邊（預設），-1 = 左邊（雙面據點的左側槽位） */
  get dir(): 1 | -1 {
    return this.slot.dir ?? 1;
  }

  /** 沙包牆擋住霧屍的那條線 */
  get frontX(): number {
    return this.slot.x + 16 * this.dir;
  }

  get lampRadius(): number {
    return LAMP.radius[this.level - 1];
  }

  get turretRange(): number {
    return TURRET.range[this.level - 1];
  }

  setLevel(level: number): void {
    this.level = level;
    this.hp = this.maxHp;
    this.refreshLook();
    this.scene.tweens.add({ targets: this.sprite, scaleX: 1.2, scaleY: 1.2, duration: 80, yoyo: true });
  }

  repair(): void {
    this.hp = this.maxHp;
    this.refreshLook();
    Fx.of(this.scene)?.dust(this.slot.x, this.slot.y, 6);
  }

  setHighlight(on: boolean): void {
    if (on) this.sprite.setTint(0xfff3b0);
    else this.sprite.clearTint();
  }

  /** 被霧屍攻擊（只有沙包牆會被打） */
  takeDamage(amount: number, hitY: number): void {
    if (!this.working) return;
    this.hp = Math.max(0, this.hp - amount);
    const fx = Fx.of(this.scene);
    fx?.dust(this.frontX, hitY - 6, 3);
    this.scene.tweens.add({ targets: this.sprite, x: this.slot.x - this.dir, duration: 40, yoyo: true });
    this.refreshLook();
    if (!this.working) fx?.dust(this.slot.x, this.slot.y - 6, 10);
  }

  /**
   * 每幀更新（只在夜晚）。回傳這一幀由這座建築擊殺的數量。
   */
  update(dt: number, zombies: Zombie[]): number {
    if (!this.working) return 0;
    if (this.kind === 'spikes') return this.updateSpikes(dt, zombies);
    if (this.kind === 'turret') return this.updateTurret(dt, zombies);
    return 0;
  }

  /** 霧屍的腳是否踩在陷阱上 */
  covers(x: number, y: number): boolean {
    return Math.abs(x - this.slot.x) <= SPIKES.halfW && Math.abs(y - this.slot.y) <= SPIKES.halfH;
  }

  /** 霧屍是否在照明燈的光圈內（地面距離，y 方向加權） */
  lit(x: number, y: number): boolean {
    return Math.hypot(x - this.slot.x, (y - this.slot.y) * 1.6) <= this.lampRadius;
  }

  private updateSpikes(dt: number, zombies: Zombie[]): number {
    this.timer += dt;
    if (this.timer < SPIKES.interval) return 0;
    this.timer = 0;
    let kills = 0;
    let stabbed = false;
    for (const z of zombies) {
      // 飛在空中的（屍鴉）踩不到尖刺
      if (z.dead || z.alt > 8 || !this.covers(z.footX, z.footY)) continue;
      stabbed = true;
      if (z.takeDamage(SPIKES.damage[this.level - 1], 0, { dirX: -1 })) kills++;
      Fx.of(this.scene)?.blood(z.footX, z.footY - 4, -this.dir, z.footY, 2, 0.5);
    }
    if (stabbed) {
      this.hp = Math.max(0, this.hp - SPIKES.wear);
      this.refreshLook();
    }
    return kills;
  }

  private updateTurret(dt: number, zombies: Zombie[]): number {
    this.timer += dt;
    const interval = TURRET.interval[this.level - 1];
    if (this.timer < interval) return 0;
    // 找前方射程內最近的霧屍
    let target: Zombie | null = null;
    let best = Infinity;
    for (const z of zombies) {
      if (z.dead) continue;
      const dx = (z.footX - this.slot.x) * this.dir;
      if (dx < 0 || dx > this.turretRange) continue;
      const d = Math.hypot(dx, (z.footY - this.slot.y) * 1.6);
      if (d < best) {
        best = d;
        target = z;
      }
    }
    if (!target) return 0;
    this.timer = 0;
    const s = target.def.scale ?? 1;
    const mx = this.slot.x + 15 * this.dir;
    const my = this.slot.y - 15;
    const tx = target.footX;
    const ty = target.footY - 30 * s;
    const fx = Fx.of(this.scene);
    fx?.bulletTracer(mx, my, tx, ty);
    fx?.bulletHit(tx, ty, 1, target.footY, false);
    // 槍口火光 + 機身往後頓
    const flash = this.scene.add.circle(mx + this.dir, my, 3, 0xfff3a0).setDepth(this.sprite.depth + 0.1);
    this.scene.tweens.add({ targets: flash, scale: 0.2, alpha: 0, duration: 60, onComplete: () => flash.destroy() });
    this.scene.tweens.add({ targets: this.sprite, x: this.slot.x - 2 * this.dir, duration: 40, yoyo: true });
    return target.takeDamage(TURRET.damage[this.level - 1], 2, { dirX: this.dir }) ? 1 : 0;
  }

  private refreshLook(): void {
    const ratio = this.hp / this.maxHp;
    if (this.canBreak) {
      this.sprite.setFrame(ratio < 0.5 ? 1 : 0);
      this.sprite.setAlpha(this.working ? 1 : 0.35);
    }
    if (this.glow) this.glow.setScale(this.lampRadius / 40, this.lampRadius / 64);
  }

  private flicker(): void {
    const glow = this.glow;
    if (!glow) return;
    const off = Math.random() < 0.05;
    glow.setAlpha(off ? 0.3 : Phaser.Math.FloatBetween(0.75, 0.95));
    this.flickerEvent = this.scene.time.delayedCall(off ? 60 : Phaser.Math.Between(90, 300), () => this.flicker());
  }

  destroy(): void {
    this.flickerEvent?.remove();
    Fx.of(this.scene)?.dust(this.slot.x, this.slot.y - 4, 8);
    this.sprite.destroy();
    this.glow?.destroy();
  }
}
