import Phaser from 'phaser';
import type { HatId, HsvShift, PantsPattern, ShirtPattern } from '../data/zombies';
import { registerHeadFrames } from './ProceduralArt';
import { ZOMBIE_NECK_ROW } from './sprites';

/**
 * 霧屍外觀的「執行期合成」：以 zombie_basic（PixelLab 走路＋倒地，15 格）為底，
 * 依原圖的區域（皮膚／上衣／褲子）重新上色、畫上制服圖樣（警用背心、反光條、迷彩…）、
 * 背包與血跡，再水平加寬做出體型差異。頭飾不烤進圖裡，而是另一張小圖疊在頭上
 * （見 HEAD_ANCHORS），這樣頭盔能被打飛、而且頭飾種類不會讓貼圖數量翻倍。
 *
 * 完全不需要外部工具；同一組外觀只會合成一次（以 key 快取）。
 */

const F = 64;
const FRAMES = 15;
const OUTLINE = 0x120d0a;

export interface BodyLook {
  skin: HsvShift;
  shirt: number;
  pants: number;
  shirtPattern: ShirtPattern;
  pantsPattern: PantsPattern;
  /** 背包顏色；null 沒有背包 */
  backpack: number | null;
  /** 血跡塊數 */
  blood: number;
  widen: number;
  /** 血跡位置等細節的亂數種子 */
  seed: number;
}

/**
 * 每一格「頭頂中心」在 64×64 影格中的位置（朝右的原圖座標）。
 * 0–3 走路、4 蓄力、5 前撲、6–11 中槍後退到倒下前；12–14 已經倒地，頭飾在那之前就掉了。
 * 換了底圖要重量一次（tools/art 的腳本可印出每格的頭部範圍）。
 */
export const HEAD_ANCHORS: ({ x: number; y: number } | null)[] = [
  { x: 39, y: 7 },
  { x: 39, y: 6 },
  { x: 39, y: 7 },
  { x: 38, y: 6 },
  { x: 36, y: 6 },
  { x: 45, y: 10 },
  { x: 39, y: 7 },
  { x: 38, y: 6 },
  { x: 36, y: 5 },
  { x: 33, y: 5 },
  { x: 28, y: 5 },
  { x: 21, y: 6 },
  null,
  null,
  null,
];

/** 原圖的腳底列，Zombie 的 origin 用這個 */
export const FOOT_ROW = 62;

// ───────────────────────── 區域分類 ─────────────────────────

const enum Region {
  None = 0,
  Outline,
  Shirt,
  Pants,
  Skin,
  Other,
}

interface BaseData {
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
  region: Uint8Array;
  /** 每個像素的 HSV（0..1） */
  hsv: Float32Array;
  /** 各區域明度範圍，用來把原本的明暗映射到新顏色 */
  vRange: Record<number, [number, number]>;
  frames: FrameInfo[];
}

interface FrameInfo {
  /** 軀幹（上衣主體）左右邊界與上衣最上列；倒地格為 null */
  torso: { l: number; r: number; top: number; bottom: number } | null;
  pantsTop: number;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, mx === 0 ? 0 : d / mx, mx];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return [Math.round(m[0] * 255), Math.round(m[1] * 255), Math.round(m[2] * 255)];
}

/** 和 tools/art/make_zombie_variants.py 的 classify() 相同規則 */
function classify(h: number, s: number, v: number): Region {
  const hd = h * 360;
  if (v < 0.11) return Region.Outline;
  if (s < 0.07 && v > 0.58) return Region.Shirt;
  if (hd >= 165 && hd <= 230 && s > 0.15) return Region.Pants;
  if (hd >= 70 && hd <= 165 && s >= 0.07) return Region.Skin;
  return Region.Other;
}

const baseCache = new WeakMap<Phaser.Textures.TextureManager, BaseData | null>();

