import Phaser from 'phaser';
import { GROUND_Y } from '../config';
import type { EnemyDef } from '../data/enemies';
import { Fx } from '../fx/Fx';
import { ZOMBIE_NECK_ROW } from '../art/sprites';

/** 受擊資訊：給程式化動畫決定怎麼反應 */
export interface HitInfo {
  headshot?: boolean;
  /** 子彈飛行方向的 x 分量（-1..1），決定血往哪噴、往哪倒 */
  dirX?: number;
}

export type ZombieTarget = { frontX: number; hit: (damage: number) => void };

export class Zombie extends Phaser.GameObjects.Sprite {
  readonly def: EnemyDef;
  hp: number;
  private attackTimer = 0;
  private speedJitter: number;
  /** 走路動態用的相位，讓每隻步伐不同步 */
  private walkPhase = Math.random() * Math.PI * 2;
  dead = false;
  private walkKey: string;
  /** 被打中時往後仰的角度，逐漸回正 */
  private hitLean = 0;
  private attackKey: string;

  constructor(scene: Phaser.Scene, x: number, def: EnemyDef) {
    super(scene, x, GROUND_Y, def.texture);
    this.def = def;
    this.hp = def.hp;
    this.walkKey = `${def.texture}_walk`;
    this.attackKey = `${def.texture}_attack`;
    // 走路圖的腳底在 64 格中的第 62 列
    this.setOrigin(0.5, scene.anims.exists(this.walkKey) ? 62 / 64 : 1);
    // 美術素材朝右繪製，霧屍往左走所以水平翻轉
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
    Fx.of(scene)?.attachShadow(this, 22 * (def.scale ?? 1));
  }

  private restoreTint(): void {
    if (this.def.tint) this.setTint(this.def.tint);
    else this.clearTint();
  }

  /**
   * 命中判定框：走路圖的影格四周有透明邊，所以不用整張圖的外框，
   * 只取身體所在的中間區域。
   */
  getHitRect(): Phaser.Geom.Rectangle {
    const s = this.def.scale ?? 1;
    const w = 30 * s;
    const h = 56 * s;
    return new Phaser.Geom.Rectangle(this.x - w / 2, this.y - h, w, h);
  }

  /** 頭部區域：判定框上方 25% */
  isHeadshot(hitY: number): boolean {
    const r = this.getHitRect();
    return hitY <= r.y + r.height * 0.25;
  }

  update(dt: number, target: ZombieTarget): void {
    if (this.dead) return;
    this.hitLean *= Math.max(0, 1 - dt * 12);
    const stopX = target.frontX + 18 * (this.def.scale ?? 1);
    if (this.x > stopX) {
      this.x = Math.max(stopX, this.x - this.def.speed * this.speedJitter * dt);
      this.attackTimer = 0;
      if (this.anims.currentAnim?.key !== this.walkKey && this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      this.animateWalk(dt);
    } else {
      // 停在路障前：不再原地踏步，回到站姿、身體微微起伏
      if (this.anims.currentAnim?.key === this.walkKey) {
        this.anims.stop();
        this.setFrame(0);
      }
      this.angle = Math.sin((this.walkPhase += dt * 3)) * 1.5 + this.hitLean;
      this.attackTimer += dt;
      if (this.attackTimer >= this.def.attackInterval) {
        this.attackTimer = 0;
        target.hit(this.def.damage);
        if (this.scene.anims.exists(this.attackKey)) this.play(this.attackKey);
        // 攻擊時往前撲一下
        this.scene.tweens.add({ targets: this, x: this.x - 3, duration: 60, yoyo: true });
      }
    }
  }

  /**
   * 程式化走路動態（暫代正式影格動畫）：上下顛簸＋前後搖晃。
   * 之後換成 PixelLab / Aseprite 的走路影格時，刪掉這段改播動畫即可。
   */
  private animateWalk(dt: number): void {
    this.walkPhase += dt * (4 + this.def.speed * 0.12);
    const s = this.def.scale ?? 1;
    this.y = GROUND_Y - Math.abs(Math.sin(this.walkPhase)) * 1 * s;
    // 有影格動畫時只留很小的搖晃，避免和步伐打架
    this.angle = Math.sin(this.walkPhase) * (this.anims.isPlaying ? 1.5 : 4) + this.hitLean;
  }

  takeDamage(amount: number, knockback: number, info: HitInfo = {}): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.x += knockback;
    const fx = Fx.of(this.scene);
    if (this.hp <= 0) {
      this.dead = true;
      this.restoreTint();
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
    fx?.squash(this, this.def.scale ?? 1, info.headshot ? 1.4 : 1);
    this.hitLean = (info.headshot ? 12 : 7) * Math.sign(info.dirX ?? 1);
    return false;
  }
}
