import Phaser from 'phaser';
import { GROUND_Y } from '../config';
import type { EnemyDef } from '../data/enemies';

export type ZombieTarget = { frontX: number; hit: (damage: number) => void };

export class Zombie extends Phaser.GameObjects.Image {
  readonly def: EnemyDef;
  hp: number;
  private attackTimer = 0;
  private speedJitter: number;
  dead = false;

  constructor(scene: Phaser.Scene, x: number, def: EnemyDef) {
    super(scene, x, GROUND_Y, def.texture);
    this.def = def;
    this.hp = def.hp;
    this.setOrigin(0.5, 1);
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
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

  takeDamage(amount: number, knockback: number): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.x += knockback;
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.clearTint());
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