function loadBase(scene: Phaser.Scene): BaseData | null {
  const tm = scene.textures;
  if (baseCache.has(tm)) return baseCache.get(tm)!;
  const tex = tm.get('zombie_basic');
  const img = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!img || img.width < F * FRAMES) {
    baseCache.set(tm, null);
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = F * FRAMES;
  cv.height = F;
  const cx = cv.getContext('2d')!;
  cx.drawImage(img, 0, 0);
  const rgba = cx.getImageData(0, 0, cv.width, cv.height).data;
  const n = cv.width * cv.height;
  const region = new Uint8Array(n);
  const hsv = new Float32Array(n * 3);
  const vRange: Record<number, [number, number]> = {};
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] === 0) continue;
    const [h, s, v] = rgbToHsv(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    hsv[i * 3] = h;
    hsv[i * 3 + 1] = s;
    hsv[i * 3 + 2] = v;
    const r = classify(h, s, v);
    region[i] = r;
    const vr = (vRange[r] ??= [1, 0]);
    vr[0] = Math.min(vr[0], v);
    vr[1] = Math.max(vr[1], v);
  }
  keepEyes(region, cv.width, cv.height);
  const frames: FrameInfo[] = [];
  for (let f = 0; f < FRAMES; f++) frames.push(frameInfo(region, cv.width, f));
  const data: BaseData = { w: cv.width, h: cv.height, rgba, region, hsv, vRange, frames };
  baseCache.set(tm, data);
  return data;
}

/**
 * 眼睛是白色的，顏色規則會把它當成上衣。上衣是一大片，眼睛只是被皮膚包住的幾個像素：
 * 連通塊很小、而且碰到皮膚的白色像素改標成 Other，保留原色。
 */
function keepEyes(region: Uint8Array, W: number, H: number): void {
  const seen = new Uint8Array(region.length);
  const stack: number[] = [];
  for (let i = 0; i < region.length; i++) {
    if (region[i] !== Region.Shirt || seen[i]) continue;
    const comp: number[] = [];
    let touchesSkin = false;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      comp.push(j);
      const x = j % W;
      const y = (j / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        // 不跨影格
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || ((nx / F) | 0) !== ((x / F) | 0)) continue;
        const k = ny * W + nx;
        if (region[k] === Region.Skin) touchesSkin = true;
        if (region[k] === Region.Shirt && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    if (comp.length <= 6 && touchesSkin) for (const j of comp) region[j] = Region.Other;
  }
}

/** 找出軀幹：上衣像素多的連續欄位（袖子、伸出去的手臂只有幾列，會被排除） */
function frameInfo(region: Uint8Array, W: number, f: number): FrameInfo {
  if (!HEAD_ANCHORS[f]) return { torso: null, pantsTop: 0 };
  const cols: number[] = [];
  let pantsTop = F;
  for (let x = 0; x < F; x++) {
    let c = 0;
    for (let y = 0; y < F; y++) {
      const r = region[y * W + f * F + x];
      if (r === Region.Shirt) c++;
      if (r === Region.Pants) pantsTop = Math.min(pantsTop, y);
    }
    cols.push(c);
  }
  let best: [number, number] = [0, -1];
  let start = -1;
  for (let x = 0; x <= F; x++) {
    const on = x < F && cols[x] >= 6;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start > best[1] - best[0] + 1) best = [start, x - 1];
      start = -1;
    }
  }
  if (best[1] < best[0]) return { torso: null, pantsTop };
  let top = F;
  let bottom = 0;
  for (let x = best[0]; x <= best[1]; x++) {
    for (let y = 0; y < F; y++) {
      if (region[y * W + f * F + x] === Region.Shirt) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { torso: { l: best[0], r: best[1], top, bottom }, pantsTop };
}

// ───────────────────────── 上色 ─────────────────────────

const rgbOf = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

/** 把原本 0..1 的明暗映射成目標色的深淺：暗部壓低、亮部稍微提亮 */
function ramp(c: number, t: number): [number, number, number] {
  const [r, g, b] = rgbOf(c);
  const k = 0.42 + 0.72 * t;
  return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)].map(Math.round) as [number, number, number];
}

/** 簡單的格狀雜訊：迷彩塊 */
function camo(x: number, y: number, seed: number): number {
  const gx = Math.floor((x + seed) / 3);
  const gy = Math.floor(y / 2);
  const h = Math.sin(gx * 12.9898 + gy * 78.233 + seed) * 43758.5453;
  return h - Math.floor(h);
}

class Rng {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
}

