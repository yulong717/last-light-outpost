import Phaser from 'phaser';
import { GROUND_Y } from '../config';

export class Barricade extends Phaser.GameObjects.Image {
  hp: number;
  maxHp: number;

  constructor(scene: Phaser.Scene, x: number, maxHp: number) {
    super(scene, x, GROUND_Y, 'barricade');
    this.setOrigin(0.5, 1);
    this.maxHp = maxHp;
    this.hp = maxHp;
    scene.add.existing(this);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** 擋住敵人的最右邊 x */
  get frontX(): number {
    return this.x + this.displayWidth / 2;
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    // 越破越透明，之後換成多張損壞階段的像素圖
    this.setAlpha(0.35 + 0.65 * (this.hp / this.maxHp));
    if (!this.alive) {
      this.scene.tweens.add({ targets: this, alpha: 0, scaleY: 0.2, duration: 250 });
    }
  }
}
