import Phaser from 'phaser';
import { DEPTH_FX, clampLaneY, depthForY } from '../config';
import { crewShootAnim, ensureCrewTexture } from '../art/CrewArt';
import type { CompanionRoleDef, CrewMember } from '../data/companions';
import { TRAIT_TUNING, resolveCrewStats, type CrewStats } from '../data/crewTraits';
import { Fx } from '../fx/Fx';
import { GameEvents } from '../systems/GameEvents';
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
  /** 隊友鼓舞等外部射速加成 */
  fireRateMult?: number;
  zombies: Zombie[];
}

export interface CompanionShot {
  kills: number;
  headshots: number;
}

/**
 * NPC 夥伴：每人一張依外觀換裝的專屬精靈圖（src/art/CrewArt.ts），頭上有職業顏色標記。
 * 數值 = 職業基礎 × 個人屬性 × 特質（src/data/crewTraits.ts 的 resolveCrewStats）。
 * 行為由 CompanionSystem 決定「要去哪、能不能開槍」，這裡只負責移動、自動瞄準射擊、受傷與陣亡。
 * 一樣用 footX / footY（腳底）做所有判定。
 */
export class Companion {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly member: CrewMember;
  readonly def: CompanionRoleDef;
  /** 這位隊員實際的數值 */
  readonly stats: CrewStats;
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
  /** 有專屬貼圖時不染色 */
  private tint: number | null;
  private shootAnim: string | null;
  private baseScaleX: number;
  /** 「命硬」這晚用掉了沒 */
  private secondWindUsed = false;
  /** 「膽小」或膽識低：這一幀被霧屍貼身 */
  private panicking = false;