export function lookKey(l: BodyLook): string {
  return `zb_${[
    l.skin.join(','),
    l.shirt.toString(16),
    l.pants.toString(16),
    l.shirtPattern,
    l.pantsPattern,
    l.backpack === null ? '-' : l.backpack.toString(16),
    l.blood,
    l.widen.toFixed(2),
    l.seed,
  ].join('_')}`;
}

/**
 * 合成（或從快取取出）一組外觀，回傳貼圖 key。
 * 會一併建立 `${key}_walk` / `_attack` / `_death` 動畫與爆頭用的 head_N 影格。
 * 底圖沒載到（色塊佔位）時回傳 'zombie_basic'。
 */
export function composeZombie(scene: Phaser.Scene, look: BodyLook): string {
  const key = lookKey(look);
  if (scene.textures.exists(key)) return key;
  const base = loadBase(scene);
  if (!base) return 'zombie_basic';

  const W = base.w;
  const raw = document.createElement('canvas');
  raw.width = W;
  raw.height = F;
  const rc = raw.getContext('2d')!;
  const img = rc.createImageData(W, F);
  const out = img.data;
  out.set(base.rgba);

  const skinRamp = (i: number): [number, number, number] | null => {
    const [hue, sMul, vMul] = look.skin;
    if (hue < 0) return null;
    const s = Math.min(1, Math.max(base.hsv[i * 3 + 1], 0.05) * sMul);
    const v = Math.min(1, base.hsv[i * 3 + 2] * vMul);
    return hsvToRgb(hue / 360, s, v);
  };
  const norm = (i: number, r: Region): number => {
    const [lo, hi] = base.vRange[r] ?? [0, 1];
    return Phaser.Math.Clamp((base.hsv[i * 3 + 2] - lo) / Math.max(0.01, hi - lo), 0, 1);
  };
  const put = (i: number, c: [number, number, number]): void => {
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
  };

  for (let f = 0; f < FRAMES; f++) {
    const info = base.frames[f];
    const torso = info.torso;
    for (let y = 0; y < F; y++) {
      for (let x = 0; x < F; x++) {
        const gx = f * F + x;
        const i = y * W + gx;
        const r = base.region[i];
        if (r === Region.None || r === Region.Outline || r === Region.Other) continue;
        if (r === Region.Skin) {
          const c = skinRamp(i);
          if (c) put(i, c);
          continue;
        }
        const t = norm(i, r);
        if (r === Region.Pants) {
          let col = look.pants;
          if (look.pantsPattern === 'camo') {
            const n = camo(x, y, look.seed);
            col = n < 0.3 ? darken(look.pants, 0.6) : n > 0.78 ? 0x6a5030 : look.pants;
          } else if (look.pantsPattern === 'fire' && torso && y === info.pantsTop + 12) {
            col = 0xe8d850;
          }
          put(i, ramp(col, t));
          continue;
        }
        // 上衣
        const inTorso = !!torso && x >= torso.l && x <= torso.r;
        const ty = torso ? y - torso.top : -99;
        let col = look.shirt;
        let tt = t;
        switch (look.shirtPattern) {
          case 'police':
            if (inTorso && ty >= 1 && ty <= 13) {
              col = 0x2a2c34;
              tt = t * 0.7;
              if (ty === 3 && x === torso!.r - 3) col = 0xe8c040; // 警徽
            }
            break;
          case 'hivis':
            if (inTorso && (ty === 4 || ty === 5 || ty === 10 || ty === 11)) {
              col = 0xf0f0d0;
              tt = 1;
            }
            break;
          case 'fire':
            if (ty === 8 || (!inTorso && torso && Math.abs(y - (torso.top + 6)) <= 0)) {
              col = 0xe8d850;
              tt = 1;
            } else if (ty === 9) {
              col = 0xc8c8c8;
              tt = 1;
            }
            break;
          case 'camo': {
            const n = camo(x, y, look.seed);
            col = n < 0.3 ? darken(look.shirt, 0.6) : n > 0.78 ? 0x6a5030 : look.shirt;
            // 防彈背心：軀幹中段深一號
            if (inTorso && ty >= 1 && ty <= 12) {
              col = darken(col, 0.75);
              tt = t * 0.85;
            }
            break;
          }
          case 'tank':
            // 背心：袖子露出皮膚
            if (torso && !inTorso) {
              const c = skinRamp(i) ?? skinFromBase(base, i);
              put(i, c);
              continue;
            }
            break;
          case 'scrubs':
            if (inTorso && ty >= 1 && ty <= 3 && x >= torso!.r - 4 && x <= torso!.r - 2) {
              // V 領露出一點皮膚
              const c = skinRamp(i) ?? skinFromBase(base, i);
              put(i, c);
              continue;
            }
            break;
          default:
            break;
        }
        put(i, ramp(col, tt));
      }
    }
    if (torso) decorate(out, W, f, torso, look);
  }
  rc.putImageData(img, 0, 0);

  // 加寬：每格以身體中心為軸水平縮放（最近鄰，保持像素硬邊）
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = F;
  const cc = cv.getContext('2d')!;
  cc.imageSmoothingEnabled = false;
  for (let f = 0; f < FRAMES; f++) {
    if (Math.abs(look.widen - 1) < 0.01) {
      cc.drawImage(raw, f * F, 0, F, F, f * F, 0, F, F);
      continue;
    }
    const cxm = frameCenter(base, f);
    const w = Math.round(F * look.widen);
    const dx = Math.round(cxm - cxm * look.widen);
    cc.save();
    cc.beginPath();
    cc.rect(f * F, 0, F, F);
    cc.clip();
    cc.drawImage(raw, f * F, 0, F, F, f * F + dx, 0, w, F);
    cc.restore();
  }

  const tex = scene.textures.addCanvas(key, cv)!;
  for (let f = 0; f < FRAMES; f++) tex.add(f, 0, f * F, 0, F, F);
  registerAnims(scene, key);
  registerHeadFrames(scene, key, ZOMBIE_NECK_ROW);
  return key;
}

