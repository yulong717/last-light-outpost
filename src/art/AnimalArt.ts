import Phaser from 'phaser';

/**
 * 動物霧屍的程式化像素圖：屍犬、屍鴉、屍熊。
 * 先用簡單幾何（陰影分三階的橢圓、粗線條四肢）畫在格子上，再自動描 1px 深色外框，
 * 風格和 PixelLab 的人形霧屍對齊（整數像素、固定調色盤、深色外框）。完全不需要外部工具。
 *
 * 每種動物的影格（朝右繪製）：
 *   屍犬 48×32：0–3 奔跑、4 蓄勢、5 撲咬、6–8 倒地
 *   屍鴉 32×24：0–3 拍翅、4 俯衝、5–6 墜落
 *   屍熊 80×56：0–3 行走、4 人立、5 揮掌、6–8 倒地
 * 之後若換成 PixelLab 圖，只要用同樣的 key、影格順序載入即可。
 */

export type AnimalKind = 'dog' | 'crow' | 'bear';

export interface AnimalFrameInfo {
  w: number;
  h: number;
  frames: number;
  /** 腳底所在列（屍鴉是「身體中心」所在列，飛行高度另外加） */
  footRow: number;
  walk: number[];
  attack: number[];
  death: number[];
  walkRate: number;
}

export const ANIMAL_FRAMES: Record<AnimalKind, AnimalFrameInfo> = {
  dog: { w: 48, h: 32, frames: 9, footRow: 30, walk: [0, 1, 2, 3], attack: [4, 5, 5, 0], death: [6, 7, 8], walkRate: 12 },
  crow: { w: 32, h: 24, frames: 7, footRow: 12, walk: [0, 1, 2, 3], attack: [4], death: [5, 6], walkRate: 14 },
  bear: { w: 80, h: 56, frames: 9, footRow: 54, walk: [0, 1, 2, 3], attack: [4, 4, 5, 5, 0], death: [6, 7, 8], walkRate: 6 },
};

/** 每種動物的毛色（暗、中、亮） */
export const ANIMAL_PALETTES: Record<AnimalKind, [number, number, number][]> = {
  dog: [
    [0x3a2c20, 0x5a4430, 0x7a6044],
    [0x1e1e22, 0x323238, 0x4a4a52],
    [0x56564e, 0x76766a, 0x96968a],
    [0x6a4a26, 0x8e6838, 0xae8a52],
  ],
  crow: [
    [0x101018, 0x1e1e2c, 0x343448],
    [0x141414, 0x262624, 0x3c3a38],
  ],
  bear: [
    [0x2e1e12, 0x4a321e, 0x684830],
    [0x18141a, 0x2a2428, 0x403638],
  ],
};

const OUTLINE = 0x120d0a;
const FLESH = [0x6a1a1a, 0x9a3a3a, 0xc06a6a];
const BONE = 0xd8d0b8;
const EYE = 0xff3a2a;

/** 一格畫布：顏色格子（0 = 透明） */
class Grid {
  readonly px: Int32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int32Array(w * h).fill(-1);
  }
  set(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.px[y * this.w + x];
  }
  /** 三階陰影橢圓：上亮、中、下暗 */
  ellipse(cx: number, cy: number, rx: number, ry: number, pal: readonly number[], tilt = 0): void {
    for (let y = Math.floor(cy - ry - Math.abs(tilt) * rx); y <= Math.ceil(cy + ry + Math.abs(tilt) * rx); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const yy = y - tilt * (x - cx);
        const dy = (yy - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        this.set(x, y, dy < -0.4 ? pal[2] : dy > 0.35 ? pal[0] : pal[1]);
      }
    }
  }
  /** 粗線（四肢、尾巴） */
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: number): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const r = width / 2;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      for (let oy = -r; oy < r; oy++) for (let ox = -r; ox < r; ox++) this.set(x + ox + 0.5, y + oy + 0.5, c);
    }
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  tri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number): void {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    const sgn = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
      (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const d1 = sgn(x, y, ax, ay, bx, by);
        const d2 = sgn(x, y, bx, by, cx, cy);
        const d3 = sgn(x, y, cx, cy, ax, ay);
        const neg = d1 < 0 || d2 < 0 || d3 < 0;
        const pos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(neg && pos)) this.set(x, y, c);
      }
    }
  }
  /** 只畫在已經有顏色的地方（傷口、肋骨） */
  paint(x: number, y: number, c: number): void {
    if (this.get(Math.round(x), Math.round(y)) >= 0) this.set(x, y, c);
  }
  /** 自動外框：透明格子只要上下左右有顏色就描成深色 */
  outline(): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) >= 0) continue;
        if (this.get(x - 1, y) >= 0 || this.get(x + 1, y) >= 0 || this.get(x, y - 1) >= 0 || this.get(x, y + 1) >= 0) add.push(y * this.w + x);
      }
    }
    for (const i of add) this.px[i] = OUTLINE;
  }
}

