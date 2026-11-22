import Phaser from 'phaser';

type HitKind = 'hit' | 'kill' | 'headshot';

/**
 * 準星（世界座標，畫在瞄準點上）：
 * - 四根短線的間距反映目前散射：連射、移動時張開，站定後收回
 * - 命中時閃一個 ✕（白＝命中、紅＝擊殺、金＝爆頭），開槍時整個準星彈一下
 * 電腦版隱藏系統游標；手機版顯示在最後一次瞄準的位置。
 */
export class Crosshair {
  private g: Phaser.GameObjects.Graphics;
  private markT = 0;
  private markKind: HitKind = 'hit';
  private pop = 0;
  private gap = 4;

  constructor(scene: Phaser.Scene, depth = 96) {
    this.g = scene.add.graphics().setDepth(depth);
    const touch = scene.sys.game.device.input.touch;
    if (!touch) scene.input.setDefaultCursor('none');
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.setDefaultCursor('default'));
  }

  /** 開槍時呼叫，準星往外彈一下 */
  fired(): void {
    this.pop = 1;
  }

  /** 命中確認；同一槍多次命中取最重要的那種 */
  hit(kind: HitKind): void {
    const rank = { hit: 0, kill: 1, headshot: 2 };
    if (this.markT <= 0 || rank[kind] >= rank[this.markKind]) this.markKind = kind;
    this.markT = kind === 'hit' ? 0.12 : 0.22;
  }

  /**
   * @param spreadDeg 目前散射角（度）
   * @param dist 槍口到瞄準點的距離，散射在這個距離上換算成像素
   */
  update(dt: number, x: number, y: number, spreadDeg: number, dist: number, visible: boolean): void {
    const g = this.g;
    g.clear();
    this.markT = Math.max(0, this.markT - dt);
    this.pop = Math.max(0, this.pop - dt * 8);
    if (!visible) return;

    const target = Phaser.Math.Clamp(Math.tan(Phaser.Math.DegToRad(spreadDeg)) * dist, 3, 26);
    // 平滑跟上，避免準星跳動
    this.gap += (target - this.gap) * Math.min(1, dt * 20);
    const gap = Math.round(this.gap + this.pop * 3);
    const len = 4;
    const cx = Math.round(x);
    const cy = Math.round(y);

    // 黑邊 + 白線，任何背景都看得清楚
    for (const [w, color, a] of [
      [3, 0x000000, 0.6],
      [1, 0xffffff, 0.9],
    ] as const) {
      g.lineStyle(w, color, a);
      g.lineBetween(cx - gap - len, cy, cx - gap, cy);
      g.lineBetween(cx + gap, cy, cx + gap + len, cy);
      g.lineBetween(cx, cy - gap - len, cx, cy - gap);
      g.lineBetween(cx, cy + gap, cx, cy + gap + len);
    }
    g.fillStyle(0xffffff, 0.9).fillRect(cx, cy, 1, 1);

    if (this.markT > 0) {
      const color = this.markKind === 'headshot' ? 0xffd24a : this.markKind === 'kill' ? 0xff4b4b : 0xffffff;
      const r0 = 3;
      const r1 = this.markKind === 'hit' ? 6 : 8;
      g.lineStyle(3, 0x000000, 0.5);
      this.drawX(cx, cy, r0, r1);
      g.lineStyle(1, color, 1);
      this.drawX(cx, cy, r0, r1);
    }
  }

  private drawX(cx: number, cy: number, r0: number, r1: number): void {
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      this.g.lineBetween(cx + sx * r0, cy + sy * r0, cx + sx * r1, cy + sy * r1);
    }
  }
}
