import Phaser from 'phaser';
import { LANE_BOTTOM, LANE_TOP, depthForY } from '../config';
import { BARRICADE_FRAMES } from '../art/ProceduralArt';
import { Fx } from '../fx/Fx';

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
        .image(x + (y - LANE_BOTTOM) * 0.08, y, 'barricade', 0)
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

  /**
   * 受到攻擊。hitY 是攻擊者的腳底 y：木屑從那一段噴出來，那一段晃一下。
   * 沒給就挑中間那段。
   */
  takeDamage(amount: number, hitY?: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshLook();
    const seg = this.segmentNear(hitY ?? (LANE_TOP + LANE_BOTTOM) / 2);
    // 被打：木屑飛濺 + 那一段晃一下
    const fx = Fx.of(this.scene);
    fx?.woodChips(this.frontX - 2, seg.y - seg.displayHeight / 2, seg.y, 4);
    this.scene.tweens.add({ targets: seg, angle: Phaser.Math.FloatBetween(-3, 3), duration: 50, yoyo: true });
    if (!this.alive) {
      for (const s of this.segments) fx?.woodChips(s.x, s.y - s.displayHeight / 2, s.y, 6);
      this.scene.tweens.add({ targets: this.segments, alpha: 0, scaleY: 0.2, duration: 250 });
    }
  }

  /** 修理（工兵用）。路障已被打爛就修不回來，回傳實際修了多少。 */
  repair(amount: number): number {
    if (!this.alive || this.hp >= this.maxHp) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.refreshLook();
    return this.hp - before;
  }

  /** 依耐久切換損壞階段的影格（ProceduralArt 用程式畫的 3 格），沒有影格時改用透明度 */
  private refreshLook(): void {
    const ratio = this.hp / this.maxHp;
    for (const s of this.segments) {
      if (s.texture.frameTotal > BARRICADE_FRAMES) {
        s.setFrame(Math.min(BARRICADE_FRAMES - 1, Math.floor((1 - ratio) * BARRICADE_FRAMES)));
      } else {
        s.setAlpha(0.35 + 0.65 * ratio);
      }
    }
  }

  private segmentNear(y: number): Phaser.GameObjects.Image {
    let best = this.segments[0];
    for (const s of this.segments) if (Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
    return best;
  }
}
