import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import type { EnemyDef } from '../data/enemies';
import { BURST, CHARGE, CROW, ENRAGE, HEAL_AURA, POUNCE, type ArmorPiece } from '../data/zombies';
import { ANIMAL_FRAMES } from '../art/AnimalArt';
import { Fx } from '../fx/Fx';
import { ZOMBIE_NECK_ROW } from '../art/sprites';
import { FOOT_ROW, GEAR_TEXTURE, HAT_ART, HEAD_ANCHORS } from '../art/ZombieComposer';
import { GameEvents } from '../systems/GameEvents';
import { armorAfter, type DamageInfo } from '../combat/Damage';
import type { ZombieSpec } from '../systems/ZombieFactory';

/** 受擊資訊：給程式化動畫決定怎麼反應 */
export interface HitInfo {
  headshot?: boolean;
  /** 子彈飛行方向的 x 分量（-1..1），決定血往哪噴、往哪倒、往哪退 */
  dirX?: number;
  /**
   * 傷害類型（和武器的 DamageType 對齊）：'blast' 爆炸不分頭身、護甲效果減半；
   * 'blunt' 鈍擊對頭盔也有效（敲飛頭盔用）。不填當作子彈。
   */
  type?: string;
  /** 穿甲 0..1：護甲減傷先扣掉這個值，max(0, armor − penetration) */
  penetration?: number;
}

/** 霧屍每幀需要知道的戰場資訊 */
export interface ZombieContext {
  /** 擋路的那條線（路障或據點外牆）的 x；霧屍不能越過 */
  blockX: number;
  /** 撞到擋路線時的攻擊；y 是攻擊者的腳底 y，讓特效出現在對的那一段 */
  hitBlock: (damage: number, y: number) => void;
  player: { x: number; y: number; alive: boolean };
  /** 打到主角；fromX/fromY 是霧屍腳底，用來決定擊退方向 */
  hitPlayer: (damage: number, fromX: number, fromY: number) => void;
  /**
   * 據點建築的阻擋（沙包牆等）：依霧屍位置回傳比 blockX 更前面的擋路線，沒有就回傳 null。
   */
  blockerFor?: (x: number, y: number) => { blockX: number; hit: (damage: number, y: number) => void } | null;
  /** 地面效果的速度倍率（陷阱、照明燈），1 代表不影響 */
  speedMul?: (x: number, y: number) => number;
  /** 其他可被盯上的目標（NPC 夥伴）；和主角一樣，只有站在擋路線外側才會被追 */
  others?: ZombieTarget[];
  /** 場上所有霧屍（護理師的治療光環用） */
  zombies?: Zombie[];
  /** 多近會盯上主角／夥伴（不填用預設值）；探索戰鬥設很大，霧屍會一路追過來 */
  aggroRange?: number;
}

export interface ZombieTarget {
  x: number;
  y: number;
  alive: boolean;
  /** fromX/fromY 是霧屍腳底 */
  hit: (damage: number, fromX: number, fromY: number) => void;
}

/** 主角離多近會被盯上（以地面距離計，y 方向加權） */
const AGGRO_RANGE = 120;
/** 近戰攻擊的觸及範圍 */
const REACH_X = 20;
const REACH_Y = 9;

export class Zombie extends Phaser.GameObjects.Sprite {
  readonly def: EnemyDef;
  /** 這隻的職業、外觀、裝備、變異（見 ZombieFactory） */
  readonly spec: ZombieSpec;
  hp: number;
  readonly maxHp: number;
  /** 腳底位置，所有判定都用它（sprite 的 y 會因走路顛簸而偏移） */
  footX: number;
  footY: number;
  private attackTimer = 0;
  private speedJitter: number;
  /** 走路動態用的相位，讓每隻步伐不同步 */
  private walkPhase = Math.random() * Math.PI * 2;
  /** 朝路障前進時想站的 y，讓屍群沿著柵欄散開而不是擠成一點 */
  private laneY: number;
  private walkKey: string;
  private attackKey: string;
  /** 被打中時往後仰的角度，逐漸回正 */
  private hitLean = 0;
  /** 攻擊時往前撲的位移 */
  private lunge = 0;
  dead = false;
  /** 下次低吼前的秒數（給音效用） */
  private groanIn = 1 + Math.random() * 6;

