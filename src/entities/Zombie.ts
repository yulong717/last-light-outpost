import Phaser from 'phaser';
import { GROUND_Y } from '../config';
import type { EnemyDef } from '../data/enemies';

export type ZombieTarget = { frontX: number; hit: (damage: number) => void };

export class Zombie extends Phaser.GameObjects.Image {
  readonly def: EnemyDef;
  hp: number;
  private attackTimer = 0;
  private speedJitter: number;
  /** 走路動態用的相位，讓每隻步伐不同步 */
  private walkPhase = Math.random() * Math.PI * 2;
  dead = false;

  constructor(scene: Phaser.Scene, x: number, def: EnemyDef) {
    super(scene, x, GROUND_Y, def.texture);
    this.def = def;
    this.hp = def.hp;
    this.setOrigin(0.5, 1);
    // 美術素材朝右繪製，霧屍往左走所以水平翻轉
    this.setFlipX(true);
    if (def.scale) this.setScale(def.scale);
    this.restoreTint();
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
  }

  private restoreTint(): void {
    if (this.def.tint) this.setTint(this.def.tint);
    else this.clearTint();
  }

  /** 頭部區域：上方 30% */
  isHeadshot(hitY: number): boolean {
    const top = this.y - this.displayHeight;
    return hitY <= top + this.displayHeight * 0.3;
  }

  update(dt: number, target: ZombieTarget): void {
    if (this.dead) return;
    const stopX = target.frontX + this.displayWidth / 2;
    if (this.x > stopX) {
      this.x = Math.max(stopX, this.x - this.def.speed * this.speedJitter * dt);
      this.attackTimer = 0;
      this.animateWalk(dt);
    } else {
      this.attackTimer += dt;
      if (this.attackTimer >= this.def.attackInterval) {
        this.attackTimer = 0;
        target.hit(this.def.damage);
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
    this.y = GROUND_Y - Math.abs(Math.sin(this.walkPhase)) * 2 * s;
    this.angle = Math.sin(this.walkPhase) * 4;
  }

  takeDamage(amount: number, knockback: number): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.x += knockback;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.restoreTint());
    if (this.hp <= 0) {
      this.dead = true;
      this.scene.tweens.add({
        targets: this,
        angle: 90,
        alpha: 0,
        duration: 350,
        onComplete: () => this.destroy(),
      });
      return true;
    }
    return false;
  }
}