function darken(c: number, k: number): number {
  const [r, g, b] = rgbOf(c);
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}

/** 原圖的皮膚色（沒有換膚色時，背心袖子用原本的灰綠） */
function skinFromBase(base: BaseData, i: number): [number, number, number] {
  return hsvToRgb(0.3, Math.min(1, base.hsv[i * 3 + 1] * 0.6 + 0.12), base.hsv[i * 3 + 2] * 0.85);
}

function frameCenter(base: BaseData, f: number): number {
  let l = F;
  let r = 0;
  for (let y = 0; y < F; y++) {
    for (let x = 0; x < F; x++) {
      if (base.region[y * base.w + f * F + x] !== Region.None) {
        l = Math.min(l, x);
        r = Math.max(r, x);
      }
    }
  }
  return (l + r + 1) / 2;
}

/** 背包與血跡：位置相對於軀幹，所以每一格都在同一個地方 */
function decorate(
  out: Uint8ClampedArray,
  W: number,
  f: number,
  torso: { l: number; r: number; top: number; bottom: number },
  look: BodyLook,
): void {
  const set = (x: number, y: number, c: number, onlyOpaque = false): void => {
    if (x < 0 || x >= F || y < 0 || y >= F) return;
    const i = (y * W + f * F + x) * 4;
    if (onlyOpaque && out[i + 3] === 0) return;
    out[i] = (c >> 16) & 255;
    out[i + 1] = (c >> 8) & 255;
    out[i + 2] = c & 255;
    out[i + 3] = 255;
  };
  const rng = new Rng(look.seed);
  // 血跡：軀幹上的深紅色小塊
  for (let k = 0; k < look.blood; k++) {
    const bx = torso.l + 1 + Math.floor(rng.next() * Math.max(1, torso.r - torso.l - 2));
    const by = torso.top + 2 + Math.floor(rng.next() * Math.max(1, torso.bottom - torso.top - 3));
    const size = 1 + Math.floor(rng.next() * 3);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size + 1; dx++) {
        if (rng.next() < 0.75) set(bx + dx, by + dy, rng.next() < 0.5 ? 0x6e1010 : 0x8a1a1a, true);
      }
    }
    // 往下滴
    if (rng.next() < 0.6) set(bx, by + size, 0x5a0c0c, true);
  }
  if (look.backpack !== null) {
    // 背包在背後（原圖朝右，所以是左邊），肩帶跨過軀幹
    const c = look.backpack;
    const x0 = torso.l - 4;
    const y0 = torso.top + 1;
    const h = Math.min(10, torso.bottom - torso.top);
    for (let y = y0; y <= y0 + h; y++) {
      for (let x = x0; x <= torso.l; x++) {
        const edge = x === x0 || y === y0 || y === y0 + h;
        set(x, y, edge ? OUTLINE : y === y0 + 1 ? lighten(c) : x === x0 + 1 ? darken(c, 0.75) : c);
      }
    }
    for (let y = y0; y <= y0 + 5; y++) set(torso.l + 2, y, darken(c, 0.6), true);
  }
}

