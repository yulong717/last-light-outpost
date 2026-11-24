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
/** 0–14 原本的走路、攻擊、倒地；15–25 是 H3 做的受擊、擊飛、落地、爬起（見 REACT_FRAMES） */
const FRAMES = 26;
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
  /** 頭髮（女性霧屍）；null 用原圖的短髮 */
  hair?: { style: HairStyle; color: number } | null;
  /** 裙子顏色：褲子上半段畫成裙子、膝蓋以下露出腿；null 一般褲子 */
  skirt?: number | null;
}

export type HairStyle = 'long' | 'ponytail' | 'bob';

/**
 * 每一格「頭頂中心」在 64×64 影格中的位置（朝右的原圖座標）。
 * 0–3 走路、4 蓄力、5 前撲、6–11 中槍後退到倒下前；12–14 已經倒地，頭飾在那之前就掉了。
 * 15–17 受擊、18–19 擊飛、20–21 落地、22–25 爬起；飛在空中和躺著的格子不畫頭飾（null）。
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
  { x: 34, y: 5 },
  { x: 12, y: 6 },
  { x: 39, y: 7 },
  null,
  null,
  null,
  null,
  null,
  null,
  { x: 42, y: 20 },
  { x: 39, y: 5 },
];

/** 受擊與擊飛影格在 zombie_basic 裡的位置（舊的 15 格底圖沒有這些，要先檢查 hasReact） */
export const REACT_FRAMES = { hit: [15, 16, 17], rise: 18, fall: 19, bounce: 20, down: 21, getup: [22, 23, 24, 25] } as const;

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
    l.hair ? `${l.hair.style}${l.hair.color.toString(16)}` : '-',
    l.skirt == null ? '-' : l.skirt.toString(16),
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
          if (look.skirt != null) {
            // 裙子：站姿時膝蓋（褲子頂端往下 10 列）以下露出腿；倒地格整片當長裙
            if (torso && y > info.pantsTop + 10) {
              put(i, skinRamp(i) ?? skinFromBase(base, i));
            } else {
              put(i, ramp(look.skirt, t));
            }
            continue;
          }
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
    if (look.hair) drawHair(out, base, W, f, look.hair);
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
  widenByKey.set(key, look.widen);
  return key;
}

// ───────────────────────── 斷肢用的底圖資訊 ─────────────────────────

const widenByKey = new Map<string, number>();

/** 斷肢（ZombieGore）要知道的底圖資訊：每格的區域分類、軀幹位置、加寬前的中心 */
export interface GoreBase {
  /** 底圖某格某點（加寬前座標）的區域：0 透明、2 上衣、3 褲子，其他是皮膚、外框等 */
  region: (f: number, x: number, y: number) => number;
  torsoRight: (f: number) => number | null;
  /** 某格褲子開始的列（至少 4 個褲子像素的第一列） */
  pantsTop: (f: number) => number;
  center: (f: number) => number;
}

export const GORE_REGION = { none: Region.None, shirt: Region.Shirt, pants: Region.Pants } as const;

const goreBaseCache = new WeakMap<BaseData, GoreBase>();

export function goreBase(scene: Phaser.Scene): GoreBase | null {
  const base = loadBase(scene);
  if (!base) return null;
  const hit = goreBaseCache.get(base);
  if (hit) return hit;
  const at = (f: number, x: number, y: number) => (x < 0 || x >= F || y < 0 || y >= F ? Region.None : base.region[y * base.w + f * F + x]);
  // center／pantsTop 要掃整格，而斷肢每個像素都會問一次：每格只算一次、記起來（以前每次都重掃，切一張要上百毫秒）
  const centers = new Map<number, number>();
  const pantsTops = new Map<number, number>();
  const pantsTop = (f: number) => {
    const c = pantsTops.get(f);
    if (c !== undefined) return c;
    let top = F;
    for (let y = 0; y < F && top === F; y++) {
      let n = 0;
      for (let x = 0; x < F; x++) if (at(f, x, y) === Region.Pants) n++;
      if (n >= 4) top = y;
    }
    pantsTops.set(f, top);
    return top;
  };
  const gb: GoreBase = {
    region: at,
    torsoRight: (f) => base.frames[f]?.torso?.r ?? null,
    pantsTop,
    center: (f) => {
      let c = centers.get(f);
      if (c === undefined) centers.set(f, (c = frameCenter(base, f)));
      return c;
    },
  };
  goreBaseCache.set(base, gb);
  return gb;
}