/** 前後腿擺動：phase 0..1，回傳腳掌相對髖部的位移 */
function legSwing(phase: number, len: number, amp: number): [number, number] {
  const a = Math.sin(phase * Math.PI * 2) * amp;
  const lift = Math.max(0, Math.cos(phase * Math.PI * 2)) * 2;
  return [Math.sin(a) * len, Math.cos(a) * len - lift];
}

// ───────────────────────── 屍犬 ─────────────────────────

function drawDog(g: Grid, f: number, pal: [number, number, number], seed: number): void {
  const dark = pal[0];
  const far = darken(pal[0], 0.7);
  if (f >= 6) {
    // 倒地：側躺，腿僵直伸出
    const k = f - 6;
    const lift = [6, 2, 0][k];
    const tilt = [0.25, 0.08, 0][k];
    const cy = 24 - lift;
    g.line(14, cy + 3, 8, cy + 6, 2, dark);
    for (const [hx, dx] of [
      [17, 5],
      [20, 6],
      [30, 6],
      [33, 5],
    ])
      g.line(hx, cy + 3, hx + dx, cy + 5 + (k === 0 ? 2 : 0), 2, hx % 2 ? far : dark);
    g.ellipse(24, cy, 11, 4.5, pal, tilt);
    g.ellipse(36, cy + 1, 4, 3.5, pal, tilt);
    g.rect(39, cy + 1, 5, 2, pal[1]);
    for (let i = 0; i < 4; i++) g.paint(21 + i * 2, cy - 1, BONE);
    g.outline();
    g.set(38, cy, 0x4a1010);
    return;
  }
  const run = f <= 3;
  const phase = run ? f / 4 : 0;
  const bob = run ? (f % 2 === 0 ? 0 : -1) : 0;
  // 蓄勢：身體壓低；撲咬：前高後低、四肢伸直
  const pitch = f === 4 ? 0.08 : f === 5 ? -0.28 : 0;
  const crouch = f === 4 ? 3 : f === 5 ? -3 : 0;
  const Y = (x: number, y: number) => y + bob + crouch + pitch * (x - 24);

  // 尾巴（下垂、破爛）
  g.line(13, Y(13, 13), 7, Y(7, 15 + (f % 2)), 2, dark);
  // 遠側的腿（暗一點）
  const legs: [number, number, number][] = [
    [29, 0.5, 1],
    [16, 0, 1],
    [32, 0, 0],
    [19, 0.5, 0],
  ];
  for (const [hx, off, isFar] of legs) {
    const hy = Y(hx, 19);
    let dx: number;
    let dy: number;
    if (f === 5) {
      // 撲出去：前腳往前伸、後腳往後蹬
      [dx, dy] = hx > 24 ? [7, 6] : [-7, 6];
    } else if (f === 4) {
      [dx, dy] = hx > 24 ? [2, 7] : [-2, 7];
    } else [dx, dy] = legSwing(phase + off, 10, 0.55);
    const footY = Math.min(29, hy + dy);
    const kx = hx + dx * 0.4 + (hx > 24 ? -1 : 1);
    const ky = hy + (footY - hy) * 0.5;
    const c = isFar ? far : dark;
    g.line(hx, hy, kx, ky, 3, c);
    g.line(kx, ky, hx + dx, footY, 2, c);
  }
  // 身體
  g.ellipse(23, Y(23, 15), 11, 5, pal, pitch);
  g.ellipse(32, Y(32, 15), 5, 5.5, pal, pitch);
  // 脖子與頭
  g.line(34, Y(34, 13), 38, Y(38, 10), 5, pal[1]);
  g.ellipse(39, Y(39, 9), 4.5, 3.5, pal, pitch);
  const open = f === 5 || f === 4 ? 2 : run && f % 2 ? 1 : 0;
  g.rect(42, Y(42, 9), 5, 2, pal[1]);
  g.rect(42, Y(42, 11) + open, 4, 1, pal[0]);
  // 耳朵
  g.tri(36, Y(36, 7), 37, Y(37, 3), 39, Y(39, 6), pal[0]);
  // 腐爛：露出的肋骨與肉
  const r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 2;
    g.paint(x, Y(x, 14), BONE);
    g.paint(x, Y(x, 15), FLESH[0]);
    g.paint(x + 1, Y(x + 1, 14), FLESH[1]);
  }
  for (let i = 0; i < 3; i++) {
    const x = 14 + Math.floor(r() * 18);
    g.paint(x, Y(x, 12 + Math.floor(r() * 3)), FLESH[Math.floor(r() * 3)]);
  }
  g.outline();
  // 眼睛與牙齒畫在外框之後，不會被描邊吃掉
  g.set(40, Y(40, 8), EYE);
  g.set(43, Y(43, 10) + (open ? 1 : 0), BONE);
  g.set(45, Y(45, 10) + (open ? 1 : 0), BONE);
}

