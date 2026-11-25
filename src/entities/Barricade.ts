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
  /** 頭上的小耐久條：受損才出現，被打時亮起、之後淡成半透明 */
  private bar: Phaser.GameObjects.Graphics;

  /**
   * dir：霧屍從哪一側來（1 = 右邊，預設；-1 = 左邊，雙面據點的左側路障）。
   * texture：路障的樣子（各據點用當地的東西堆，見 ProceduralArt 的 BarricadeStyle）。
   * floorY：多樓層據點的某一層地板 y：只在那層堆兩段，不是整條地面帶。
   */
  constructor(private scene: Phaser.Scene, x: number, maxHp: number, readonly dir: 1 | -1 = 1, texture = 'barricade', readonly floorY?: number) {
    this.x = x;
    this.maxHp = maxHp;
    this.hp = maxHp;
    const step = 22;
    const ys: number[] = [];
    if (floorY !== undefined) ys.push(floorY - 3, floorY + 4);
    else for (let y = LANE_TOP - 4; y <= LANE_BOTTOM + 4; y += step) ys.push(y);
    const bottom = floorY !== undefined ? floorY + 4 : LANE_BOTTOM;
    for (const y of ys) {
      // 越遠（y 越小）的段稍微往外上偏一點，做出透視斜線
      const img = scene.add
        .image(x + dir * (y - bottom) * (floorY !== undefined ? 0.6 : 0.08), y, scene.textures.exists(texture) ? texture : 'barricade', 0)
        .setOrigin(0.5, 1)
        .setDepth(depthForY(y))
        .setFlipX(dir < 0);
      this.segments.push(img);
    }
    this.bar = scene.add.graphics().setDepth(depthForY(bottom) + 0.5).setAlpha(0.55);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** 擋住敵人的那條線（以最近那一段為準，敵人停在這條線外） */
  get frontX(): number {
    return this.x + 10 * this.dir;
  }

  /**
   * 受到攻擊。hitY 是攻擊者的腳底 y：木屑從那一段噴出來，那一段晃一下。
   * 沒給就挑中間那段。
   */
  takeDamage(amount: number, hitY?: number): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.refreshLook();
    this.scene.tweens.killTweensOf(this.bar);
    this.bar.setAlpha(1);
    this.scene.tweens.add({ targets: this.bar, alpha: 0.55, delay: 1800, duration: 600 });
    const seg = this.segmentNear(hitY ?? (LANE_TOP + LANE_BOTTOM) / 2);
    // 被打：木屑飛濺 + 那一段晃一下
    const fx = Fx.of(this.scene);
    fx?.woodChips(this.frontX - 2 * this.dir, seg.y - seg.displayHeight / 2, seg.y, 4);
    this.scene.tweens.add({ targets: seg, angle: Phaser.Math.FloatBetween(-3, 3), duration: 50, yoyo: true });
    if (!this.alive) {
      for (const s of this.segments) fx?.woodChips(s.x, s.y - s.displayHeight / 2, s.y, 6);
      this.scene.tweens.add({ targets: this.segments, alpha: 0.18, scaleY: 0.2, duration: 250 });
    }
  }

  /**
   * 直接設定耐久（白天修理／強化、從存檔還原）。
   * 從 0 修回來時把倒下的柵欄重新立起來。
   */
  setHp(hp: number, maxHp = this.maxHp): void {
    this.maxHp = maxHp;
    this.hp = Phaser.Math.Clamp(hp, 0, maxHp);
    for (const s of this.segments) {
      this.scene.tweens.killTweensOf(s);
      s.setScale(1).setAngle(0);
    }
    this.refreshLook();
  }

  /** 選取時讓整道柵欄亮一下 */
  setHighlight(on: boolean): void {
    for (const s of this.segments) {
      if (on) s.setTint(0xfff3b0);
      else s.clearTint();
    }
  }

  /** 依耐久切換損壞階段的影格（ProceduralArt 用程式畫的 3 格），沒有影格時改用透明度 */
  private refreshLook(): void {
    const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.drawBar(ratio);
    for (const s of this.segments) {
      if (!this.alive) {
        s.setAlpha(0.18);
        continue;
      }
      if (s.texture.frameTotal > BARRICADE_FRAMES) {
        s.setAlpha(1);
        s.setFrame(Math.min(BARRICADE_FRAMES - 1, Math.floor((1 - ratio) * BARRICADE_FRAMES)));
      } else {
        s.setAlpha(0.35 + 0.65 * ratio);
      }
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

  /** 耐久條畫在最遠那段柵欄的頂上；滿血或倒了就不畫 */
  private drawBar(ratio: number): void {
    const g = this.bar.clear();
    if (!this.alive || ratio >= 1) return;
    const top = this.segments.reduce((m, s) => Math.min(m, s.y - s.displayHeight), Infinity);
    const far = this.segments[0];
    const w = 22;
    const x = Math.round(far.x - w / 2);
    const y = Math.round(top - 6);
    const c = ratio > 0.5 ? 0xd9a35a : ratio > 0.25 ? 0xf2c14e : 0xd8402f;
    g.fillStyle(0x000000, 0.75).fillRect(x - 1, y - 1, w + 2, 5);
    g.fillStyle(0x3a2a20, 1).fillRect(x, y, w, 3);
    g.fillStyle(c, 1).fillRect(x, y, Math.max(1, Math.round(w * ratio)), 3);
  }

  private segmentNear(y: number): Phaser.GameObjects.Image {
    let best = this.segments[0];
    for (const s of this.segments) if (Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
    return best;
  }
}