  // ── 裝備與能力 ──
  /** 頭盔（擋爆頭，耐久歸零就被打飛） */
  helmet: ArmorPiece | null;
  /** 防彈背心（擋身體，耐久歸零就失效） */
  vest: ArmorPiece | null;
  /** 硬直剩餘秒數：期間不能移動、不能攻擊（近戰武器用 stagger() 施加） */
  stunTimer = 0;
  private hat: Phaser.GameObjects.Image | null = null;
  private mark: Phaser.GameObjects.Image | null = null;
  private enraged = false;
  private sinceHit = 99;
  private healTimer = Math.random() * HEAL_AURA.interval;

  // ── 動物 ──
  /** 屍鴉飛行高度（像素，腳底往上） */
  alt = 0;
  private crowState: 'approach' | 'dive' | 'retreat' = 'approach';
  private crowTimer = 0;
  private crowShadow: Phaser.GameObjects.Ellipse | null = null;
  /** 屍犬撲咬：冷卻、剩餘時間、速度、這次撲咬打中沒 */
  private pounceCd = Math.random() * POUNCE.cooldown;
  private pounceT = 0;
  private pounceVx = 0;
  private pounceVy = 0;
  private pounceHit = false;
  /** 屍熊衝撞過了沒（每隻只撞第一下） */
  private charged = false;