// ───────────────────────── 屍鴉 ─────────────────────────

function drawCrow(g: Grid, f: number, pal: [number, number, number], seed: number): void {
  const wing = pal[0];
  const wingHi = pal[1];
  if (f === 6) {
    // 躺在地上：身體壓扁、翅膀攤開
    g.tri(6, 21, 15, 18, 26, 22, wing);
    g.ellipse(16, 20, 6, 2.5, pal);
    g.ellipse(22, 20, 2.5, 2, pal);
    g.rect(24, 20, 3, 1, 0x707070);
    g.outline();
    return;
  }
  const dive = f === 4;
  const fallen = f === 5;
  const pitch = dive ? 0.35 : fallen ? -0.5 : 0;
  const Y = (x: number, y: number) => y + pitch * (x - 15);
  // 尾羽
  g.tri(5, Y(5, 10), 10, Y(10, 11), 5, Y(5, 14), wing);
  // 遠側翅膀
  const tips: [number, number][] = [
    [7, 0],
    [2, 6],
    [5, 20],
    [2, 8],
  ];
  const [tx, ty] = dive ? [6, Y(6, 10)] : fallen ? [10, 4] : tips[f];
  g.tri(12, Y(12, 11), 18, Y(18, 11), tx + 3, ty + (f === 0 ? 1 : 0), darken(wing, 0.7));
  // 身體與頭
  g.ellipse(15, Y(15, 12), 6, 3.5, pal, pitch);
  g.ellipse(21, Y(21, 10), 3, 3, pal, pitch);
  // 嘴
  g.rect(24, Y(24, 10), 3, 1, 0x8a8a80);
  g.rect(24, Y(24, 11), 2, 1, 0x6a6a60);
  // 近側翅膀
  g.tri(11, Y(11, 11), 18, Y(18, 11), tx, ty, wingHi);
  if (!dive && !fallen) for (let i = 0; i < 3; i++) g.paint(tx + 1 + i, ty + (f === 2 ? -1 : 1) * i * 0.5, wing);
  // 腐爛：翅膀破洞、露骨
  const r = rng(seed);
  g.paint(13, Y(13, 13), FLESH[1]);
  if (r() < 0.6) g.paint(16, Y(16, 14), BONE);
  // 腳（垂著）
  g.set(14, Y(14, 16), 0x5a5a50);
  g.set(17, Y(17, 16), 0x5a5a50);
  g.outline();
  g.set(22, Y(22, 9), EYE);
}

// ───────────────────────── 屍熊 ─────────────────────────

