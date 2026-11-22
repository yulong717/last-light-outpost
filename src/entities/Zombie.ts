import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import type { EnemyDef } from '../data/enemies';
import { Fx } from '../fx/Fx';
import { ZOMBIE_NECK_ROW } from '../art/sprites';
import { GameEvents } from '../systems/GameEvents';

/** 受擊資訊：給程式化動畫決定怎麼反應 */
export interface HitInfo {
  headshot?: boolean;
  /** 子彈飛行方向的 x 分量（-1..1），決定血往哪噴、往哪倒、往哪退 */
  dirX?: number;
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
  hp: number;
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

  constructor(scene: Phaser.Scene, x: number, y: number, def: EnemyDef) {
    super(scene, x, y, def.texture);
    this.def = def;
    this.hp = def.hp;
    this.footX = x;
    this.footY = clampLaneY(y);
    this.laneY = this.footY;
    this.walkKey = `${def.texture}_walk`;
    this.attackKey = `${def.texture}_attack`;
    // 走路圖的腳底在 64 格中的第 62 列
    this.setOrigin(0.5, scene.anims.exists(this.walkKey) ? 62 / 64 : 1);
    // 美術素材朝右繪製，霧屍預設往左走所以水平翻轉
    this.setFlipX(true);
    if (def.scale) this.setScale(def.scale);
    this.restoreTint();
    if (scene.anims.exists(this.walkKey)) {
      this.play({ key: this.walkKey, startFrame: Phaser.Math.Between(0, 3) });
      // 跑得快的步伐也快
      this.anims.timeScale = Phaser.Math.Clamp(def.speed / 18, 0.6, 2);
    }
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
    this.sync(0);
    Fx.of(scene)?.attachShadow(this, 22 * this.s);
    GameEvents.of(scene).emit('enemy:spawn', { enemyId: def.id, x, y: this.footY });
  }

  private get s(): number {
    return this.def.scale ?? 1;
  }

  private restoreTint(): void {
    if (this.def.tint) this.setTint(this.def.tint);
    else this.clearTint();
  }

  /**
   * 命中判定框：走路圖的影格四周有透明邊，所以不用整張圖的外框，
   * 只取身體所在的中間區域。以腳底為準，不受走路顛簸影響。
   */
  getHitRect(): Phaser.Geom.Rectangle {
    const w = 30 * this.s;
    const h = 56 * this.s;
    return new Phaser.Geom.Rectangle(this.footX - w / 2, this.footY - h, w, h);
  }

  /** 頭部區域：判定框上方 25% */
  isHeadshot(hitY: number): boolean {
    const r = this.getHitRect();
    return hitY <= r.y + r.height * 0.25;
  }

  update(dt: number, ctx: ZombieContext): void {
    if (this.dead) return;
    this.groanIn -= dt;
    if (this.groanIn <= 0) {
      this.groanIn = 4 + Math.random() * 8;
      GameEvents.of(this.scene).emit('enemy:groan', { enemyId: this.def.id, x: this.footX, y: this.footY });
    }
    this.hitLean *= Math.max(0, 1 - dt * 12);
    const blk = ctx.blockerFor?.(this.footX, this.footY);
    const blockX = blk ? blk.blockX : ctx.blockX;
    const hitBlock = blk ? blk.hit : ctx.hitBlock;
    const minX = blockX + 18 * this.s;
    const speed = this.def.speed * this.speedJitter * (ctx.speedMul?.(this.footX, this.footY) ?? 1);
    // 主角或夥伴在擋路線外側、而且夠近 → 改追最近的那個（2D 追擊）
    const p = this.pickTarget(ctx);
    const dx = p ? p.x - this.footX : 0;
    const dy = p ? p.y - this.footY : 0;

    let moved = false;
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
      // 往擋路線前進，同時慢慢回到自己的 y
      this.footX = Math.max(minX, this.footX - speed * dt);
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
      this.walkPhase += dt * (4 + this.def.speed * 0.12);
    } else if (this.anims.currentAnim?.key === this.walkKey) {
      // 停下來攻擊：不再原地踏步，回到站姿
      this.anims.stop();
      this.setFrame(0);
    }
    this.sync(moved ? 1 : 0, dt);
  }

  /** 擋路線外側、仇恨範圍內最近的目標；沒有就回傳 null */
  private pickTarget(ctx: ZombieContext): ZombieTarget | null {
    const pl = ctx.player;
    const list: ZombieTarget[] = [{ x: pl.x, y: pl.y, alive: pl.alive, hit: ctx.hitPlayer }, ...(ctx.others ?? [])];
    let best: ZombieTarget | null = null;
    let bestD = AGGRO_RANGE;
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
    if (this.attackTimer >= this.def.attackInterval) {
      this.attackTimer = 0;
      hit();
      GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
      if (this.scene.anims.exists(this.attackKey)) this.play(this.attackKey);
      // 攻擊時往前撲一下
      this.lunge = 3 * dir;
      this.scene.time.delayedCall(60, () => (this.lunge = 0));
    }
  }

  /**
   * 互相推開：兩隻在地面上太近時沿著彼此的方向各退一半，
   * 屍群會沿著柵欄散成一排、圍住主角時也會散成一圈，而不是疊成一團。
   * 地面距離把 y 放大計算（前後方向較「擠」），由場景每幀對所有霧屍兩兩呼叫。
   */
  static separate(a: Zombie, b: Zombie): void {
    if (a.dead || b.dead) return;
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
    if (walking) {
      this.y = this.footY - Math.abs(Math.sin(this.walkPhase)) * this.s;
      this.angle = Math.sin(this.walkPhase) * (this.anims.isPlaying ? 1.5 : 4) + this.hitLean;
    } else {
      this.y = this.footY;
      this.angle = Math.sin((this.walkPhase += dt * 3)) * 1.5 + this.hitLean;
    }
    this.setDepth(depthForY(this.footY));
  }

  takeDamage(amount: number, knockback: number, info: HitInfo = {}): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.footX += knockback * Math.sign(info.dirX ?? 1);
    this.x = this.footX;
    const fx = Fx.of(this.scene);
    if (this.hp <= 0) {
      this.dead = true;
      GameEvents.of(this.scene).emit('enemy:death', { enemyId: this.def.id, x: this.footX, y: this.footY, headshot: !!info.headshot });
      this.restoreTint();
      this.y = this.footY;
      if (fx) {
        // 程式化倒地：複製當下影格成屍體，自己立刻移除
        const frame = this.frame.name;
        fx.fall(this, {
          dir: (info.dirX ?? 1) >= 0 ? 1 : -1,
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
    // 受擊：閃白 + 擠壓 + 往後一仰
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.active && this.restoreTint());
    fx?.squash(this, this.s, info.headshot ? 1.4 : 1);
    this.hitLean = (info.headshot ? 12 : 7) * Math.sign(info.dirX ?? 1);
    return false;
  }
}
