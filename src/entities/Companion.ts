import Phaser from 'phaser';
import { DEPTH_FX, clampLaneY, depthForY } from '../config';
import type { CompanionRoleDef, CrewMember } from '../data/companions';
import { Fx } from '../fx/Fx';
import type { Zombie } from './Zombie';

/** 夥伴每幀需要知道的戰場資訊（由 CompanionSystem 組好傳進來） */
export interface CompanionIntent {
  /** 想走到的位置 */
  moveX: number;
  moveY: number;
  /** 可移動的左右範圍 */
  minX: number;
  maxX: number;
  /** 這一幀能不能開槍（工兵修理中就不行） */
  canShoot: boolean;
  zombies: Zombie[];
}

export interface CompanionShot {
  kills: number;
  headshots: number;
}

/**
 * NPC 夥伴：和主角共用同一張圖（染色當佔位），頭上有職業顏色標記。
 * 行為由 CompanionSystem 決定「要去哪、能不能開槍」，這裡只負責移動、自動瞄準射擊、受傷與陣亡。
 * 一樣用 footX / footY（腳底）做所有判定。
 */
export class Companion {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly member: CrewMember;
  readonly def: CompanionRoleDef;
  footX: number;
  footY: number;
  hp: number;
  facing = 1;
  ammo: number;
  /** 目前在做什麼，給 HUD 顯示 */
  status = '';
  private cooldown = 0;
  private reloadLeft = 0;
  private hurtCooldown = 0;
  private walkPhase = Math.random() * 6;
  private mark: Phaser.GameObjects.Rectangle;
  private hpBack: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  /** 反應時間：剛看到目標不會立刻開槍，比較像人 */
  private aimDelay = 0;
  private lastTarget: Zombie | null = null;

  constructor(private scene: Phaser.Scene, member: CrewMember, def: CompanionRoleDef, x: number, y: number) {
    this.member = member;
    this.def = def;
    this.footX = x;
    this.footY = clampLaneY(y);
    this.hp = def.maxHp;
    this.ammo = def.gun.magazine;
    this.sprite = scene.add.sprite(x, this.footY, 'player', 0).setTint(def.tint);
    this.sprite.setOrigin(0.5, scene.anims.exists('player_shoot') ? 63 / 64 : 1);
    this.sprite.setScale(0.94);
    // 頭上的職業標記與小血條
    this.mark = scene.add.rectangle(x, 0, 5, 5, def.markColor).setStrokeStyle(1, 0x000000);
    this.hpBack = scene.add.rectangle(x, 0, 16, 3, 0x000000, 0.7);
    this.hpBar = scene.add.rectangle(x, 0, 14, 1, 0x81c784).setOrigin(0, 0.5);
    Fx.of(scene)?.attachShadow(this.sprite, 20);
    this.sync();
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  private get gunX(): number {
    return this.footX + 9 * this.facing;
  }

  private get gunY(): number {
    return this.footY - 38;
  }

  update(dt: number, intent: CompanionIntent): CompanionShot | null {
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    if (!this.alive) return null;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        this.ammo = this.def.gun.magazine;
      }
    }

    // 移動：走向想去的位置，到了就停（小死區避免抖動）
    const dx = intent.moveX - this.footX;
    const dy = intent.moveY - this.footY;
    const dist = Math.hypot(dx, dy);
    let moving = false;
    if (dist > 3) {
      const step = Math.min(dist, this.def.speed * dt);
      this.footX += (dx / dist) * step;
      this.footY += (dy / dist) * step * 0.7;
      moving = true;
    }
    this.footX = Phaser.Math.Clamp(this.footX, intent.minX, intent.maxX);
    this.footY = clampLaneY(this.footY);
    if (moving) {
      this.walkPhase += dt * 14;
      this.facing = dx >= 0 ? 1 : -1;
    }

