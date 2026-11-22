import Phaser from 'phaser';

/**
 * 像素畫筆：場景背景與道具都用它在 Canvas 上畫整數像素，規則和其他程式美術一樣：
 * 不做反鋸齒、1px 深色外框、上亮下暗的固定階層、柔和的東西用抖色。
 */

export const OUTLINE = 0x120f0d;

export function hex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** 把顏色調亮（amt > 0）或調暗（amt < 0），amt 是 -1..1 */
export function tone(c: number, amt: number): number {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  const f = (v: number) => Math.round(Phaser.Math.Clamp(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt), 0, 255));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/** 兩色混合 t = 0..1 */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class Painter {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    public ox = 0,
    public oy = 0,
    readonly rnd: Phaser.Math.RandomDataGenerator = new Phaser.Math.RandomDataGenerator(['painter']),
  ) {}

  rect(x: number, y: number, w: number, h: number, c: number, a = 1): void {
    if (w <= 0 || h <= 0) return;
    this.ctx.globalAlpha = a;
    this.ctx.fillStyle = hex(c);
    this.ctx.fillRect(Math.round(this.ox + x), Math.round(this.oy + y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  px(x: number, y: number, c: number, a = 1): void {
    this.rect(x, y, 1, 1, c, a);
  }

  /** 實心方塊：外框、頂端亮邊、底部暗邊 */
  box(x: number, y: number, w: number, h: number, c: number, o: { outline?: number | null; light?: number; dark?: number } = {}): void {
    const ol = o.outline === undefined ? OUTLINE : o.outline;
    if (ol !== null) {
      this.rect(x, y, w, h, ol);
      x += 1;
      y += 1;
      w -= 2;
      h -= 2;
    }
    this.rect(x, y, w, h, c);
    this.rect(x, y, w, 1, tone(c, o.light ?? 0.25));
    this.rect(x, y + h - 1, w, 1, tone(c, -(o.dark ?? 0.3)));
  }

  /** 棋盤格抖色：density 0..1 */
  dither(x: number, y: number, w: number, h: number, c: number, density = 0.5, a = 1): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const checker = (i + j) % 2 === 0;
        const keep = density >= 0.5 ? checker || this.rnd.frac() < (density - 0.5) * 2 : checker && this.rnd.frac() < density * 2;
        if (keep) this.px(x + i, y + j, c, a);
      }
    }
  }

  /** 垂直漸層：分成 steps 階，接縫用抖色 */
  gradient(x: number, y: number, w: number, h: number, top: number, bottom: number, steps = 6): void {
    const sh = h / steps;
    for (let i = 0; i < steps; i++) {
      const c = mix(top, bottom, i / (steps - 1));
      this.rect(x, y + Math.floor(i * sh), w, Math.ceil(sh) + 1, c);
      if (i > 0) {
        const prev = mix(top, bottom, (i - 1) / (steps - 1));
        for (let k = 0; k < w; k += 2) this.px(x + k + (i % 2), y + Math.floor(i * sh), prev);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: number, a = 1): void {
    for (let j = -r; j <= r; j++) {
      const hw = Math.floor(Math.sqrt(r * r - j * j));
      this.rect(cx - hw, cy + j, hw * 2 + 1, 1, c, a);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, a = 1): void {
    for (let j = -ry; j <= ry; j++) {
      const hw = Math.floor(rx * Math.sqrt(1 - (j * j) / (ry * ry || 1)));
      this.rect(cx - hw, cy + j, hw * 2 + 1, 1, c, a);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, a = 1): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c, a);
  }

  /** 下垂的電線：兩點之間的拋物線 */
  wire(x0: number, y0: number, x1: number, y1: number, sag: number, c: number, a = 1): void {
    const n = Math.max(2, Math.abs(x1 - x0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag), c, a);
    }
  }

  /** 一扇窗：外框、玻璃、十字窗櫺；lit 代表裡面有燈 */
  window(x: number, y: number, w: number, h: number, o: { frame?: number; glass?: number; lit?: boolean; broken?: boolean; bars?: boolean; blinds?: boolean } = {}): void {
    const frame = o.frame ?? 0x2a2a2e;
    this.rect(x, y, w, h, OUTLINE);
    const g = o.lit ? 0xd8b060 : o.glass ?? 0x1c2630;
    this.rect(x + 1, y + 1, w - 2, h - 2, g);
    if (o.lit) this.rect(x + 1, y + h - 4, w - 2, 3, tone(g, -0.25));
    else this.line(x + 2, y + h - 3, x + Math.min(w, h) - 3, y + 2, tone(g, 0.2), 0.6);
    if (o.blinds) for (let j = y + 2; j < y + h - 1; j += 2) this.rect(x + 1, j, w - 2, 1, tone(g, o.lit ? -0.3 : 0.15));
    if (o.broken) {
      this.rect(x + 1, y + 1, w - 2, h - 2, 0x0a0c0e);
      this.line(x + 1, y + 1, x + w / 2, y + h / 2, tone(g, 0.3));
      this.line(x + w - 2, y + 2, x + w / 2 + 1, y + h / 2 - 1, tone(g, 0.3));
    }
    this.rect(x + Math.floor(w / 2), y + 1, 1, h - 2, frame);
    if (h > 14) this.rect(x + 1, y + Math.floor(h / 2), w - 2, 1, frame);
    if (o.bars) for (let i = x + 2; i < x + w - 1; i += 3) this.rect(i, y, 1, h, 0x1a1a1a);
    this.rect(x - 1, y + h, w + 2, 1, tone(frame, 0.2));
  }
}

/** 建一張 Canvas 貼圖並用畫筆畫好；原點設定交給使用者 */
export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (p: Painter) => void, seed = key): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const t = scene.textures.createCanvas(key, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))!;
  const p = new Painter(t.getContext(), 0, 0, new Phaser.Math.RandomDataGenerator([seed]));
  draw(p);
  t.refresh();
  return t;
}

/** 多影格的橫排貼圖（影格 0、1、2…），每格同尺寸 */
export function frameSheet(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  frames: number,
  draw: (p: Painter, frame: number) => void,
): void {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w * frames, h)!;
  const ctx = t.getContext();
  for (let f = 0; f < frames; f++) {
    const p = new Painter(ctx, f * w, 0, new Phaser.Math.RandomDataGenerator([key]));
    draw(p, f);
    t.add(f, 0, f * w, 0, w, h);
  }
  t.refresh();
}
