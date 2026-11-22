import Phaser from 'phaser';
import { HEADSHOT_MULTIPLIER, type WeaponDef } from '../data/weapons';
import type { Zombie } from '../entities/Zombie';
import { PLACEHOLDER_COLORS } from '../config';
import { Fx } from '../fx/Fx';

export interface WeaponRuntime {
  def: WeaponDef;
  ammo: number;
}

export interface ShotResult {
  kills: number;
  headshots: number;
}

/**
 * 即時命中（hitscan）射擊：從槍口沿瞄準方向畫一條射線，
 * 依距離由近到遠命中敵人，直到穿透次數用完。
 */
export class WeaponSystem {
  readonly weapons: WeaponRuntime[];
  current = 0;
  private cooldown = 0;
  private reloadLeft = 0;

  constructor(private scene: Phaser.Scene, defs: WeaponDef[]) {
    this.weapons = defs.map((def) => ({ def, ammo: def.magazine }));
  }

  get active(): WeaponRuntime {
    return this.weapons[this.current];
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadLeft / this.active.def.reloadTime : 1;
  }

  select(index: number): void {
    if (index < 0 || index >= this.weapons.length || index === this.current) return;
    this.current = index;
    this.reloadLeft = 0;
    this.cooldown = 0.15;
  }

  next(): void {
    this.select((this.current + 1) % this.weapons.length);
  }

  reload(): void {
    const w = this.active;
    if (this.reloading || w.ammo === w.def.magazine) return;
    this.reloadLeft = w.def.reloadTime;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        this.active.ammo = this.active.def.magazine;
      }
    }
  }

  /** 嘗試開火；沒開成功回傳 null。 */
  tryFire(
    fromX: number,
    fromY: number,
    aimX: number,
    aimY: number,
    held: boolean,
    pressed: boolean,
    zombies: Zombie[],
  ): ShotResult | null {
    const w = this.active;
    if (this.reloading || this.cooldown > 0) return null;
    if (!(w.def.automatic ? held : pressed)) return null;
    if (w.ammo <= 0) {
      this.reload();
      return null;
    }

    w.ammo -= 1;
    this.cooldown = 1 / w.def.fireRate;
    const base = Math.atan2(aimY - fromY, aimX - fromX);
    const result: ShotResult = { kills: 0, headshots: 0 };

    for (let i = 0; i < w.def.pellets; i++) {
      const angle = base + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-w.def.spread, w.def.spread));
      this.castRay(fromX, fromY, angle, w.def, zombies, result);
    }

    if (w.def.pellets > 1) this.scene.cameras.main.shake(60, 0.004);
    if (w.ammo === 0) this.reload();
    return result;
  }

  private castRay(
    fromX: number,
    fromY: number,
    angle: number,
    def: WeaponDef,
    zombies: Zombie[],
    result: ShotResult,
  ): void {
    const range = 600;
    const ray = new Phaser.Geom.Line(
      fromX,
      fromY,
      fromX + Math.cos(angle) * range,
      fromY + Math.sin(angle) * range,
    );

    const hits: { z: Zombie; x: number; y: number; dist: number }[] = [];
    for (const z of zombies) {
      if (z.dead) continue;
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, z.getHitRect());
      if (pts.length === 0) continue;
      const p = pts.reduce((a, b) =>
        Phaser.Math.Distance.Between(fromX, fromY, a.x, a.y) <= Phaser.Math.Distance.Between(fromX, fromY, b.x, b.y) ? a : b,
      );
      hits.push({ z, x: p.x, y: p.y, dist: Phaser.Math.Distance.Between(fromX, fromY, p.x, p.y) });
    }
    hits.sort((a, b) => a.dist - b.dist);

    let endX = ray.x2;
    let endY = ray.y2;
    for (const h of hits.slice(0, def.pierce)) {
      const head = h.z.isHeadshot(h.y);
      const dmg = def.damage * (head ? HEADSHOT_MULTIPLIER : 1);
      if (head) result.headshots++;
      const dirX = Math.cos(angle);
      const floorY = h.z.y;
      const fx = Fx.of(this.scene);
      fx?.bulletHit(h.x, h.y, dirX, floorY, head);
      if (h.z.takeDamage(dmg, def.knockback, { headshot: head, dirX })) {
        result.kills++;
        // 爆頭擊殺卡肉久一點，一般擊殺輕輕頓一下
        fx?.freeze(head ? 55 : 25);
      }
      if (!fx) this.spawnHitSpark(h.x, h.y, head);
      endX = h.x;
      endY = h.y;
    }
    this.drawTracer(fromX, fromY, endX, endY);
  }

  private drawTracer(x1: number, y1: number, x2: number, y2: number): void {
    const fx = Fx.of(this.scene);
    if (fx) {
      fx.bulletTracer(x1, y1, x2, y2);
      return;
    }
    const g = this.scene.add.graphics().setDepth(50);
    g.lineStyle(1, PLACEHOLDER_COLORS.bullet, 0.9);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 70, onComplete: () => g.destroy() });
  }

  private spawnHitSpark(x: number, y: number, head: boolean): void {
    const size = head ? 4 : 2;
    const r = this.scene.add.rectangle(x, y, size, size, head ? 0xff5252 : 0xaa2222).setDepth(51);
    this.scene.tweens.add({
      targets: r,
      y: y + 6,
      alpha: 0,
      duration: 220,
      onComplete: () => r.destroy(),
    });
  }
}