    // 自動瞄準：射程內最近的霧屍
    let shot: CompanionShot | null = null;
    const target = this.nearestZombie(intent.zombies);
    if (target) this.facing = target.footX >= this.footX ? 1 : -1;
    if (target !== this.lastTarget) {
      this.lastTarget = target;
      this.aimDelay = 0.25;
    }
    this.aimDelay = Math.max(0, this.aimDelay - dt);
    if (target && intent.canShoot && !this.reloading && this.cooldown <= 0 && this.aimDelay <= 0) {
      shot = this.fire(target, intent.zombies);
    }
    this.sync(moving);
    return shot;
  }

  private nearestZombie(zombies: Zombie[]): Zombie | null {
    let best: Zombie | null = null;
    let bestD = this.def.gun.range;
    for (const z of zombies) {
      if (z.dead) continue;
      const d = Math.hypot(z.footX - this.footX, (z.footY - this.footY) * 1.4);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** 和主角一樣的即時命中射擊（只打穿一隻），命中/擊殺特效沿用 Fx */
  private fire(target: Zombie, zombies: Zombie[]): CompanionShot {
    const g = this.def.gun;
    this.ammo -= 1;
    this.cooldown = 1 / g.fireRate;
    if (this.ammo <= 0) this.reloadLeft = g.reloadTime;

    const r = target.getHitRect();
    const aimHead = Math.random() < g.headChance;
    const aimY = aimHead ? r.y + r.height * 0.12 : r.y + r.height * Phaser.Math.FloatBetween(0.35, 0.7);
    const fromX = this.gunX + 5 * this.facing;
    const fromY = this.gunY;
    const angle =
      Math.atan2(aimY - fromY, target.footX - fromX) + Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-g.spread, g.spread));
    const ray = new Phaser.Geom.Line(fromX, fromY, fromX + Math.cos(angle) * g.range, fromY + Math.sin(angle) * g.range);

    let hit: { z: Zombie; x: number; y: number; d: number } | null = null;
    for (const z of zombies) {
      if (z.dead) continue;
      for (const p of Phaser.Geom.Intersects.GetLineToRectangle(ray, z.getHitRect())) {
        const d = Phaser.Math.Distance.Between(fromX, fromY, p.x, p.y);
        if (!hit || d < hit.d) hit = { z, x: p.x, y: p.y, d };
      }
    }

    const result: CompanionShot = { kills: 0, headshots: 0 };
    const fx = Fx.of(this.scene);
    const dirX = Math.cos(angle);
    if (hit) {
      const head = hit.z.isHeadshot(hit.y);
      if (head) result.headshots++;
      fx?.bulletHit(hit.x, hit.y, dirX, hit.z.footY, head);
      if (hit.z.takeDamage(g.damage * (head ? 2.5 : 1), g.knockback, { headshot: head, dirX })) result.kills++;
    }
    const endX = hit ? hit.x : ray.x2;
    const endY = hit ? hit.y : ray.y2;
    if (fx) {
      fx.bulletTracer(fromX, fromY, endX, endY);
      fx.muzzleSmoke(fromX, fromY, angle);
    }
    if (this.scene.anims.exists('player_shoot')) this.sprite.play('player_shoot');
    else {
      const flash = this.scene.add.circle(fromX, fromY, 3, 0xfff3a0).setDepth(DEPTH_FX + 2);
      this.scene.tweens.add({ targets: flash, scale: 0.2, alpha: 0, duration: 70, onComplete: () => flash.destroy() });
    }
    return result;
  }

  heal(amount: number): number {
    if (!this.alive || this.hp >= this.def.maxHp) return 0;
    const before = this.hp;
    this.hp = Math.min(this.def.maxHp, this.hp + amount);
    this.sync();
    return this.hp - before;
  }

  /** 回傳 true 代表這一下讓夥伴陣亡 */
  takeDamage(amount: number): boolean {
    if (!this.alive || this.hurtCooldown > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtCooldown = 0.35;
    this.sprite.setTintFill(0xff5252);
    this.scene.time.delayedCall(70, () => this.sprite.active && this.alive && this.sprite.setTint(this.def.tint));
    if (this.alive) {
      this.sync();
      return false;
    }
    // 陣亡：倒地、變暗，標記與血條消失
    this.status = '陣亡';
    this.sprite.stop();
    this.sprite.setTint(0x555555);
    this.mark.destroy();
    this.hpBack.destroy();
    this.hpBar.destroy();
    this.scene.tweens.add({ targets: this.sprite, angle: -90 * this.facing, alpha: 0.5, duration: 400 });
    return true;
  }

  private sync(moving = false): void {
    if (!this.alive) return;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
    this.sprite.x = this.footX;
    this.sprite.y = this.footY - bob;
    this.sprite.setFlipX(this.facing < 0);
    const depth = depthForY(this.footY);
    this.sprite.setDepth(depth);
    const top = this.footY - 56 - bob;
    this.mark.setPosition(this.footX, top - 4).setDepth(depth);
    const ratio = this.hp / this.def.maxHp;
    // 滿血時隱藏血條，畫面比較乾淨
    const showHp = ratio < 1;
    this.hpBack.setPosition(this.footX, top + 1).setDepth(depth).setVisible(showHp);
    this.hpBar
      .setPosition(this.footX - 7, top + 1)
      .setDepth(depth)
      .setVisible(showHp)
      .setFillStyle(ratio > 0.5 ? 0x81c784 : ratio > 0.25 ? 0xffd54f : 0xe57373);
    this.hpBar.width = 14 * ratio;
  }
}