/** 這張貼圖是用哪個加寬倍率合成的；不是合成出來的（zombie_basic 原圖）回傳 1，其他貼圖回傳 null */
export function widenOf(key: string): number | null {
  if (key === 'zombie_basic') return 1;
  return widenByKey.get(key) ?? null;
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

/** 倒地格的頭部範圍（頭往後仰躺在左邊） */
const LYING_HEADS: Record<number, { x0: number; y0: number; x1: number; y1: number }> = {
  12: { x0: 7, y0: 19, x1: 23, y1: 29 },
  13: { x0: 3, y0: 31, x1: 19, y1: 42 },
  14: { x0: 2, y0: 44, x1: 16, y1: 53 },
};

/**
 * 長髮：把頭頂（臉以外）的像素染成髮色，再在後腦（原圖朝右，所以是左邊）往下垂一段。
 * 位置跟著 HEAD_ANCHORS，所以每格都對得上；倒地格只染後腦。
 */
function drawHair(
  out: Uint8ClampedArray,
  base: BaseData,
  W: number,
  f: number,
  hair: { style: HairStyle; color: number },
): void {
  const at = (x: number, y: number) => (y * W + f * F + x) * 4;
  const opaque = (x: number, y: number) => x >= 0 && x < F && y >= 0 && y < F && out[at(x, y) + 3] > 0;
  const set = (x: number, y: number, c: [number, number, number] | number) => {
    if (x < 0 || x >= F || y < 0 || y >= F) return;
    const i = at(x, y);
    const rgb = typeof c === 'number' ? rgbOf(c) : c;
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = 255;
  };
  const shade = (k: number) => ramp(hair.color, k);
  const a = HEAD_ANCHORS[f];
  if (!a) {
    const b = LYING_HEADS[f];
    if (!b) return;
    const cut = b.x0 + (b.x1 - b.x0) * 0.42;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= cut; x++) {
        if (!opaque(x, y) || base.region[y * W + f * F + x] === Region.Outline) continue;
        set(x, y, shade(0.35 + 0.4 * (((x + y) & 3) === 0 ? 1 : 0.5)));
      }
    }
    return;
  }
  // 頭頂：錨點往下 3 列內、臉（錨點右邊 5 格以外）之外的像素都染成頭髮
  for (let y = a.y - 4; y <= a.y + 3; y++) {
    for (let x = a.x - 10; x <= a.x + 5; x++) {
      if (!opaque(x, y)) continue;
      const r = base.region[y * W + f * F + x];
      if (r === Region.Outline) continue;
      set(x, y, shade(y <= a.y ? 0.95 : 0.6 + (((x * 7 + y) % 3) === 0 ? 0.25 : 0)));
    }
  }
  // 後腦垂下的頭髮
  const len = hair.style === 'long' ? 15 : hair.style === 'bob' ? 9 : 0;
  const backX = (y: number) => {
    for (let x = 0; x < F; x++) if (opaque(x, y) && Math.abs(x - a.x) < 14) return x;
    return a.x - 8;
  };
  if (len > 0) {
    for (let k = 0; k < len; k++) {
      const y = a.y + 1 + k;
      const bx = backX(Math.min(y, a.y + 6)) - (k > 4 ? 1 : 0);
      const w = hair.style === 'long' ? (k < len - 3 ? 5 : 4 - (k - (len - 3))) : 4;
      set(bx - 1, y, OUTLINE);
      for (let x = bx; x < bx + w; x++) set(x, y, shade(x === bx ? 0.45 : 0.75));
      if (k === len - 1) for (let x = bx - 1; x < bx + w; x++) set(x, y + 1, OUTLINE);
    }
  } else {
    // 馬尾：從後腦往左下甩
    const sx = backX(a.y + 2);
    const pts = [
      [0, 2],
      [-1, 3],
      [-2, 4],
      [-2, 5],
      [-3, 6],
      [-3, 7],
      [-3, 8],
      [-2, 9],
    ];
    for (const [dx, dy] of pts) {
      set(sx + dx - 1, a.y + dy, OUTLINE);
      set(sx + dx, a.y + dy, shade(0.7));
      set(sx + dx + 1, a.y + dy, shade(0.5));
    }
    set(sx - 2, a.y + 10, OUTLINE);
    set(sx - 1, a.y + 10, OUTLINE);
    // 髮圈
    set(sx, a.y + 2, 0xd04060);
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
