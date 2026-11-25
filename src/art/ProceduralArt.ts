import Phaser from 'phaser';

/**
 * 用程式畫的像素圖（不用任何外部工具）。
 * 規則：整數像素、固定調色盤、1px 深色外框，和 PixelLab 的角色風格對齊。
 */

/** 路障：3 格 28×56（0 完好、1 破損、2 快垮），木板 + 鐵皮 + 釘子 */
export const BARRICADE_FRAMES = 3;

const WOOD = [0x4a3324, 0x6d4c33, 0x8d6e4a, 0xa9875f];
const METAL = [0x2f343c, 0x4b525c, 0x6c7480];
const OUTLINE = 0x120d0a;

export function createBarricadeTexture(scene: Phaser.Scene, key = 'barricade'): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const W = 28;
  const H = 56;
  const t = scene.textures.createCanvas(key, W * BARRICADE_FRAMES, H)!;
  const ctx = t.getContext();
  const rnd = new Phaser.Math.RandomDataGenerator(['barricade']);
  const px = (x: number, y: number, c: number, w = 1, h = 1): void => {
    ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
    ctx.fillRect(x, y, w, h);
  };

  for (let f = 0; f < BARRICADE_FRAMES; f++) {
    const ox = f * W;
    // 直立的兩根樁
    for (const sx of [3, W - 7]) {
      px(ox + sx - 1, 4, OUTLINE, 6, H - 4);
      px(ox + sx, 5, WOOD[1], 4, H - 6);
      px(ox + sx, 5, WOOD[2], 1, H - 6);
    }
    // 橫木板，破損程度越高掉越多塊
    const planks = [8, 17, 26, 35, 44];
    planks.forEach((py, i) => {
      if (f >= 1 && i === 1) return;
      if (f >= 2 && (i === 3 || i === 0)) return;
      const tilt = (i % 2 === 0 ? 1 : -1) * (f === 2 ? 2 : 0);
      for (let x = 0; x < W; x++) {
        const y = py + Math.round((tilt * (x - W / 2)) / W);
        px(ox + x, y - 1, OUTLINE);
        px(ox + x, y, WOOD[2 + (x % 7 === 0 ? 1 : 0)]);
        px(ox + x, y + 1, WOOD[1]);
        px(ox + x, y + 2, WOOD[1]);
        px(ox + x, y + 3, WOOD[0]);
        px(ox + x, y + 4, OUTLINE);
      }
      // 木紋
      for (let k = 0; k < 3; k++) px(ox + rnd.between(1, W - 4), py + rnd.between(1, 2), WOOD[0], rnd.between(2, 4), 1);
      // 釘子
      px(ox + 4, py + 1, METAL[2]);
      px(ox + W - 5, py + 1, METAL[2]);
    });
    // 中間一片鐵皮（完好時）
    if (f === 0) {
      px(ox + 9, 20, OUTLINE, 11, 13);
      px(ox + 10, 21, METAL[1], 9, 11);
      px(ox + 10, 21, METAL[2], 9, 1);
      px(ox + 10, 31, METAL[0], 9, 1);
      px(ox + 12, 24, 0x7a3b22, 3, 2); // 鏽
    }
    // 裂縫與缺口
    if (f >= 1) {
      for (let k = 0; k < 4 + f * 4; k++) px(ox + rnd.between(2, W - 3), rnd.between(6, H - 6), OUTLINE, 1, rnd.between(1, 3));
    }
    t.add(f, 0, ox, 0, W, H);
  }
  t.refresh();
}

/**
 * 從角色精靈圖每一格切出「頭」當成新影格 head_0、head_1…，
 * 爆頭時讓頭飛出去用。回傳脖子所在列（影格內 y）。
 */
export function registerHeadFrames(scene: Phaser.Scene, key: string, neckRow: number, frameSize = 64): void {
  const tex = scene.textures.get(key);
  const total = tex.frameTotal - 1; // 扣掉 __BASE
  for (let i = 0; i < total; i++) {
    const fr = tex.get(i);
    if (tex.has(`head_${i}`)) continue;
    tex.add(`head_${i}`, fr.sourceIndex, fr.cutX, fr.cutY, frameSize, neckRow);
  }
}

