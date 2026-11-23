import Phaser from 'phaser';
import { DEPTH_FX, clampLaneY, depthForY } from '../config';
import { crewArmColors, crewShootAnim, ensureCrewTexture } from '../art/CrewArt';
import type { CompanionRoleDef, CrewMember } from '../data/companions';
import { AMMO, getFirearm } from '../data/weapons';
import { IMPROVISED_MELEE, crewWeapon } from '../data/crewLoadout';
import type { DamageInfo } from '../combat/Damage';
import { GameState } from '../state/GameState';
import { TRAIT_TUNING, resolveCrewStats, type CrewStats } from '../data/crewTraits';
import { Fx } from '../fx/Fx';
import { stripArms } from '../art/WeaponArt';
import { CLOTH, SKIN_TONES } from '../data/crewLooks';
import { WeaponRig } from './WeaponRig';
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

type SwingPhase = 'idle' | 'windup' | 'active' | 'recovery';

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
  /** 這位隊員實際的數值（子彈打光換回隨身手槍時會重算） */
  stats: CrewStats;
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
  /** 手上的武器（有擦掉手臂的身體圖時才有） */
  private rig: WeaponRig | null = null;
  private aim = 0;
  private bob = 0;
  private visualWeapon: string;
  private baseScaleX: number;
  /** 「命硬」這晚用掉了沒 */
  private secondWindUsed = false;
  /** 「膽小」或膽識低：這一幀被霧屍貼身 */
  private panicking = false;
  /** 近戰揮擊 */
  private swing: SwingPhase = 'idle';
  private swingT = 0;
  private swingDir = 1;
  private swingHit = new Set<Zombie>();

  constructor(private scene: Phaser.Scene, member: CrewMember, def: CompanionRoleDef, x: number, y: number) {
    this.member = member;
    this.def = def;
    this.footX = x;
    this.footY = clampLaneY(y);
    // 武器：配發的（會用才拿）> 隨身手槍 > 沒碰過槍的人拿隨身小刀
    this.stats = resolveCrewStats(def, member, crewWeapon(member));
    this.hp = this.stats.maxHp;
    this.ammo = 0;
    this.loadMagazine(true);
    const key = ensureCrewTexture(scene, member);
    this.tint = key ? null : def.tint;
    const anim = key ? crewShootAnim(member) : 'player_shoot';
    this.shootAnim = scene.anims.exists(anim) ? anim : null;
    // 身體擦掉手臂，手與武器由 WeaponRig 畫（和主角一樣會換彈、拉栓）
    const body = key ? stripArms(scene, key) : null;
    this.visualWeapon = this.stats.weaponId;
    if (body) {
      // 袖子顏色從畫好的圖取樣（底圖沒換色時是原本衣服的顏色；背心的人是膚色）
      const look = member.look;
      const cloth = CLOTH[look?.jacket ?? 0]?.ramp ?? CLOTH[0].ramp;
      const skin = SKIN_TONES[look?.skin ?? 0] ?? SKIN_TONES[0];
      const arm = crewArmColors(member) ?? { sleeve: cloth[1], sleeveHi: cloth[2], skin: skin[2] };
      this.rig = new WeaponRig(scene, arm);
      this.rig.setWeapon(this.visualWeapon);
      this.shootAnim = null;
    }
    this.sprite = scene.add.sprite(x, this.footY, body ?? key ?? 'player', 0);
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
    this.updateRig(0, null);
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
        this.loadMagazine(false);
        this.rig?.endReload();
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

    // 近戰型：貼近就揮
    if (this.stats.melee) {
      const shot = this.updateMelee(dt, intent);
      this.sync(moving);
      this.updateRig(dt, null);
      return shot;
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
    this.updateRig(dt, target);
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

  get isMelee(): boolean {
    return !!this.stats.melee;
  }

  /** 近戰攻擊距離（給 CompanionSystem 決定要站多前面） */
  get meleeReach(): number {
    return this.stats.melee?.reach ?? 0;
  }

  /**
   * 裝填：配發的槍從據點彈藥庫扣子彈（和主角共用）；隨身手槍備彈無限。
   * 庫存打光就換回隨身手槍。
   */
  private loadMagazine(first: boolean): void {
    if (this.stats.melee) return;
    const g = this.stats.gun;
    const fd = !this.stats.sidearm ? getFirearm(this.stats.weaponId) : undefined;
    if (!fd || fd.infiniteReserve) {
      this.ammo = g.magazine;
      return;
    }
    const reserve = GameState.data.armory.ammo;
    const need = g.magazine - Math.max(0, this.ammo);
    const take = Math.min(need, reserve[fd.ammo] ?? 0);
    reserve[fd.ammo] = (reserve[fd.ammo] ?? 0) - take;
    this.ammo = Math.max(0, this.ammo) + take;
    if (this.ammo > 0) return;
    // 沒子彈了：換回隨身手槍（不會用手槍的人拿隨身小刀）
    const fallback = (this.member.prof?.handgun ?? 2) > 0 ? undefined : IMPROVISED_MELEE;
    const hp = this.hp;
    this.stats = resolveCrewStats(this.def, this.member, fallback);
    this.hp = Math.min(hp, this.stats.maxHp);
    this.ammo = this.stats.melee ? 0 : this.stats.gun.magazine;
    this.visualWeapon = this.stats.weaponId;
    this.rig?.setWeapon(this.visualWeapon);
    if (!first) Fx.of(this.scene)?.popText(this.footX, this.footY - 62, `${AMMO[fd.ammo].name}打光了`, '#ffcc80');
  }

  /** 近戰：最近的霧屍在攻擊距離內就起手；判定在 active 那一瞬間掃一次扇形 */
  private updateMelee(dt: number, intent: CompanionIntent): CompanionShot | null {
    const ms = this.stats.melee!;
    const res: CompanionShot = { kills: 0, headshots: 0 };
    const near = this.nearestZombieWithin(intent.zombies, ms.reach + 14);
    if (near && this.swing === 'idle') this.facing = near.footX >= this.footX ? 1 : -1;
    this.panicking = this.closestDistance(intent.zombies) < TRAIT_TUNING.skittishRange;
    const rage = this.lastStand;
    const speed = rage ? 1 / TRAIT_TUNING.lastStandFireRate : 1;
    this.swingT += dt;
    switch (this.swing) {
      case 'idle':
        if (near && intent.canShoot && this.cooldown <= 0) {
          this.swing = 'windup';
          this.swingT = 0;
          this.swingDir = -this.swingDir;
          this.swingHit.clear();
        }
        break;
      case 'windup':
        if (this.swingT >= ms.windup * speed) {
          this.swing = 'active';
          this.swingT = 0;
          this.sweep(intent.zombies, res, rage);
          GameEvents.of(this.scene).emit('ally:shoot', { role: this.def.role, x: this.footX, y: this.footY - 30, angle: this.facing > 0 ? 0 : Math.PI, weaponId: ms.id });
        }
        break;
      case 'active':
        if (this.swingT >= ms.active) {
          this.swing = 'recovery';
          this.swingT = 0;
        }
        break;
      case 'recovery':
        if (this.swingT >= ms.recovery * speed) {
          this.swing = 'idle';
          this.swingT = 0;
          this.cooldown = 0.08;
        }
        break;
    }
    if (this.rig) {
      const dur = this.swing === 'windup' ? ms.windup * speed : this.swing === 'active' ? ms.active : ms.recovery * speed;
      this.rig.setMelee({ id: ms.id, phase: this.swing === 'idle' ? 'recovery' : this.swing, k: this.swing === 'idle' ? 1 : Math.min(1, this.swingT / Math.max(0.01, dur)), dir: this.swingDir });
    }
    return res.kills || res.headshots ? res : null;
  }

  private nearestZombieWithin(zombies: Zombie[], range: number): Zombie | null {
    let best: Zombie | null = null;
    let bestD = range;
    for (const z of zombies) {
      if (z.dead) continue;
      const d = Math.hypot(z.footX - this.footX, (z.footY - this.footY) * 2);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** 揮擊判定：和主角的近戰一樣，前方扇形、最多打 maxTargets 隻 */
  private sweep(zombies: Zombie[], res: CompanionShot, rage: boolean): void {
    const ms = this.stats.melee!;
    const half = Phaser.Math.DegToRad(ms.arc / 2);
    const cands: { z: Zombie; d: number }[] = [];
    for (const z of zombies) {
      if (z.dead || this.swingHit.has(z)) continue;
      const fwd = (z.footX - this.footX) * this.facing;
      const side = (z.footY - this.footY) * 2;
      const d = Math.hypot(fwd, side);
      if (d > ms.reach + 10 * (z.def.scale ?? 1) || fwd < -6) continue;
      if (Math.atan2(Math.abs(side), Math.max(0.01, fwd)) > half && d > 10) continue;
      cands.push({ z, d });
    }
    cands.sort((a, b) => a.d - b.d);
    const fx = Fx.of(this.scene);
    const bus = GameEvents.of(this.scene);
    for (const { z } of cands.slice(0, ms.maxTargets)) {
      this.swingHit.add(z);
      const info: DamageInfo = {
        amount: ms.damage * (rage ? TRAIT_TUNING.lastStandDamage : 1),
        type: ms.damageType,
        penetration: ms.penetration,
        knockback: ms.knockback,
        stagger: ms.stagger,
        headshot: false,
        dirX: this.facing,
        source: 'ally',
        weaponId: ms.id,
      };
      const hx = z.footX - 4 * this.facing;
      const hy = z.footY - 30 * (z.def.scale ?? 1);
      fx?.blood(hx, hy, this.facing, z.footY, ms.damageType === 'slash' ? 6 : 3, 0.9);
      const killed = z.takeHit(info);
      if (killed) res.kills++;
      bus.emit('enemy:hit', { enemyId: z.def.id, x: hx, y: hy, damage: info.amount, headshot: false, killed });
    }
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
    if (this.ammo <= 0) {
      this.reloadLeft = g.reloadTime;
      this.scene.time.delayedCall(250, () => this.alive && this.rig?.startReload(Math.max(0.3, g.reloadTime - 0.25), true, true));
    }

    const r = target.getHitRect();
    const aimHead = Math.random() < g.headChance;
    const aimY = aimHead ? r.y + r.height * 0.12 : r.y + r.height * Phaser.Math.FloatBetween(0.35, 0.7);
    // 有手持武器就從真正的槍口射出
    this.aim = Math.atan2(aimY - (this.footY - 35), target.footX - this.footX);
    const fromX = this.rig ? this.rig.muzzle.x : this.gunX + 5 * this.facing;
    const fromY = this.rig ? this.rig.muzzle.y : this.gunY;
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
      const killed = hit.z.takeDamage(dmg, g.knockback, { headshot: head, dirX, hitY: hit.y });
      if (killed) result.kills++;
      GameEvents.of(this.scene).emit('enemy:hit', { enemyId: hit.z.def.id, x: hit.x, y: hit.y, damage: dmg, headshot: head, killed });
    }
    const endX = hit ? hit.x : ray.x2;
    const endY = hit ? hit.y : ray.y2;
    if (fx) {
      fx.bulletTracer(fromX, fromY, endX, endY);
      fx.muzzleSmoke(fromX, fromY, angle);
    }
    GameEvents.of(this.scene).emit('ally:shoot', { role: this.def.role, x: fromX, y: fromY, angle, weaponId: g.weaponId ?? this.visualWeapon });
    if (this.rig) this.rig.fire();
    else if (this.shootAnim) this.sprite.play(this.shootAnim);
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
    // 閃避：體格（瘦小難打中）＋身手矯健
    if (Math.random() < this.stats.dodge) {
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
    this.rig?.destroy();
    this.rig = null;
    this.mark.destroy();
    this.hpBack.destroy();
    this.hpBar.destroy();
    this.scene.tweens.add({ targets: this.sprite, angle: -90 * this.facing, alpha: 0.5, duration: 400 });
    return true;
  }

  /** 手上的武器：有目標時指著目標（限制在前方 ±70°），沒目標就平舉 */
  private updateRig(dt: number, target: Zombie | null): void {
    if (!this.rig) return;
    if (!target) this.aim = this.facing > 0 ? 0.12 : Math.PI - 0.12;
    const lim = Phaser.Math.DegToRad(70);
    let a = this.aim;
    if (this.facing > 0) a = Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(a), -lim, lim);
    else a = Math.PI + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(a - Math.PI), -lim, lim);
    this.rig.update(dt, {
      footX: this.footX,
      footY: this.footY,
      facing: this.facing,
      aim: a,
      bob: this.bob,
      depth: this.sprite.depth,
      scale: this.sprite.scaleY,
    });
  }

  private sync(moving = false): void {
    if (!this.alive) return;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
    this.bob = bob;
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