function lighten(c: number): number {
  const [r, g, b] = rgbOf(c);
  return (Math.min(255, r + 40) << 16) | (Math.min(255, g + 40) << 8) | Math.min(255, b + 40);
}

function registerAnims(scene: Phaser.Scene, key: string): void {
  const fr = (list: number[]) => list.map((frame) => ({ key, frame }));
  scene.anims.create({ key: `${key}_walk`, frames: fr([0, 1, 2, 3]), frameRate: 6, repeat: -1 });
  scene.anims.create({ key: `${key}_attack`, frames: fr([4, 4, 5, 5, 0]), frameRate: 14 });
  scene.anims.create({ key: `${key}_death`, frames: fr([6, 7, 8, 9, 10, 11, 12, 13, 14]), frameRate: 16 });
}

// ───────────────────────── 頭飾 ─────────────────────────

/**
 * 頭飾像素圖。'o' 外框，'a' 主色，'b' 亮部，'c' 暗部，'d'/'e' 點綴色。
 * ax/ay 是對到「頭頂中心」（HEAD_ANCHORS）的那一格；朝右繪製，帽沿在右邊。
 * tintable 的頭飾用淺灰繪製，執行時再 setTint 成隨機顏色。
 */
interface HatArt {
  rows: string[];
  ax: number;
  ay: number;
  pal: Record<string, number>;
  tintable?: boolean;
}

const GREY = { a: 0xd0d0d0, b: 0xffffff, c: 0x8c8c8c };

