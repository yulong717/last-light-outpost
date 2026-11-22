import Phaser from 'phaser';
import { GROUND_Y } from '../config';
import { BARRICADE_FRAMES } from '../art/ProceduralArt';
import { Fx } from '../fx/Fx';

export class Barricade extends Phaser.GameObjects.Image {
  hp: number;
  maxHp: number;

  constructor(scene: Phaser.Scene, x: number, maxHp: number) {
    super(scene, x, GROUND_Y, 'barricade', 0);
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
    // 依耐久切換損壞階段的影格（ProceduralArt 用程式畫的 3 格）
    const ratio = this.hp / this.maxHp;
    if (this.texture.frameTotal > BARRICADE_FRAMES) {
      this.setFrame(Math.min(BARRICADE_FRAMES - 1, Math.floor((1 - ratio) * BARRICADE_FRAMES)));
    } else {
      this.setAlpha(0.35 + 0.65 * ratio);
    }
    // 被打：木屑飛濺 + 晃一下
    const fx = Fx.of(this.scene);
    fx?.woodChips(this.frontX - 2, this.y - this.displayHeight / 2, this.y, 4);
    this.scene.tweens.add({ targets: this, angle: Phaser.Math.FloatBetween(-3, 3), duration: 50, yoyo: true });
    if (!this.alive) {
      fx?.woodChips(this.x, this.y - this.displayHeight / 2, this.y, 18);
      this.scene.tweens.add({ targets: this, alpha: 0, scaleY: 0.2, duration: 250 });
    }
  }
}