/**
 * 依據點換成當地找得到的東西臨時堆起來的路障（同樣 3 格 28×56、腳底在最下面一列）：
 * - bins：後巷的大型垃圾桶＋垃圾袋
 * - shelves：五金行的鐵架、梯子、合板
 * - desks：國小教室翻倒的課桌椅
 * - tires：加油站的輪胎堆＋油桶
 * - crates：便利商店的飲料塑膠籃、購物推車
 * 沒指定就是原本的木板路障（'barricade'）。
 */
export type BarricadeStyle = 'bins' | 'shelves' | 'desks' | 'tires' | 'crates' | 'scaffold';

export const BARRICADE_STYLES: BarricadeStyle[] = ['bins', 'shelves', 'desks', 'tires', 'crates', 'scaffold'];

export function barricadeKey(style?: BarricadeStyle): string {
  return style ? `barricade_${style}` : 'barricade';
}

type Px = (x: number, y: number, c: number, w?: number, h?: number) => void;

/** 外框＋底色＋左邊亮線＋下緣暗線 */
function boxPx(px: Px, x: number, y: number, w: number, h: number, fill: number, hi: number, lo: number): void {
  px(x - 1, y - 1, OUTLINE, w + 2, h + 2);
  px(x, y, fill, w, h);
  px(x, y, hi, 1, h);
  px(x, y, hi, w, 1);
  px(x, y + h - 1, lo, w, 1);
}