  constructor(scene: Phaser.Scene, x: number, y: number, spec: ZombieSpec) {
    super(scene, x, y, spec.def.texture);
    this.spec = spec;
    this.def = spec.def;
    this.hp = spec.def.hp;
    this.maxHp = spec.def.hp;
    this.helmet = spec.helmet ? { ...spec.helmet } : null;
    this.vest = spec.vest ? { ...spec.vest } : null;
    const def = spec.def;
    this.footX = x;
    this.footY = clampLaneY(y);
    this.laneY = this.footY;
    this.walkKey = `${def.texture}_walk`;
    this.attackKey = `${def.texture}_attack`;
    // 走路圖的腳底在 64 格中的第 62 列；動物各自的腳底列見 ANIMAL_FRAMES
    if (spec.body !== 'human') {
      const info = ANIMAL_FRAMES[spec.body];
      this.setOrigin(0.5, spec.body === 'crow' ? 0.5 : info.footRow / info.h);
    } else this.setOrigin(0.5, scene.anims.exists(this.walkKey) ? FOOT_ROW / 64 : 1);
    if (spec.body === 'crow') {
      this.alt = CROW.cruiseAlt + Phaser.Math.Between(-10, 14);
      this.crowShadow = scene.add.ellipse(x, this.footY, 12, 3, 0x000000, 0.3);
    }
    // 美術素材朝右繪製，霧屍預設往左走所以水平翻轉
    this.setFlipX(true);
    // 體型：胖瘦只改橫向寬度（spec.widthMul），高矮改整體大小（def.scale）
    this.setScale((def.scale ?? 1) * (spec.widthMul ?? 1), def.scale ?? 1);
    if (spec.hat !== 'none' && scene.textures.exists(GEAR_TEXTURE)) {
      const art = HAT_ART[spec.hat];
      this.hat = scene.add.image(x, y, GEAR_TEXTURE, spec.hat);
      this.hat.setData('ox', (art.ax + 0.5) / art.rows[0].length).setData('oy', (art.ay + 0.5) / art.rows.length);
    }
    if (spec.mutations.length && scene.textures.exists(GEAR_TEXTURE)) {
      this.mark = scene.add.image(x, y, GEAR_TEXTURE, 'mark').setTint(spec.mutations[0].mark);
    }
    this.restoreTint();
    if (scene.anims.exists(this.walkKey)) {
      this.play({ key: this.walkKey, startFrame: Phaser.Math.Between(0, 3) });
      // 跑得快的步伐也快
      this.anims.timeScale = spec.body === 'human' ? Phaser.Math.Clamp(def.speed / 18, 0.6, 2) : 1;
    }
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
    this.sync(0);
    const shadowW = { human: 22, dog: 30, bear: 56, crow: 0 }[spec.body];
    if (shadowW) Fx.of(scene)?.attachShadow(this, shadowW * this.s * (spec.widthMul ?? 1));
    GameEvents.of(scene).emit('enemy:spawn', { enemyId: def.id, x, y: this.footY });
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.hat?.destroy();
      this.mark?.destroy();
      this.crowShadow?.destroy();
    });
  }

  /** 目前的移動速度與攻擊間隔（暴走時變快） */
  private get speedNow(): number {
    return this.def.speed * (this.enraged ? ENRAGE.speedMul : 1);
  }

  private get attackIntervalNow(): number {
    return this.def.attackInterval * (this.enraged ? ENRAGE.attackIntervalMul : 1);
  }

  /** 施加硬直（近戰武器用）；硬直抵抗高的職業（消防員）只會頓一下 */
  stagger(seconds: number): void {
    this.stunTimer = Math.max(this.stunTimer, seconds * (1 - this.spec.staggerResist));
  }

  private get s(): number {
    return this.def.scale ?? 1;
  }

  private restoreTint(): void {
    const t = this.enraged ? ENRAGE.tint : (this.spec.tint ?? this.def.tint);
    if (t) this.setTint(t);
    else this.clearTint();
    if (this.hat) {
      if (this.spec.hatTint) this.hat.setTint(this.spec.hatTint);
      else this.hat.clearTint();
    }
  }

  /** 頭頂在世界座標的位置（跟著影格、翻轉、縮放與搖晃）；倒地影格回傳 null */
  private headPoint(): { x: number; y: number } | null {
    if (this.spec.body !== 'human') {
      // 動物：判定框上緣、偏向頭的那一側
      const r = this.getHitRect();
      return { x: r.centerX + (this.flipX ? -1 : 1) * r.width * 0.3, y: r.y };
    }
    const a = HEAD_ANCHORS[Number(this.frame.name)] ?? (this.anims.isPlaying ? null : HEAD_ANCHORS[0]);
    if (!a) return null;
    const ox = this.originX * this.frame.width;
    const oy = this.originY * this.frame.height;
    let lx = (a.x + 0.5 - ox) * this.scaleX;
    if (this.flipX) lx = -lx;
    const ly = (a.y - oy) * this.scaleY;
    const r = this.rotation;
    return { x: this.x + lx * Math.cos(r) - ly * Math.sin(r), y: this.y + lx * Math.sin(r) + ly * Math.cos(r) };
  }

  /** 頭飾、變異標記跟著頭走 */
  private syncGear(): void {
    const hp = this.headPoint();
    if (this.hat) {
      if (hp) {
        const ox = this.hat.getData('ox') as number;
        const oy = this.hat.getData('oy') as number;
        this.hat
          .setVisible(true)
          .setFlipX(this.flipX)
          .setOrigin(this.flipX ? 1 - ox : ox, oy)
          .setPosition(hp.x, hp.y)
          .setScale(this.scaleX, this.scaleY)
          .setRotation(this.rotation)
          .setDepth(this.depth + 0.001);
      } else this.hat.setVisible(false);
    }
    if (this.mark && hp) {
      const bob = Math.sin(this.walkPhase * 0.7) * 1;
      const pulse = this.spec.burst === 'small' ? 1 + 0.25 * Math.abs(Math.sin(this.scene.time.now / 160)) : 1;
      this.mark
        .setPosition(hp.x, hp.y - (this.hat ? 12 : 7) * this.s + bob)
        .setScale(pulse)
        .setDepth(this.depth + 0.002);
    }
  }

  /**
   * 命中判定框：走路圖的影格四周有透明邊，所以不用整張圖的外框，
   * 只取身體所在的中間區域。以腳底為準，不受走路顛簸影響。
   */
  getHitRect(): Phaser.Geom.Rectangle {
    const s = this.s;
    switch (this.spec.body) {
      case 'dog':
        return new Phaser.Geom.Rectangle(this.footX - 17 * s, this.footY - 19 * s, 34 * s, 19 * s);
      case 'bear':
        return new Phaser.Geom.Rectangle(this.footX - 31 * s, this.footY - 44 * s, 62 * s, 44 * s);
      case 'crow': {
        // 飛在空中：判定框跟著高度走，比圖稍大一點，不然太難打
        const cy = this.footY - this.alt;
        return new Phaser.Geom.Rectangle(this.footX - 11 * s, cy - 8 * s, 22 * s, 15 * s);
      }
      default: {
        const w = 30 * s * (this.spec.widthMul ?? 1);
        const h = 56 * s;
        return new Phaser.Geom.Rectangle(this.footX - w / 2, this.footY - h, w, h);
      }
    }
  }

  /** 頭部區域：人形是判定框上方 25%；屍犬的頭抬得高，上方 40%；屍鴉不分頭身 */
  isHeadshot(hitY: number): boolean {
    if (this.spec.body === 'crow') return false;
    const r = this.getHitRect();
    return hitY <= r.y + r.height * (this.spec.body === 'dog' ? 0.4 : 0.25);
  }

  update(dt: number, ctx: ZombieContext): void {
    if (this.dead) return;
    this.updateAbilities(dt, ctx);
    if (this.stunTimer > 0) {
      // 硬直：原地晃，不走也不打
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      this.attackTimer = 0;
      if (this.anims.isPlaying) this.anims.pause();
      this.sync(0, dt);
      return;
    }
    if (this.anims.isPaused) this.anims.resume();
    if (this.spec.body === 'crow') {
      this.updateCrow(dt, ctx);
      return;
    }
    if (this.pounceT > 0) {
      this.updatePounce(dt, ctx);
      return;
    }
    this.pounceCd -= dt;
    this.groanIn -= dt;
    if (this.groanIn <= 0) {
      this.groanIn = 4 + Math.random() * 8;
      GameEvents.of(this.scene).emit('enemy:groan', { enemyId: this.def.id, x: this.footX, y: this.footY });
    }
    this.hitLean *= Math.max(0, 1 - dt * 12);
    const blk = ctx.blockerFor?.(this.footX, this.footY);
    const blockX = blk ? blk.blockX : ctx.blockX;
    const rawHit = blk ? blk.hit : ctx.hitBlock;
    // 工人的鐵鎚、消防員的斧頭：拆路障、建築特別快
    const hitBlock = (d: number, y: number) => rawHit(d * this.spec.structureMul, y);
    const minX = blockX + 18 * this.s;
    const speed = this.speedNow * this.speedJitter * (ctx.speedMul?.(this.footX, this.footY) ?? 1);
    // 主角或夥伴在擋路線外側、而且夠近 → 改追最近的那個（2D 追擊）
    const p = this.pickTarget(ctx);
    const dx = p ? p.x - this.footX : 0;
    const dy = p ? p.y - this.footY : 0;

    let moved = false;
    // 屍犬：夠近就撲上去
    if (p && this.spec.body === 'dog' && this.pounceCd <= 0) {
      const dist = Math.hypot(dx, dy * 1.6);
      if (dist < POUNCE.range && dist > REACH_X) {
        this.startPounce(dx, dy);
        this.sync(1, dt);
        return;
      }
    }
    if (p) {
      if (Math.abs(dx) <= REACH_X && Math.abs(dy) <= REACH_Y) {
        this.setFlipX(dx < 0);
        this.attack(dt, () => p.hit(this.def.damage, this.footX, this.footY), Math.sign(dx) || -1);
      } else {
        // 站到主角的左邊或右邊，而不是疊在主角身上
        const side = dx >= 0 ? -1 : 1;
        const ex = p.x + side * (REACH_X - 4) - this.footX;
        const d = Math.hypot(ex, dy) || 1;
        // 前後（y）移動比左右慢，和主角一樣做出縱深感
        this.footX += (ex / d) * speed * dt;
        this.footY += (dy / d) * speed * 0.7 * dt;
        this.setFlipX(ex < 0);
        moved = true;
      }
      this.laneY = this.footY;
    } else if (this.footX > minX) {
      // 屍熊：接近擋路線時衝撞，撞上的第一下特別重
      const charging = this.spec.body === 'bear' && !this.charged && this.footX - minX < CHARGE.from;
      const v = charging ? speed * CHARGE.speedMul : speed;
      this.footX = Math.max(minX, this.footX - v * dt);
      if (charging && this.footX <= minX) {
        this.charged = true;
        hitBlock(this.def.damage * CHARGE.impactMul, this.footY);
        Fx.of(this.scene)?.popText(this.footX - 10, this.footY - 50, '衝撞！', '#ff9a4a');
        GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
      }
      this.footY += Phaser.Math.Clamp(this.laneY - this.footY, -speed * 0.5 * dt, speed * 0.5 * dt);
      this.setFlipX(true);
      moved = true;
    } else {
      this.setFlipX(true);
      this.attack(dt, () => hitBlock(this.def.damage, this.footY), -1);
    }

    // 不能穿過路障
    this.footX = Math.max(minX, this.footX);
    this.footY = clampLaneY(this.footY);
    if (moved) {
      this.attackTimer = 0;
      if (this.anims.currentAnim?.key !== this.walkKey && this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      this.walkPhase += dt * (4 + this.speedNow * 0.12);
    } else if (this.anims.currentAnim?.key === this.walkKey) {
      // 停下來攻擊：不再原地踏步，回到站姿
      this.anims.stop();
      this.setFrame(0);
    }
    this.sync(moved ? 1 : 0, dt);
  }

  /** 原地走路（圖鑑用）：只更新動態與頭飾，不移動 */
  idle(dt: number): void {
    if (this.dead) return;
    this.updateAbilities(dt, {} as ZombieContext);
    this.walkPhase += dt * (4 + this.speedNow * 0.12);
    this.sync(1, dt);
  }

  // ───────────────────── 動物行為 ─────────────────────

  private startPounce(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy) || 1;
    this.pounceT = POUNCE.time;
    this.pounceVx = (dx / d) * POUNCE.speed;
    this.pounceVy = (dy / d) * POUNCE.speed * 0.7;
    this.pounceHit = false;
    this.pounceCd = POUNCE.cooldown;
    this.anims.stop();
    this.setFrame(5);
    this.setFlipX(dx < 0);
    GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
  }

  /** 撲咬中：沿直線飛撲，途中碰到目標咬一口（傷害加成），落地後回到一般行為 */
  private updatePounce(dt: number, ctx: ZombieContext): void {
    this.pounceT -= dt;
    this.footX += this.pounceVx * dt;
    this.footY = clampLaneY(this.footY + this.pounceVy * dt);
    if (!this.pounceHit) {
      for (const t of this.targets(ctx)) {
        if (!t.alive || t.x < ctx.blockX) continue;
        if (Math.abs(t.x - this.footX) <= REACH_X && Math.abs(t.y - this.footY) <= REACH_Y + 4) {
          t.hit(this.def.damage * POUNCE.damageMul, this.footX, this.footY);
          this.pounceHit = true;
          break;
        }
      }
    }
    // 不能撲過路障
    this.footX = Math.max(ctx.blockX + 18 * this.s, this.footX);
    // 撲的時候身體離地一點
    this.lunge = 0;
    this.sync(0, dt);
    this.y -= Math.sin((1 - this.pounceT / POUNCE.time) * Math.PI) * 6;
    if (this.pounceT <= 0) {
      this.pounceT = 0;
      if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
    }
  }

  /**
   * 屍鴉：無視路障，在高空飛向最近的人（主角或夥伴），靠近後俯衝啄一下再拉高飛走，循環。
   * 主角躲在路障後面也會被啄，要抬高槍口打牠。
   */
  private updateCrow(dt: number, ctx: ZombieContext): void {
    const live = this.targets(ctx).filter((t) => t.alive);
    let tgt: ZombieTarget | null = null;
    let bestD = Infinity;
    for (const t of live) {
      const d = Math.hypot(t.x - this.footX, t.y - this.footY);
      if (d < bestD) {
        bestD = d;
        tgt = t;
      }
    }
    const speed = this.speedNow * this.speedJitter;
    const towards = (tx: number, ty: number, v: number) => {
      const dx = tx - this.footX;
      const dy = ty - this.footY;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, v * dt);
      this.footX += (dx / d) * step;
      this.footY = clampLaneY(this.footY + (dy / d) * step);
      if (Math.abs(dx) > 1) this.setFlipX(dx < 0);
    };
    const climb = (alt: number, rate: number) => {
      this.alt += Phaser.Math.Clamp(alt - this.alt, -rate * dt, rate * dt);
    };
    this.crowTimer -= dt;
    if (!tgt) {
      // 沒人可啄：在原地盤旋
      climb(CROW.cruiseAlt, 40);
      this.footX += Math.cos(this.walkPhase) * 20 * dt;
    } else if (this.crowState === 'approach') {
      climb(CROW.cruiseAlt, 40);
      towards(tgt.x + (this.footX > tgt.x ? 30 : -30), tgt.y, speed);
      if (Math.abs(tgt.x - this.footX) < 46 && this.crowTimer <= 0) {
        this.crowState = 'dive';
        this.anims.stop();
        this.setFrame(4);
      }
    } else if (this.crowState === 'dive') {
      climb(CROW.strikeAlt, CROW.diveSpeed);
      towards(tgt.x, tgt.y, CROW.diveSpeed);
      if (this.alt <= CROW.strikeAlt + 4 && Math.abs(tgt.x - this.footX) < 12 && Math.abs(tgt.y - this.footY) < 10) {
        tgt.hit(this.def.damage, this.footX, this.footY);
        GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
        this.crowState = 'retreat';
        this.crowTimer = CROW.retreatTime;
        if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      } else if (this.alt <= CROW.strikeAlt + 1 && Math.abs(tgt.x - this.footX) > 40) {
        // 撲空：拉高重來
        this.crowState = 'retreat';
        this.crowTimer = CROW.retreatTime * 0.6;
        if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      }
    } else {
      climb(CROW.cruiseAlt, 70);
      const away = this.footX < tgt.x ? -1 : 1;
      this.footX = Phaser.Math.Clamp(this.footX + away * speed * dt, 20, 1260);
      this.setFlipX(away < 0);
      if (this.crowTimer <= 0) {
        this.crowState = 'approach';
        this.crowTimer = this.attackIntervalNow;
      }
    }
    this.walkPhase += dt * 6;
    this.sync(1, dt);
  }

  private targets(ctx: ZombieContext): ZombieTarget[] {
    const pl = ctx.player;
    return [{ x: pl.x, y: pl.y, alive: pl.alive, hit: ctx.hitPlayer }, ...(ctx.others ?? [])];
  }

  /** 擋路線外側、仇恨範圍內最近的目標；沒有就回傳 null */
  private pickTarget(ctx: ZombieContext): ZombieTarget | null {
    const list = this.targets(ctx);
    let best: ZombieTarget | null = null;
    // 探索戰鬥會把 aggroRange 設很大；屍犬本來就看得比較遠
    let bestD = Math.max(ctx.aggroRange ?? 0, this.spec.body === 'dog' ? POUNCE.aggro : AGGRO_RANGE);
    for (const t of list) {
      if (!t.alive || t.x < ctx.blockX) continue;
      const d = Math.hypot(t.x - this.footX, (t.y - this.footY) * 1.6);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private attack(dt: number, hit: () => void, dir: number): void {
    this.attackTimer += dt;
    if (this.attackTimer >= this.attackIntervalNow) {
      this.attackTimer = 0;
      hit();
      GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
      if (this.scene.anims.exists(this.attackKey)) this.play(this.attackKey);
      // 攻擊時往前撲一下
      this.lunge = 3 * dir;
      this.scene.time.delayedCall(60, () => (this.lunge = 0));
    }
  }

  /** 職業能力與變異：再生、護理師光環 */
  private updateAbilities(dt: number, ctx: ZombieContext): void {
    this.sinceHit += dt;
    if (this.spec.regen > 0 && this.sinceHit > 2 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.spec.regen * dt);
      if (Math.random() < dt * 3) Fx.of(this.scene)?.popText(this.footX, this.footY - 50 * this.s, '+', '#4affb0');
    }
    if (this.spec.profession.ability === 'heal_aura' && ctx.zombies) {
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = HEAL_AURA.interval;
        let n = 0;
        for (const z of ctx.zombies) {
          if (z === this || z.dead || z.hp >= z.maxHp) continue;
          if (Math.hypot(z.footX - this.footX, (z.footY - this.footY) * 1.6) > HEAL_AURA.radius) continue;
          z.hp = Math.min(z.maxHp, z.hp + HEAL_AURA.amount);
          Fx.of(this.scene)?.popText(z.footX, z.footY - 52 * z.s, '+', '#7aff9a');
          n++;
        }
        if (n > 0) {
          this.healPulse();
          GameEvents.of(this.scene).emit('enemy:heal', { enemyId: this.def.id, x: this.footX, y: this.footY, targets: n });
        }
      }
    }
  }

  private healPulse(): void {
    const ring = this.scene.add
      .ellipse(this.footX, this.footY, 8, 4)
      .setStrokeStyle(1, 0x7aff9a, 0.8)
      .setDepth(this.depth - 0.02);
    this.scene.tweens.add({
      targets: ring,
      width: HEAL_AURA.radius * 2,
      height: HEAL_AURA.radius * 1.25,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 互相推開：兩隻在地面上太近時沿著彼此的方向各退一半，
   * 屍群會沿著柵欄散成一排、圍住主角時也會散成一圈，而不是疊成一團。
   * 地面距離把 y 放大計算（前後方向較「擠」），由場景每幀對所有霧屍兩兩呼叫。
   */
  static separate(a: Zombie, b: Zombie): void {
    if (a.dead || b.dead) return;
    // 飛在天上的不推擠
    if (a.spec.body === 'crow' || b.spec.body === 'crow') return;
    const Y_WEIGHT = 2;
    const dx = b.footX - a.footX;
    const dy = (b.footY - a.footY) * Y_WEIGHT;
    const minDist = 14 * Math.max(a.s, b.s);
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) return;
    let nx: number;
    let ny: number;
    if (dist < 0.01) {
      const r = Math.random() * Math.PI * 2;
      nx = Math.cos(r);
      ny = Math.sin(r);
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }
    const push = (minDist - dist) / 2;
    a.footX -= nx * push;
    b.footX += nx * push;
    a.footY = clampLaneY(a.footY - (ny * push) / Y_WEIGHT);
    b.footY = clampLaneY(b.footY + (ny * push) / Y_WEIGHT);
    a.laneY = a.footY;
    b.laneY = b.footY;
  }

  /**
   * 擺位與程式化動態：走路時上下顛簸＋前後搖晃，停下時身體微微起伏，
   * 再疊上被打中的後仰。有影格動畫時只留很小的搖晃，避免和步伐打架。
   */
  private sync(walking: number, dt = 0): void {
    this.x = this.footX + this.lunge;
    if (this.spec.body === 'crow') {
      // 飛行：位置在空中，地上留一個隨高度變小的影子；畫在地面角色之上
      this.y = this.footY - this.alt + Math.sin(this.walkPhase * 2) * 1.5;
      this.angle = this.hitLean;
      this.setDepth(depthForY(this.footY) + 25);
      const k = Phaser.Math.Clamp(1 - this.alt / 120, 0.3, 1);
      this.crowShadow?.setPosition(this.footX, this.footY).setScale(k).setDepth(depthForY(this.footY) - 0.5);
      this.syncGear();
      return;
    }
    if (walking) {
      this.y = this.footY - Math.abs(Math.sin(this.walkPhase)) * this.s;
      this.angle = Math.sin(this.walkPhase) * (this.anims.isPlaying ? 1.5 : 4) + this.hitLean;
    } else {
      this.y = this.footY;
      this.angle = Math.sin((this.walkPhase += dt * 3)) * 1.5 + this.hitLean;
    }
    this.setDepth(depthForY(this.footY));
    this.syncGear();
  }

  /**
   * 護甲結算：回傳實際扣血量。爆頭打頭盔、打身體打防彈背心，再套天生減傷（消防衣、硬皮）。
   * 減傷用 src/combat/Damage.ts 的 armorAfter()：護甲 × 傷害類型係數 − 穿甲
   * （霰彈對護甲最無力、鈍器與爆炸無視部分護甲）。被吸收的傷害扣在裝備耐久上，歸零就壞掉。
   */
  private mitigate(amount: number, info: HitInfo): number {
    const pen = info.penetration ?? 0;
    const blast = info.type === 'blast';
    const bus = GameEvents.of(this.scene);
    const fx = Fx.of(this.scene);
    const dir = Math.sign(info.dirX ?? 1) || 1;
    let dmg = amount;
    if (info.headshot && !blast && this.helmet) {
      const piece = this.helmet;
      const a = armorAfter(piece.armor, info.type, pen);
      const absorbed = dmg * a;
      dmg -= absorbed;
      // 鈍擊特別容易把頭盔敲飛
      piece.hp -= absorbed * (info.type === 'blunt' ? 2 : 1) + 1;
      const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
      fx?.sparks(hp.x, hp.y + 3, info.dirX ?? 1, this.footY, 5);
      const broke = piece.hp <= 0;
      if (broke) this.knockOffHat(dir, 1.2);
      bus.emit('enemy:armor', { enemyId: this.def.id, x: hp.x, y: hp.y, part: 'helmet', broke });
    } else if (!info.headshot || blast) {
      if (this.vest) {
        const piece = this.vest;
        const a = armorAfter(piece.armor, info.type, pen);
        const absorbed = dmg * a;
        dmg -= absorbed;
        piece.hp -= absorbed;
        const broke = piece.hp <= 0;
        if (broke) {
          this.vest = null;
          fx?.popText(this.footX, this.footY - 44 * this.s, '破甲', '#c8d8ff');
        }
        if (a > 0) {
          fx?.sparks(this.footX, this.footY - 30 * this.s, info.dirX ?? 1, this.footY, 3);
          bus.emit('enemy:armor', { enemyId: this.def.id, x: this.footX, y: this.footY - 30 * this.s, part: 'vest', broke });
        }
      }
      const body = armorAfter(this.spec.bodyArmor, info.type, pen);
      dmg *= 1 - body;
    }
    return dmg;
  }

  /** 頭飾飛走（頭盔被打爆，或死亡時掉落） */
  private knockOffHat(dir: number, power = 1): void {
    if (!this.hat) return;
    const fx = Fx.of(this.scene);
    const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
    if (fx) {
      fx.fling(GEAR_TEXTURE, this.spec.hat, hp.x, hp.y - 2, dir, this.footY + Phaser.Math.Between(-3, 3), {
        scale: this.s,
        tint: this.spec.hatTint,
        flipX: this.flipX,
        power,
      });
    }
    this.hat.destroy();
    this.hat = null;
    this.helmet = null;
  }

  /** 正在硬直（近戰處決、子彈打暈） */
  get stunned(): boolean {
    return this.stunTimer > 0;
  }

  /**
   * 子彈打到這裡會不會被擋下、不再往後穿：看這一槍打到的部位剩多少護甲（≥ 30% 就停）。
   * 只是預判，不會扣裝備耐久。
   */
  stopsBullet(info: Pick<DamageInfo, 'type' | 'penetration' | 'headshot'>): boolean {
    const raw = info.headshot ? (this.helmet?.armor ?? 0) : Math.max(this.vest?.armor ?? 0, this.spec.bodyArmor);
    return armorAfter(raw, info.type, info.penetration) >= 0.3;
  }

  /** 武器的統一入口：先上硬直（已含職業抗性），再交給 takeDamage 扣血與結算護甲 */
  takeHit(info: DamageInfo): boolean {
    if (this.dead) return false;
    if (info.stagger > 0) this.stagger(info.stagger);
    return this.takeDamage(info.amount, info.knockback, {
      headshot: info.headshot,
      dirX: info.dirX,
      type: info.type,
      penetration: info.penetration,
    });
  }

  takeDamage(amount: number, knockback: number, info: HitInfo = {}): boolean {
    if (this.dead) return false;
    const dealt = this.mitigate(amount, info);
    this.hp -= dealt;
    this.sinceHit = 0;
    this.footX += knockback * (1 - this.spec.knockbackResist) * Math.sign(info.dirX ?? 1);
    this.x = this.footX;
    const fx = Fx.of(this.scene);
    if (this.hp <= 0) {
      this.dead = true;
      const dir = (info.dirX ?? 1) >= 0 ? 1 : -1;
      GameEvents.of(this.scene).emit('enemy:death', { enemyId: this.def.id, x: this.footX, y: this.footY, headshot: !!info.headshot });
      // 倒下時頭飾一定掉
      this.knockOffHat(dir, info.headshot ? 1.3 : 0.7);
      this.mark?.destroy();
      this.mark = null;
      if (this.spec.burst) {
        const b = BURST[this.spec.burst];
        fx?.burst(this.footX, this.footY - 24 * this.s, this.footY, b.radius);
        GameEvents.of(this.scene).emit('enemy:burst', {
          enemyId: this.def.id,
          x: this.footX,
          y: this.footY,
          radius: b.radius,
          damage: b.damage,
        });
      }
      this.restoreTint();
      this.y = this.footY;
      if (fx && this.spec.body === 'crow') {
        // 屍鴉：從空中墜落，落地躺著
        fx.fling(this.texture.key, '6', this.x, this.y, dir, this.footY, { scale: this.s, flipX: this.flipX, power: 0.25 });
        fx.blood(this.x, this.y, dir, this.footY, 6, 0.6);
        this.destroy();
      } else if (fx && this.spec.body !== 'human') {
        // 屍犬、屍熊：身體是橫的，一律播倒地影格
        fx.fall(this, { dir, headshot: false, deathAnim: `${this.def.texture}_death`, forceAnim: true });
        this.destroy();
      } else if (fx) {
        // 程式化倒地：複製當下影格成屍體，自己立刻移除
        const frame = this.frame.name;
        fx.fall(this, {
          dir,
          headshot: !!info.headshot,
          headFrame: this.texture.has(`head_${frame}`) ? `head_${frame}` : undefined,
          neckRow: ZOMBIE_NECK_ROW,
          deathAnim: `${this.def.texture}_death`,
        });
        this.destroy();
      } else {
        this.scene.tweens.add({ targets: this, angle: 90, alpha: 0, duration: 350, onComplete: () => this.destroy() });
      }
      return true;
    }
    // 囚犯：血量過半暴走
    if (this.spec.profession.ability === 'enrage' && !this.enraged && this.hp < this.maxHp * ENRAGE.below) {
      this.enraged = true;
      fx?.popText(this.footX, this.footY - 56 * this.s, '暴走', '#ff6a5a');
      GameEvents.of(this.scene).emit('enemy:enrage', { enemyId: this.def.id, x: this.footX, y: this.footY });
      if (this.anims.isPlaying) this.anims.timeScale *= ENRAGE.speedMul;
    }
    // 受擊：閃白 + 擠壓 + 往後一仰
    this.setTintFill(0xffffff);
    this.hat?.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.active && this.restoreTint());
    fx?.squash(this, this.s, info.headshot ? 1.4 : 1, this.s * (this.spec.widthMul ?? 1));
    this.hitLean = (info.headshot ? 12 : 7) * Math.sign(info.dirX ?? 1) * (1 - this.spec.knockbackResist * 0.5);
    return false;
  }
}
