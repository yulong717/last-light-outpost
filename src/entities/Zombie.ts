import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import type { EnemyDef } from '../data/enemies';

/** 霧屍每幀需要知道的戰場資訊 */
export interface ZombieContext {
  /** 擋路的那條線（路障或據點外牆）的 x；霧屍不能越過 */
  blockX: number;
  /** 撞到擋路線時的攻擊 */
  hitBlock: (damage: number) => void;
  player: { x: number; y: number; alive: boolean };
  hitPlayer: (damage: number) => void;
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
  dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number, def: EnemyDef) {
    super(scene, x, y, def.texture);
    this.def = def;
    this.hp = def.hp;
    this.footX = x;
    this.footY = clampLaneY(y);
    this.laneY = this.footY;
    // 走路圖的腳底在 64 格中的第 62 列
    this.setOrigin(0.5, this.scene.anims.exists('zombie_walk') ? 62 / 64 : 1);
    // 美術素材朝右繪製，霧屍預設往左走所以水平翻轉
    this.setFlipX(true);
    if (def.scale) this.setScale(def.scale);
    this.restoreTint();
    if (scene.anims.exists('zombie_walk')) {
      this.play({ key: 'zombie_walk', startFrame: Phaser.Math.Between(0, 3) });
      // 跑得快的步伐也快
      this.anims.timeScale = Phaser.Math.Clamp(def.speed / 18, 0.6, 2);
    }
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
    this.sync(0);
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
    const minX = ctx.blockX + 18 * this.s;
    const speed = this.def.speed * this.speedJitter;
    const p = ctx.player;

    // 主角在擋路線外側、而且夠近 → 改追主角（2D 追擊）
    const dx = p.x - this.footX;
    const dy = p.y - this.footY;
    const chasing = p.alive && p.x >= ctx.blockX && Math.hypot(dx, dy * 1.6) < AGGRO_RANGE;

    let moved = false;
    if (chasing) {
      // 站到主角的左邊或右邊，而不是疊在主角身上
      const side = dx >= 0 ? -1 : 1;
      const tx = p.x + side * (REACH_X - 4);
      const ex = tx - this.footX;
      const ey = dy;
      if (Math.abs(dx) <= REACH_X && Math.abs(dy) <= REACH_Y) {
        this.attack(dt, ctx.hitPlayer, Math.sign(dx) || -1);
      } else {
        const d = Math.hypot(ex, ey) || 1;
        // 前後（y）移動比左右慢，和主角一樣做出縱深感
        this.footX += (ex / d) * speed * dt;
        this.footY += (ey / d) * speed * 0.7 * dt;
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
      this.attack(dt, ctx.hitBlock, -1);
    }

    // 不能穿過路障
    this.footX = Math.max(minX, this.footX);
    this.footY = clampLaneY(this.footY);
    if (moved) {
      this.attackTimer = 0;
      this.walkPhase += dt * (4 + this.def.speed * 0.12);
    }
    this.sync(moved ? 1 : 0);
  }

  private attack(dt: number, hit: (d: number) => void, dir: number): void {
    this.attackTimer += dt;
    if (this.attackTimer >= this.def.attackInterval) {
      this.attackTimer = 0;
      hit(this.def.damage);
      // 攻擊時往前撲一下
      this.lunge = 3 * dir;
      this.scene.time.delayedCall(60, () => (this.lunge = 0));
    }
  }

  private lunge = 0;

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
   * 擺位與程式化走路動態：上下顛簸＋前後搖晃。
   * 有正式影格動畫時只留很小的搖晃，避免和步伐打架。
   */
  private sync(walking: number): void {
    this.x = this.footX + this.lunge;
    this.y = this.footY - Math.abs(Math.sin(this.walkPhase)) * 1 * this.s * walking;
    this.angle = walking ? Math.sin(this.walkPhase) * (this.anims.isPlaying ? 1.5 : 4) : 0;
    this.setDepth(depthForY(this.footY));
  }

  takeDamage(amount: number, knockback: number, dirX = 1): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.footX += knockback * dirX;
    this.x = this.footX;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.restoreTint());
    if (this.hp <= 0) {
      this.dead = true;
      this.scene.tweens.add({
        targets: this,
        angle: 90 * (this.flipX ? 1 : -1),
        alpha: 0,
        duration: 350,
        onComplete: () => this.destroy(),
      });
      return true;
    }
    return false;
  }
}