export const HAT_ART: Record<Exclude<HatId, 'none'>, HatArt> = {
  cap: {
    ax: 8,
    ay: 1,
    tintable: true,
    pal: { ...GREY, d: 0xffffff },
    rows: [
      '....oooooooo.......',
      '..ooaabbaaaaoo.....',
      '.oabaaaaaaaaaao....',
      '.oaaaaaaaaaaaaao...',
      '.occcccccccccccoooo',
      '..oooooooooooooccco',
      '...............oooo',
    ],
  },
  beanie: {
    ax: 8,
    ay: 2,
    tintable: true,
    pal: { ...GREY, d: 0xa0a0a0 },
    rows: [
      '.......ooo........',
      '.....oobaboo......',
      '...ooaabaaaaoo....',
      '..oabaaaaaaaaao...',
      '.oaaaaaaaaaaaaao..',
      '.oaaaaaaaaaaaaaao.',
      '.ocdcdcdcdcdcdcdo.',
      '.ooooooooooooooooo',
    ],
  },
  bandana: {
    ax: 9,
    ay: -1,
    tintable: true,
    pal: { ...GREY, d: 0xffffff },
    rows: [
      '...oooooooooooooo..',
      '..oaaaaadaaaadaaao.',
      'ooocccccccccccccco.',
      'oaoooooooooooooooo.',
      'oco................',
      'oo.................',
    ],
  },
  police_cap: {
    ax: 8,
    ay: 1,
    pal: { a: 0x1e2a48, b: 0x34446e, c: 0x141c30, d: 0xe8c040, e: 0x101010 },
    rows: [
      '..ooooooooooooo....',
      '.oaabbbbbbbbbaao...',
      '.oaaaaaaadaaaaao...',
      '..oaaaaaaaaaaao....',
      '..occcccccccccooooo',
      '...oooooooooooeeeeo',
      '..............ooooo',
    ],
  },
  riot_helmet: {
    ax: 8,
    ay: 2,
    pal: { a: 0x24304a, b: 0x46587a, c: 0x151c2c, d: 0x9ad0f0, e: 0x6aa0c8 },
    rows: [
      '.....ooooooo.......',
      '...ooaabbbaaoo.....',
      '..oabbaaaaaaaao....',
      '.oabaaaaaaaaaaao...',
      '.oaaaaaaaaaaaaaoo..',
      '.oaaaaaaaaaaaaodeo.',
      '.oaaaaaaaaaaaaodeo.',
      '.occcccccccccoodeo.',
      '..oooooooooooo.oeo.',
      '................o..',
    ],
  },
  hard_hat: {
    ax: 9,
    ay: 2,
    pal: { a: 0xf0c020, b: 0xfff080, c: 0xb08010, d: 0xc89818 },
    rows: [
      '.......ooooo........',
      '.....ooabbaaoo......',
      '....oabbaaaaaao.....',
      '...oabaaaadaaaao....',
      '...oaaaaaadaaaaao...',
      '...oaaaaaaaaaaaao...',
      '.ooooooooooooooooooo',
      '.oddddddddddddddddo.',
      '..oooooooooooooooo..',
    ],
  },
  fire_helmet: {
    ax: 9,
    ay: 2,
    tintable: true,
    pal: { ...GREY, d: 0xffe890, e: 0xc8a040 },
    rows: [
      '.......oooooo.......',
      '.....ooabbaaoo......',
      '....oabaaaaaaaoo....',
      '...oabaaaaaoddoao...',
      '...oaaaaaaaodeodo...',
      'oooaaaaaaaaaoddoao..',
      'occcccccccccccccccoo',
      '.ooooooooooooooooooo',
    ],
  },
  army_helmet: {
    ax: 9,
    ay: 2,
    pal: { a: 0x56643a, b: 0x74845a, c: 0x3a4426, d: 0x2a3018 },
    rows: [
      '......oooooooo......',
      '....ooaabbaaaaoo....',
      '...oaabaacaaacaao...',
      '..oaaaaaaaaaaaaaao..',
      '..oaacaaaaacaaaaaao.',
      '.oaaaaaaaaaaaaaaaao.',
      '.ocacccccccccccccco.',
      '..oooooooooooooooo..',
      '...............od...',
      '...............od...',
    ],
  },
  nurse_cap: {
    ax: 8,
    ay: 0,
    pal: { a: 0xf4f4f0, b: 0xffffff, c: 0xb8b8b0, d: 0xd02020 },
    rows: [
      '....oooooooooo...',
      '...oaaaaadaaaao..',
      '...oaaaadddaaao..',
      '...oaaaaadaaaao..',
      '...occcccccccco..',
      '....oooooooooo...',
    ],
  },
};

export const GEAR_TEXTURE = 'zgear';

/** 頭飾貼圖：每種一格（frame 名稱 = HatId），另外一格 'mark' 是變異標記 */
export function createGearTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GEAR_TEXTURE)) return;
  const entries = Object.entries(HAT_ART) as [HatId, HatArt][];
  const cellW = 24;
  const cellH = 12;
  const cv = document.createElement('canvas');
  cv.width = cellW * (entries.length + 1);
  cv.height = cellH;
  const cx = cv.getContext('2d')!;
  const px = (x: number, y: number, c: number) => {
    cx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
    cx.fillRect(x, y, 1, 1);
  };
  entries.forEach(([, art], i) => {
    art.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        px(i * cellW + x, y, ch === 'o' ? OUTLINE : (art.pal[ch] ?? 0xff00ff));
      }
    });
  });
  // 變異標記：5×5 菱形（白色，執行時染色）
  const mx = entries.length * cellW;
  const diamond = ['..o..', '.oao.', 'oaaao', '.oao.', '..o..'];
  diamond.forEach((row, y) => {
    for (let x = 0; x < 5; x++) if (row[x] !== '.') px(mx + x, y, row[x] === 'o' ? OUTLINE : 0xffffff);
  });
  const tex = scene.textures.addCanvas(GEAR_TEXTURE, cv)!;
  entries.forEach(([id, art], i) => tex.add(id, 0, i * cellW, 0, art.rows[0].length, art.rows.length));
  tex.add('mark', 0, mx, 0, 5, 5);
}