const BARRICADE_DRAW: Record<BarricadeStyle, (px: Px, f: number, rnd: Phaser.Math.RandomDataGenerator) => void> = {
  bins: (px, f, rnd) => {
    const G = [0x1e4a2a, 0x2e6a3a, 0x4a8a50];
    // 底下的垃圾袋
    for (const [x, w] of [[0, 10], [17, 11]] as const) {
      px(x, 47, OUTLINE, w, 9);
      px(x + 1, 48, 0x22252a, w - 2, 7);
      px(x + 2, 49, 0x3a3e46, 2, 2);
    }
    if (f < 2) {
      // 直立的垃圾桶（輪子在下、蓋子在上）
      boxPx(px, 4, 22, 20, 30, G[1], G[2], G[0]);
      for (let y = 27; y < 50; y += 6) px(5, y, G[0], 18, 1);
      px(6, 52, OUTLINE, 4, 4);
      px(18, 52, OUTLINE, 4, 4);
      // 蓋子：破損時翹起來
      if (f === 0) boxPx(px, 3, 18, 22, 4, G[0], G[1], OUTLINE);
      else {
        px(2, 12, OUTLINE, 4, 10);
        px(3, 13, G[0], 2, 8);
        for (let k = 0; k < 6; k++) px(rnd.between(6, 21), rnd.between(23, 48), OUTLINE, 2, 1);
      }
      // 頂上壓一塊木板
      boxPx(px, 1, f === 0 ? 14 : 18, 26, 3, WOOD[2], WOOD[3], WOOD[0]);
      px(8, 30, 0xe8e0c0, 10, 4); // 貼紙
    } else {
      // 被撞倒：橫躺、垃圾灑出來
      boxPx(px, 1, 36, 26, 14, G[1], G[2], G[0]);
      px(1, 36, OUTLINE, 3, 14);
      for (let k = 0; k < 8; k++) px(rnd.between(0, 26), rnd.between(30, 54), rnd.pick([0xc8b070, 0x8a6a4a, 0xe8e8e8]), 2, 2);
    }
  },
  shelves: (px, f) => {
    const M = [0x3a4048, 0x6a727c, 0x9aa2ac];
    // 合板（後面）
    if (f < 2) boxPx(px, 2, 10, 24, 44, 0xb08a5a, 0xc8a070, 0x8a6a44);
    for (let y = 18; y < 52; y += 11) px(3, y, 0x9a7a4e, 22, 1);
    // 鐵架：兩根立柱＋層板
    for (const x of [1, 24]) {
      if (f >= 1 && x === 24) continue;
      px(x - 1, 4, OUTLINE, 5, 52);
      px(x, 5, M[1], 3, 50);
      px(x, 5, M[2], 1, 50);
    }
    [12, 26, 40, 52].forEach((y, i) => {
      if (f >= 2 && i % 2 === 0) return;
      const tilt = f >= 1 && i === 1 ? 3 : 0;
      px(0, y - 1, OUTLINE, 28, 4);
      px(1, y + (tilt ? 1 : 0), M[1], 26, 2);
      px(1, y, M[2], 26 - tilt * 2, 1);
    });
    // 斜靠的鋁梯
    if (f < 2) {
      for (let y = 6; y < 54; y++) {
        const x = 18 - Math.round((y - 6) / 6);
        px(x, y, 0xc8ccd0);
        px(x + 6, y, 0xc8ccd0);
        if (y % 8 === 0) px(x, y, 0xa8acb0, 7, 1);
      }
    }
    px(8, 30, 0xd8b030, 6, 2); // 黃色膠帶
  },
  desks: (px, f, rnd) => {
    const D = [0x8a6a3a, 0xb08a4a, 0xd0a860];
    const LEG = 0x5a6a7a;
    // 翻倒的課桌：桌面朝外，桌腳朝內
    const desk = (y: number, broken: boolean) => {
      boxPx(px, 1, y, 26, 12, D[1], D[2], D[0]);
      px(2, y + 2, 0x2a2a2a, 3, 2); // 刻字
      px(4, y + 12, OUTLINE, 3, 6);
      if (!broken) px(21, y + 12, OUTLINE, 3, 6);
      px(5, y + 12, LEG, 1, 5);
      if (!broken) px(22, y + 12, LEG, 1, 5);
    };
    if (f < 2) desk(12, f >= 1);
    desk(36, false);
    // 疊在中間的椅子
    if (f < 2) {
      boxPx(px, 6, 26, 16, 4, D[1], D[2], D[0]);
      px(7, 30, LEG, 2, 6);
      px(19, 30, LEG, 2, 6);
      boxPx(px, 18, 18, 4, 8, D[1], D[2], D[0]);
    } else {
      for (let k = 0; k < 5; k++) px(rnd.between(2, 24), rnd.between(22, 34), rnd.pick([D[0], LEG]), rnd.between(3, 7), 2);
    }
    // 書包或課本
    px(18, 50, OUTLINE, 9, 6);
    px(19, 51, 0xc83a2a, 7, 5);
  },
  tires: (px, f) => {
    const T = [0x141414, 0x2a2a2a, 0x46464a];
    const tire = (x: number, y: number) => {
      px(x, y, OUTLINE, 14, 8);
      px(x + 1, y + 1, T[1], 12, 6);
      px(x + 1, y + 1, T[2], 12, 1);
      px(x + 4, y + 3, T[0], 6, 2);
    };
    // 底下兩疊輪胎
    const stack = f >= 2 ? 2 : f >= 1 ? 4 : 5;
    for (let i = 0; i < stack; i++) tire(0, 48 - i * 8);
    // 旁邊的油桶
    if (f < 2) {
      boxPx(px, 15, 28, 12, 27, 0xb83a2a, 0xd85a3a, 0x7a2218);
      px(15, 35, 0x7a2218, 12, 1);
      px(15, 46, 0x7a2218, 12, 1);
      px(18, 39, 0xf0d040, 6, 4);
    } else {
      // 油桶倒了，地上一攤油
      boxPx(px, 12, 46, 16, 9, 0xb83a2a, 0xd85a3a, 0x7a2218);
      px(6, 54, 0x0c0c10, 22, 2);
    }
    if (f === 0) tire(13, 20);
  },
  // 工地：鷹架鋼管綁成框、釘上夾板，底下壓水泥袋
  scaffold: (px, f, rnd) => {
    const PIPE = [0x6a7076, 0x9aa0a6, 0xc8ccd0];
    const PLY = [0x8a6a3a, 0xb8925a, 0xd8b070];
    const pipe = (x: number, y0: number, y1: number) => {
      px(x - 1, y0, OUTLINE, 4, y1 - y0);
      px(x, y0, PIPE[1], 2, y1 - y0);
      px(x, y0, PIPE[2], 1, y1 - y0);
    };
    // 直立的兩根鋼管（打爛後倒一根）
    pipe(3, f >= 2 ? 30 : 8, 56);
    if (f < 2) pipe(22, 12, 56);
    else {
      px(8, 52, OUTLINE, 20, 4);
      px(9, 53, PIPE[1], 18, 2);
    }
    // 橫管＋扣件
    if (f < 2) {
      px(1, 17, OUTLINE, 26, 4);
      px(2, 18, PIPE[1], 24, 2);
      px(3, 17, 0xd8a030, 3, 4);
      px(22, 17, 0xd8a030, 3, 4);
    }
    // 夾板（越爛越少片）
    const boards = f >= 2 ? 1 : f >= 1 ? 2 : 3;
    for (let i = 0; i < boards; i++) {
      const y = 22 + i * 10;
      boxPx(px, 2, y, 24, 8, PLY[1], PLY[2], PLY[0]);
      px(5, y + 3, PLY[0], 1, 1);
      px(21, y + 3, PLY[0], 1, 1);
      if (f >= 1 && i === boards - 1) px(rnd.between(8, 18), y + 1, OUTLINE, 3, 6);
    }
    // 底下的水泥袋
    for (const [x, w] of [[0, 13], [14, 14]] as const) {
      px(x, 48, OUTLINE, w, 8);
      px(x + 1, 49, 0xb8b0a0, w - 2, 6);
      px(x + 2, 51, 0x8a3a2a, w - 4, 2);
    }
    // 安全網的一角
    if (f === 0) for (let y = 4; y < 20; y += 3) px(10 + ((y / 3) % 2), y, 0x3a8a4a, 6, 1);
  },
  crates: (px, f, rnd) => {
    const C = [
      [0xc83a2a, 0xe85a40, 0x8a2218],
      [0xe0a020, 0xf8c040, 0xa07010],
      [0x2a6ac8, 0x4a8ae8, 0x1a4a8a],
    ];
    const crate = (x: number, y: number, k: number) => {
      const c = C[k % C.length];
      boxPx(px, x, y, 13, 10, c[0], c[1], c[2]);
      px(x + 2, y + 3, c[2], 9, 1);
      px(x + 2, y + 6, c[2], 9, 1);
      px(x + 5, y + 1, 0x1a1a1a, 3, 1); // 把手孔
    };
    // 塑膠籃疊兩疊
    const n = f >= 2 ? 2 : f >= 1 ? 3 : 5;
    for (let i = 0; i < n; i++) crate(0, 45 - i * 11, i);
    for (let i = 0; i < Math.max(1, n - 1); i++) crate(14, 45 - i * 11, i + 1);
    // 購物推車（斜擺在最上面）
    if (f === 0) {
      for (let x = 2; x < 26; x += 3) px(x, 6, 0xb8bcc0, 1, 10);
      px(1, 5, OUTLINE, 26, 1);
      px(1, 16, 0xb8bcc0, 26, 1);
      px(24, 2, 0x5a6064, 4, 4);
    }
    if (f >= 1) for (let k = 0; k < 4; k++) px(rnd.between(2, 24), rnd.between(30, 54), OUTLINE, 2, 1);
  },
};

/** 所有在地化路障的貼圖（BootScene 呼叫） */
export function createBarricadeStyles(scene: Phaser.Scene): void {
  const W = 28;
  const H = 56;
  for (const style of BARRICADE_STYLES) {
    const key = barricadeKey(style);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const t = scene.textures.createCanvas(key, W * BARRICADE_FRAMES, H)!;
    const ctx = t.getContext();
    for (let f = 0; f < BARRICADE_FRAMES; f++) {
      const ox = f * W;
      const px: Px = (x, y, c, w = 1, h = 1) => {
        if (x >= W || y >= H) return;
        const x0 = Math.max(0, x);
        const y0 = Math.max(0, y);
        ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
        ctx.fillRect(ox + x0, y0, Math.min(W, x + w) - x0, Math.min(H, y + h) - y0);
      };
      BARRICADE_DRAW[style](px, f, new Phaser.Math.RandomDataGenerator([`${style}${f}`]));
      t.add(f, 0, ox, 0, W, H);
    }
    t.refresh();
  }
}
