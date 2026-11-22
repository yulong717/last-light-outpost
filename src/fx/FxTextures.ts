import Phaser from 'phaser';

/**
 * 特效用的小貼圖全部在這裡用程式畫出來，不需要任何美術檔案。
 * 在 BootScene.create() 呼叫一次 createFxTextures(this)。
 *
 * 像素風的祕訣：只用 fillRect 畫整數像素、不做反鋸齒，
 * 「柔和」的東西（煙、霧、光暈）用棋盤格抖色（dither）或少階漸層來做。
 */
export const FX = {
  px: 'fx_px', // 1×1 白點：血滴、火花
  px2: 'fx_px2', // 2×2 白點：較大的碎塊
  shell: 'fx_shell', // 彈殼
  chip: 'fx_chip', // 木屑
  smoke: 'fx_smoke', // 抖色煙團
  splat: 'fx_splat', // 地上血跡（3 個影格）
  shadow: 'fx_shadow', // 腳下影子
  fog: 'fx_fog', // 霧團
  glow: 'fx_glow', // 燈光光暈
  vignette: 'fx_vignette', // 畫面暗角
} as const;

export const SPLAT_FRAMES = 3;

export function createFxTextures(scene: Phaser.Scene): void {
  const tex = scene.textures;
  if (tex.exists(FX.px)) return;

  rects(scene, FX.px, 1, 1, [[0, 0, 1, 1, 0xffffff]]);
  rects(scene, FX.px2, 2, 2, [[0, 0, 2, 2, 0xffffff]]);
  // 黃銅彈殼：亮面 + 暗面
  rects(scene, FX.shell, 3, 2, [
    [0, 0, 3, 1, 0xe8c25a],
    [0, 1, 3, 1, 0x9c7a2c],
  ]);
  rects(scene, FX.chip, 3, 2, [
    [0, 0, 3, 1, 0xb08a64],
    [0, 1, 2, 1, 0x6d4c33],
  ]);
  rects(scene, FX.shadow, 24, 6, [
    [4, 0, 16, 1, 0x000000],
    [1, 1, 22, 4, 0x000000],
    [4, 5, 16, 1, 0x000000],
  ]);

  canvas(scene, FX.smoke, 8, 8, (ctx) => ditherCircle(ctx, 4, 4, 4, '#ffffff', 0.55));
  canvas(scene, FX.fog, 64, 20, (ctx) => {
    // 幾顆抖色圓疊成一團霧
    for (let i = 0; i < 6; i++) ditherCircle(ctx, 10 + i * 9, 10 + ((i * 7) % 5) - 2, 8 + (i % 3) * 2, '#ffffff', 0.5);
  });

  // 血跡：3 種隨機形狀，左右攤平（地面透視）
  const splat = tex.createCanvas(FX.splat, 16 * SPLAT_FRAMES, 6)!;
  const sctx = splat.getContext();
  const rnd = new Phaser.Math.RandomDataGenerator(['blood']);
  for (let f = 0; f < SPLAT_FRAMES; f++) {
    sctx.fillStyle = '#ffffff';
    for (let i = 0; i < 9; i++) {
      const w = rnd.between(2, 7);
      const x = f * 16 + rnd.between(1, 15 - w);
      const y = rnd.between(1, 4);
      sctx.fillRect(x, y, w, rnd.between(1, 2));
    }
    splat.add(f, 0, f * 16, 0, 16, 6);
  }
  splat.refresh();

  // 光暈：同心圓少階漸層（像素風不要平滑漸層）
  canvas(scene, FX.glow, 96, 96, (ctx) => {
    const steps = 6;
    for (let i = steps; i >= 1; i--) {
      ctx.fillStyle = `rgba(255,200,120,${0.03 + (steps - i) * 0.018})`;
      pixelCircle(ctx, 48, 48, (48 * i) / steps);
    }
  });

  // 暗角：邊緣變暗，讓夜晚更有壓迫感；用 4 階讓它保持像素感
  const { width, height } = scene.scale;
  canvas(scene, FX.vignette, width, height, (ctx) => {
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.hypot(cx, cy);
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = Math.hypot((x - cx) * 0.9, (y - cy) * 1.3) / maxR;
        // 外圈才開始變暗；用 2×2 棋盤格抖色混合相鄰兩階，避免一圈圈的色帶
        const v = Math.max(0, d - 0.62) * 14;
        const lo = Math.floor(v);
        const level = (x + y) % 2 === 0 && v - lo > 0.5 ? lo + 1 : lo;
        const i = (y * width + x) * 4;
        img.data[i + 3] = Math.min(5, level) * 26;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

type Rect = [number, number, number, number, number];

function rects(scene: Phaser.Scene, key: string, w: number, h: number, list: Rect[]): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (const [x, y, rw, rh, c] of list) g.fillStyle(c, 1).fillRect(x, y, rw, rh);
  g.generateTexture(key, w, h);
  g.destroy();
}

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  const t = scene.textures.createCanvas(key, w, h)!;
  draw(t.getContext());
  t.refresh();
}

function pixelCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + y), half * 2, 1);
  }
}

/** 抖色圓：中心實、邊緣用棋盤格，模擬透明度 */
function ditherCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, edge: number): void {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y) / r;
      if (d > 1) continue;
      const px = Math.round(cx + x);
      const py = Math.round(cy + y);
      if (d > edge && (px + py) % 2 === 0) continue;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}