function drawBear(g: Grid, f: number, pal: [number, number, number], seed: number): void {
  const dark = pal[0];
  const far = darken(pal[0], 0.75);
  if (f >= 6) {
    const k = f - 6;
    const lift = [8, 3, 0][k];
    const cy = 44 - lift;
    for (const [hx, dx] of [
      [22, 6],
      [30, 7],
      [48, 7],
      [54, 6],
    ])
      g.line(hx, cy + 5, hx + dx, cy + 8 + (k === 0 ? 2 : 0), 5, hx % 4 ? far : dark);
    g.ellipse(38, cy, 21, 8, pal, k === 0 ? 0.1 : 0);
    g.ellipse(60, cy + 2, 7, 6, pal);
    g.rect(64, cy + 3, 6, 4, pal[1]);
    for (let i = 0; i < 5; i++) g.paint(32 + i * 2, cy - 2, BONE);
    g.outline();
    return;
  }
  const walk = f <= 3;
  const phase = walk ? f / 4 : 0;
  const bob = walk ? (f % 2 === 0 ? 0 : -1) : 0;
  // 人立：前高後低；揮掌：身體前傾
  const pitch = f === 4 ? -0.35 : f === 5 ? 0.06 : 0;
  const Y = (x: number, y: number) => y + bob + pitch * (x - 30);

  const legs: [number, number, number][] = [
    [46, 0.5, 1],
    [22, 0, 1],
    [52, 0, 0],
    [28, 0.5, 0],
  ];
  for (const [hx, off, isFar] of legs) {
    const front = hx > 36;
    const hy = Y(hx, 38);
    let dx: number;
    let dy: number;
    if (f === 4 && front) [dx, dy] = [6, -4];
    else if (f === 5 && front) [dx, dy] = isFar ? [4, 10] : [14, 2];
    else if (walk) [dx, dy] = legSwing(phase + off, 16, 0.35);
    else [dx, dy] = [0, 16];
    const footY = Math.min(54, hy + dy);
    const c = isFar ? far : dark;
    g.line(hx, hy, hx + dx * 0.5, hy + (footY - hy) * 0.5, 7, c);
    g.line(hx + dx * 0.5, hy + (footY - hy) * 0.5, hx + dx, footY, 6, c);
    // 爪子
    if (!isFar || f === 5) for (let i = 0; i < 3; i++) g.set(hx + dx + 2 + i, footY + (f === 5 && front ? -1 : 0), BONE);
  }
  // 身體、肩峰
  g.ellipse(36, Y(36, 30), 20, 12, pal, pitch);
  g.ellipse(44, Y(44, 22), 10, 7, pal, pitch);
  // 頭
  g.ellipse(60, Y(60, 23), 8, 7, pal, pitch);
  g.rect(66, Y(66, 24), 6, 5, pal[1]);
  g.rect(70, Y(70, 24), 2, 2, 0x1a1414);
  // 張嘴
  const open = f === 4 || f === 5 ? 2 : 0;
  g.rect(65, Y(65, 29) + open, 6, 2, pal[0]);
  // 耳朵
  g.ellipse(55, Y(55, 16), 2.5, 2.5, pal);
  g.ellipse(61, Y(61, 15), 2.5, 2.5, pal);
  // 腐爛：側腹撕開露出肋骨
  for (let i = 0; i < 6; i++) {
    const x = 28 + i * 2;
    for (let j = 0; j < 6; j++) g.paint(x, Y(x, 29 + j), j % 2 ? FLESH[0] : FLESH[1]);
    for (let j = 0; j < 6; j++) g.paint(x, Y(x, 29 + j), BONE);
    g.paint(x + 1, Y(x + 1, 30), FLESH[0]);
    g.paint(x + 1, Y(x + 1, 33), FLESH[2]);
  }
  const r = rng(seed);
  for (let i = 0; i < 6; i++) {
    const x = 20 + Math.floor(r() * 36);
    g.paint(x, Y(x, 22 + Math.floor(r() * 14)), FLESH[Math.floor(r() * 3)]);
  }
  g.outline();
  g.set(63, Y(63, 20), EYE);
  g.set(64, Y(64, 20), EYE);
  if (open) for (const x of [66, 68, 70]) g.set(x, Y(x, 29), BONE);
}

// ───────────────────────── 合成 ─────────────────────────

function darken(c: number, k: number): number {
  return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DRAW: Record<AnimalKind, (g: Grid, f: number, pal: [number, number, number], seed: number) => void> = {
  dog: drawDog,
  crow: drawCrow,
  bear: drawBear,
};

/** 合成（或取出快取）一種動物的一個毛色，回傳貼圖 key，並建立 _walk/_attack/_death 動畫 */
export function composeAnimal(scene: Phaser.Scene, kind: AnimalKind, variant: number): string {
  const pals = ANIMAL_PALETTES[kind];
  const v = ((variant % pals.length) + pals.length) % pals.length;
  const key = `animal_${kind}_${v}`;
  if (scene.textures.exists(key)) return key;
  const info = ANIMAL_FRAMES[kind];
  const cv = document.createElement('canvas');
  cv.width = info.w * info.frames;
  cv.height = info.h;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(cv.width, cv.height);
  for (let f = 0; f < info.frames; f++) {
    const g = new Grid(info.w, info.h);
    DRAW[kind](g, f, pals[v], 7 + v * 31);
    for (let y = 0; y < info.h; y++) {
      for (let x = 0; x < info.w; x++) {
        const c = g.px[y * info.w + x];
        if (c < 0) continue;
        const i = (y * cv.width + f * info.w + x) * 4;
        img.data[i] = (c >> 16) & 255;
        img.data[i + 1] = (c >> 8) & 255;
        img.data[i + 2] = c & 255;
        img.data[i + 3] = 255;
      }
    }
  }
  cx.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(key, cv)!;
  for (let f = 0; f < info.frames; f++) tex.add(f, 0, f * info.w, 0, info.w, info.h);
  const fr = (list: number[]) => list.map((frame) => ({ key, frame }));
  scene.anims.create({ key: `${key}_walk`, frames: fr(info.walk), frameRate: info.walkRate, repeat: -1 });
  scene.anims.create({ key: `${key}_attack`, frames: fr(info.attack), frameRate: kind === 'crow' ? 1 : 12 });
  scene.anims.create({ key: `${key}_death`, frames: fr(info.death), frameRate: kind === 'crow' ? 6 : 10 });
  return key;
}
