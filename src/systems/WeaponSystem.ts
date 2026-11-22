import Phaser from 'phaser';
import { HEADSHOT_MULTIPLIER, type WeaponDef } from '../data/weapons';
import type { Zombie } from '../entities/Zombie';
import { DEPTH_FX, PLACEHOLDER_COLORS } from '../config';
import { Fx } from '../fx/Fx';
import { FEEL } from '../feel/FeelConfig';
import { GameEvents } from './GameEvents';

export interface WeaponRuntime {
  def: WeaponDef;
  ammo: number;
}

export interface ShotResult {
  /** 命中幾次（霰彈每顆彈丸各算一次） */
  hits: number;
  kills: number;
  headshots: number;
  /** 這一槍實際用的散射角（度） */
  spread: number;
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
  /** 連射累積的額外散射（度），每把槍各自計算 */
  private bloom = 0;

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
    this.bloom = 0;
    GameEvents.of(this.scene).emit('player:weapon-switch', { weaponId: this.active.def.id });
  }

  next(): void {
    this.select((this.current + 1) % this.weapons.length);
  }

  reload(): void {
    const w = this.active;
    if (this.reloading || w.ammo === w.def.magazine) return;
    this.reloadLeft = w.def.reloadTime;
    GameEvents.of(this.scene).emit('player:reload-start', { weaponId: w.def.id, duration: w.def.reloadTime });
  }

  /**
   * 目前的散射角（度）：基礎散射 + 連射累積 + 移動懲罰。
   * @param moveFactor 0 = 站定、1 = 全速移動
   */
  spreadNow(moveFactor: number): number {
    const d = this.active.def;
    return d.spread + this.bloom + d.moveSpread * FEEL.aim.movePenalty * Phaser.Math.Clamp(moveFactor, 0, 1);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - this.active.def.bloomRecover * dt);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        this.active.ammo = this.active.def.magazine;
        GameEvents.of(this.scene).emit('player:reload-end', { weaponId: this.active.def.id });
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
    moveFactor = 0,
  ): ShotResult | null {
    const w = this.active;
    const bus = GameEvents.of(this.scene);
    if (this.reloading && pressed) bus.emit('player:dryfire', { weaponId: w.def.id });
    if (this.reloading || this.cooldown > 0) return null;
    if (!(w.def.automatic ? held || pressed : pressed)) return null;
    if (w.ammo <= 0) {
      bus.emit('player:dryfire', { weaponId: w.def.id });
      this.reload();
      return null;
    }

    w.ammo -= 1;
    this.cooldown = 1 / w.def.fireRate;
    const base = Math.atan2(aimY - fromY, aimX - fromX);
    const spread = this.spreadNow(moveFactor);
    const result: ShotResult = { hits: 0, kills: 0, headshots: 0, spread };

    for (let i = 0; i < w.def.pellets; i++) {
      // 霰彈：彈丸平均分布在扇形裡再加一點亂數，不會全部擠在中間
      const t = w.def.pellets > 1 ? (i / (w.def.pellets - 1)) * 2 - 1 : 0;
      const jitter = w.def.pellets > 1 ? Phaser.Math.FloatBetween(-0.35, 0.35) : Phaser.Math.FloatBetween(-1, 1);
      const angle = base + Phaser.Math.DegToRad(Phaser.Math.Clamp(t + jitter, -1, 1) * spread);
      this.castRay(fromX, fromY, angle, w.def, zombies, result);
    }

    this.bloom = Math.min(w.def.bloomMax, this.bloom + w.def.bloomPerShot);
    bus.emit('player:shoot', {
      weaponId: w.def.id,
      x: fromX,
      y: fromY,
      angle: base,
      pellets: w.def.pellets,
      ammoLeft: w.ammo,
      magazine: w.def.magazine,
    });
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
      result.hits++;
      const dirX = Math.cos(angle);
      // 血落在這隻霧屍腳下（2.5D：每隻的地面 y 不同）
      const floorY = h.z.footY;
      const fx = Fx.of(this.scene);
      fx?.bulletHit(h.x, h.y, dirX, floorY, head);
      const killed = h.z.takeDamage(dmg, def.knockback, { headshot: head, dirX });
      if (killed) {
        result.kills++;
        // 爆頭擊殺卡肉久一點，一般擊殺輕輕頓一下
        fx?.freeze(head ? 55 : 25);
      }
      GameEvents.of(this.scene).emit('enemy:hit', { enemyId: h.z.def.id, x: h.x, y: h.y, damage: dmg, headshot: head, killed });
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
    const g = this.scene.add.graphics().setDepth(DEPTH_FX);
    g.lineStyle(1, PLACEHOLDER_COLORS.bullet, 0.9);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 70, onComplete: () => g.destroy() });
  }

  private spawnHitSpark(x: number, y: number, head: boolean): void {
    const size = head ? 4 : 2;
    const r = this.scene.add.rectangle(x, y, size, size, head ? 0xff5252 : 0xaa2222).setDepth(DEPTH_FX + 1);
    this.scene.tweens.add({
      targets: r,
      y: y + 6,
      alpha: 0,
      duration: 220,
      onComplete: () => r.destroy(),
    });
  }
}