  constructor(private scene: Phaser.Scene, member: CrewMember, def: CompanionRoleDef, x: number, y: number) {
    this.member = member;
    this.def = def;
    this.footX = x;
    this.footY = clampLaneY(y);
    // 武器系統若配發了 weaponId，之後在這裡換成那把槍的基礎數值
    this.stats = resolveCrewStats(def, member);
    this.hp = this.stats.maxHp;
    this.ammo = this.stats.gun.magazine;
    const key = ensureCrewTexture(scene, member);
    this.tint = key ? null : def.tint;
    this.shootAnim = key ? crewShootAnim(member) : scene.anims.exists('player_shoot') ? 'player_shoot' : null;
    this.sprite = scene.add.sprite(x, this.footY, key ?? 'player', 0);
    if (this.tint !== null) this.sprite.setTint(this.tint);
    this.sprite.setOrigin(0.5, scene.anims.exists('player_shoot') || key ? 63 / 64 : 1);
    // 體型：寬高略有不同
    const build = member.look?.build ?? { w: 1, h: 1 };
    this.baseScaleX = 0.94 * build.w;
    this.sprite.setScale(this.baseScaleX, 0.94 * build.h);
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
        this.ammo = this.stats.gun.magazine;
      }
    }

    // 移動：走向想去的位置，到了就停（小死區避免抖動）
    const dx = intent.moveX - this.footX;
    const dy = intent.moveY - this.footY;
    const dist = Math.hypot(dx, dy);
    let moving = false;
    if (dist > 3) {
      const step = Math.min(dist, this.stats.speed * dt);
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
      this.aimDelay = this.stats.aimDelay;
    }
    this.aimDelay = Math.max(0, this.aimDelay - dt);
    this.panicking = this.closestDistance(intent.zombies) < TRAIT_TUNING.skittishRange;
    if (target && intent.canShoot && !this.reloading && this.cooldown <= 0 && this.aimDelay <= 0) {
      shot = this.fire(target, intent.zombies, intent.fireRateMult ?? 1);
    }
    this.sync(moving);
    return shot;
  }

  private nearestZombie(zombies: Zombie[]): Zombie | null {
    let best: Zombie | null = null;
    let bestD = this.stats.gun.range;
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

  /** 最近一隻霧屍的距離（判斷有沒有被貼身） */
  private closestDistance(zombies: Zombie[]): number {
    let best = Infinity;
    for (const z of zombies) {
      if (z.dead) continue;
      best = Math.min(best, Math.hypot(z.footX - this.footX, (z.footY - this.footY) * 1.4));
    }
    return best;
  }

  /** 背水一戰：血量低時觸發 */
  get lastStand(): boolean {
    return this.stats.hooks.has('lastStand') && this.hp / this.stats.maxHp < TRAIT_TUNING.lastStandRatio;
  }

  /** 被貼身時手抖：膽小的人特別嚴重，膽識 1～2 星的人也會受影響（冷靜不受影響） */
  private get panicSpread(): number {
    if (!this.panicking) return 1;
    if (this.stats.hooks.has('skittish')) return TRAIT_TUNING.skittishSpread;
    if ((this.member.attrs?.nerve ?? 3) <= 2 && !this.member.traits?.includes('coolhead')) return TRAIT_TUNING.lowNervePanicSpread;
    return 1;
  }

  /** 膽小的人被貼身時會想往後退 */
  get wantsToRetreat(): boolean {
    return this.panicking && this.stats.hooks.has('skittish');
  }

  /** 和主角一樣的即時命中射擊（只打穿一隻），命中/擊殺特效沿用 Fx */
  private fire(target: Zombie, zombies: Zombie[], rateMult: number): CompanionShot {
    const g = this.stats.gun;
    const rage = this.lastStand;
    this.ammo -= 1;
    this.cooldown = 1 / (g.fireRate * rateMult * (rage ? TRAIT_TUNING.lastStandFireRate : 1));
    if (this.ammo <= 0) this.reloadLeft = g.reloadTime;

    const r = target.getHitRect();
    const aimHead = Math.random() < g.headChance;
    const aimY = aimHead ? r.y + r.height * 0.12 : r.y + r.height * Phaser.Math.FloatBetween(0.35, 0.7);
    const fromX = this.gunX + 5 * this.facing;
    const fromY = this.gunY;
    const angle =
      Math.atan2(aimY - fromY, target.footX - fromX) +
      Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-1, 1) * g.spread * this.panicSpread);
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
      const dmg = g.damage * (head ? 2.5 : 1) * (rage ? TRAIT_TUNING.lastStandDamage : 1);
      const killed = hit.z.takeDamage(dmg, g.knockback, { headshot: head, dirX });
      if (killed) result.kills++;
      GameEvents.of(this.scene).emit('enemy:hit', { enemyId: hit.z.def.id, x: hit.x, y: hit.y, damage: dmg, headshot: head, killed });
    }
    const endX = hit ? hit.x : ray.x2;
    const endY = hit ? hit.y : ray.y2;
    if (fx) {
      fx.bulletTracer(fromX, fromY, endX, endY);
      fx.muzzleSmoke(fromX, fromY, angle);
    }
    GameEvents.of(this.scene).emit('ally:shoot', { role: this.def.role, x: fromX, y: fromY, angle });
    if (this.shootAnim) this.sprite.play(this.shootAnim);
    else {
      const flash = this.scene.add.circle(fromX, fromY, 3, 0xfff3a0).setDepth(DEPTH_FX + 2);
      this.scene.tweens.add({ targets: flash, scale: 0.2, alpha: 0, duration: 70, onComplete: () => flash.destroy() });
    }
    return result;
  }

  heal(amount: number): number {
    if (!this.alive || this.hp >= this.stats.maxHp) return 0;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    this.sync();
    return this.hp - before;
  }

  /** 回傳 true 代表這一下讓夥伴陣亡 */
  takeDamage(amount: number): boolean {
    if (!this.alive || this.hurtCooldown > 0) return false;
    const fx = Fx.of(this.scene);
    // 身手矯健：有機率閃開
    if (this.stats.hooks.has('nimble') && Math.random() < TRAIT_TUNING.nimbleChance) {
      this.hurtCooldown = 0.35;
      fx?.popText(this.footX, this.footY - 60, '閃開！', '#b3e5fc');
      return false;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.hurtCooldown = 0.35;
    // 命硬：每晚一次，致命傷改為剩 1 血
    if (this.hp <= 0 && this.stats.hooks.has('secondWind') && !this.secondWindUsed) {
      this.secondWindUsed = true;
      this.hp = 1;
      this.hurtCooldown = 1.2;
      fx?.popText(this.footX, this.footY - 66, '命硬！', '#ffcc80');
    }
    GameEvents.of(this.scene).emit('ally:hurt', {
      name: this.member.name,
      role: this.def.role,
      amount,
      hp: this.hp,
      maxHp: this.stats.maxHp,
      x: this.footX,
      y: this.footY,
    });
    this.sprite.setTintFill(0xff5252);
    this.scene.time.delayedCall(70, () => {
      if (!this.sprite.active || !this.alive) return;
      if (this.tint === null) this.sprite.clearTint();
      else this.sprite.setTint(this.tint);
    });
    if (this.alive) {
      this.sync();
      return false;
    }
    // 陣亡：倒地、變暗，標記與血條消失
    this.status = '陣亡';
    GameEvents.of(this.scene).emit('ally:death', { name: this.member.name, role: this.def.role, x: this.footX, y: this.footY });
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
    const ratio = this.hp / this.stats.maxHp;
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
