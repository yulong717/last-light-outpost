import Phaser from 'phaser';
import { LANE_BOTTOM, LANE_TOP, depthForY } from '../config';

/**
 * 路障：沿著地面帶由遠到近排成一道柵欄，擋住整條戰線。
 * 耐久共用一條血量；每一段只是視覺，各自依腳底 y 排序深度。
 */
export class Barricade {
  readonly x: number;
  hp: number;
  maxHp: number;
  private segments: Phaser.GameObjects.Image[] = [];

  constructor(private scene: Phaser.Scene, x: number, maxHp: number) {
    this.x = x;
    this.maxHp = maxHp;
    this.hp = maxHp;
    const step = 22;
    for (let y = LANE_TOP - 4; y <= LANE_BOTTOM + 4; y += step) {
      // 越遠（y 越小）的段稍微往右上偏一點，做出透視斜線
      const img = scene.add
        .image(x + (y - LANE_BOTTOM) * 0.08, y, 'barricade')
        .setOrigin(0.5, 1)
        .setDepth(depthForY(y));
      this.segments.push(img);
    }
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** 擋住敵人的最右邊 x（以最近那一段為準，敵人停在這條線外） */
  get frontX(): number {
    return this.x + 10;
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    // 越破越透明，之後換成多張損壞階段的像素圖
    const alpha = 0.35 + 0.65 * (this.hp / this.maxHp);
    for (const s of this.segments) s.setAlpha(alpha);
    if (!this.alive) {
      this.scene.tweens.add({ targets: this.segments, alpha: 0, scaleY: 0.2, duration: 250 });
    }
  }
}
