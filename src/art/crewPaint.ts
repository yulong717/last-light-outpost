import {
  BOOT_COLORS,
  CLOTH,
  HAIR_COLORS,
  SKIN_TONES,
  type BodyGearId,
  type CrewLook,
  type FaceGearId,
  type HeadGearId,
  type Ramp,
} from '../data/crewLooks';
import { crewBase } from '../data/crewBases';

/**
 * 紙娃娃換裝：把主角射擊圖依「部位遮罩」換色，再一層層疊上髮型、配件、帽子。
 * 純像素運算，不依賴 Phaser（CrewArt.ts 負責接到 Phaser 貼圖；crew-lab.html 也直接拿來用）。
 *
 * 座標都以「第 0 格」為準（64×64 影格內），頭部配件會依每格頭帶位置自動上下位移。
 */

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** 部位編號，和 tools/art/make_player_regions.py 一致 */
export const enum Part {
  None = 0,
  Outline = 1,
  Hair = 2,
  Skin = 3,
  Band = 4,
  Jacket = 5,
  Pants = 6,
  Boots = 7,
  Knee = 8,
  Gun = 9,
  Flash = 10,
  Detail = 11,
  /** 疊上去的配件（不再換色） */
  Gear = 12,
}

const OUTLINE_RGB: RGB = [5, 1, 1];
type RGB = [number, number, number];

const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

function rampAt(r: Ramp, t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * 3;
  const i = Math.min(2, Math.floor(x));
  const f = x - i;
  const a = hex(r[i]);
  const b = hex(r[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const lumOf = (r: number, g: number, b: number): number => 0.3 * r + 0.55 * g + 0.15 * b;

/** 固定的格點雜湊（迷彩、鬍渣用；每格都一樣，動畫時不會閃） */
function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 疊圖用的小點陣：每列一個字串，'.' 是空白 */
interface Bitmap {
  x: number;
  y: number;
  rows: string[];
}

/** 點陣字元：'o' 外框、'1'~'4' 圖層色帶暗到亮，其餘是固定色 */
const FIXED: Record<string, RGB> = {
  k: [22, 20, 22],
  w: [232, 232, 226],
  l: [168, 170, 176],
  r: [196, 36, 36],
  y: [214, 172, 64],
  a: [232, 150, 44],
  b: [92, 60, 36],
  m: [112, 118, 128],
  s: [60, 64, 72],
};

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8ClampedArray;
  readonly part: Uint8Array;

  constructor(src: Pixels, mask: Pixels) {
    this.w = src.width;
    this.h = src.height;
    this.px = new Uint8ClampedArray(src.data);
    this.part = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.part.length; i++) {
      this.part[i] = mask.data[i * 4 + 3] > 0 ? Math.round(mask.data[i * 4] / 16) : Part.None;
      if (this.px[i * 4 + 3] === 0) this.part[i] = Part.None;
    }
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inside(x: number, y: number, ox: number): boolean {
    return x >= ox && x < ox + 64 && y >= 0 && y < this.h;
  }

  get(x: number, y: number): Part {
    return this.part[this.idx(x, y)];
  }

  set(x: number, y: number, rgb: RGB, part: Part): void {
    const i = this.idx(x, y);
    this.px[i * 4] = rgb[0];
    this.px[i * 4 + 1] = rgb[1];
    this.px[i * 4 + 2] = rgb[2];
    this.px[i * 4 + 3] = 255;
    this.part[i] = part;
  }

  clear(x: number, y: number): void {
    const i = this.idx(x, y);
    this.px[i * 4 + 3] = 0;
    this.part[i] = Part.None;
  }

  lum(x: number, y: number): number {
    const i = this.idx(x, y) * 4;
    return lumOf(this.px[i], this.px[i + 1], this.px[i + 2]);
  }

  rgb(x: number, y: number): RGB {
    const i = this.idx(x, y) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }
}

/** 每個部位在原圖裡的明暗範圍（換色時把明暗拉到新色帶上） */
function lumRange(c: Canvas, part: Part): [number, number] {
  const ls: number[] = [];
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) if (c.get(x, y) === part) ls.push(c.lum(x, y));
  if (ls.length === 0) return [0, 255];
  ls.sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.04)];
  const hi = ls[Math.floor(ls.length * 0.96)];
  return [lo, Math.max(lo + 1, hi)];
}

/** 每格頭部相對第 0 格的上下位移（以頭帶最上緣為準） */
function headOffset(c: Canvas, ox: number): number {
  for (let y = 0; y < 20; y++)
    for (let x = ox; x < ox + 40; x++) if (c.get(x, y) === Part.Band) return y - 11;
  return 0;
}

/** 從橫排圖切出第 i 格 */
export function cropFrame(p: Pixels, i: number, size = 64): Pixels {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const from = (y * p.width + i * size) * 4;
    out.set(p.data.subarray(from, from + size * 4), y * size * 4);
  }
  return { width: size, height: size, data: out };
}

export interface PaintOptions {
  frameSize?: number;
}

/** 換裝結果：圖＋給 WeaponRig 畫手臂用的袖子與膚色（從畫好的圖裡取樣） */
export interface PaintedCrew extends Pixels {
  colors: { sleeve: number; sleeveHi: number; skin: number };
}

/**
 * 依外觀產生新的精靈圖。src 與 mask 尺寸必須相同（橫排多格）。
 */
export function paintCrewSheet(src: Pixels, mask: Pixels, look: CrewLook, opt: PaintOptions = {}): PaintedCrew {
  const F = opt.frameSize ?? 64;
  const c = new Canvas(src, mask);
  const frames = Math.floor(c.w / F);

  const hairRamp = HAIR_COLORS[look.hair % HAIR_COLORS.length].ramp;
  const skinRamp = SKIN_TONES[look.skin % SKIN_TONES.length];
  const jacketRamp = CLOTH[look.jacket % CLOTH.length].ramp;
  const pantsRamp = CLOTH[look.pants % CLOTH.length].ramp;
  const bootRamp = BOOT_COLORS[look.boots % BOOT_COLORS.length];
  const gearRamp = CLOTH[look.gearColor % CLOTH.length].ramp;
  const headRamp = CLOTH[look.headColor % CLOTH.length].ramp;
  const bandRamp = look.band === null ? hairRamp : CLOTH[look.band % CLOTH.length].ramp;

  // 先量原圖明暗（之後會改圖）
  const ranges = new Map<Part, [number, number]>();
  for (const p of [Part.Hair, Part.Skin, Part.Band, Part.Jacket, Part.Pants, Part.Boots, Part.Knee]) ranges.set(p, lumRange(c, p));

  // 底圖模式（不同的人）：髮型、頭帶、護膝都跟著底圖，只換允許的部位
  const based = !!look.base;
  const rc = look.recolor ?? { hair: true, top: true, bottom: true };

  for (let f = 0; f < frames; f++) {
    const ox = f * F;
    const dy = based ? 0 : headOffset(c, ox);
    const ctx: FrameCtx = { c, ox, dy, look, hairRamp, skinRamp, gearRamp, headRamp };

    // 1) 不綁頭帶：頭帶當成頭髮
    if (look.band === null) retag(c, ox, Part.Band, Part.Hair);
    // 2) 髮型修剪（帽子會再剪一次）
    if (!based) shapeHair(ctx);
    if (look.head) clipForHat(ctx, HATS[look.head].clipY);

    // 3) 依部位換色
    recolor(c, ox, ranges, (part, t, x, y) => {
      switch (part) {
        case Part.Hair:
          if (based) return rc.hair ? rampAt(hairRamp, t) : null;
          return look.hairStyle === 'shaved' || (look.hairStyle === 'mohawk' && (x < ox + 25 || x > ox + 30))
            ? mix(rampAt(hairRamp, t * 0.8), rampAt(skinRamp, t * 0.7 + 0.1), 0.55)
            : rampAt(hairRamp, t);
        case Part.Skin:
          return rampAt(skinRamp, t);
        case Part.Band:
          return rampAt(bandRamp, t);
        case Part.Jacket:
          if (based && !rc.top) return null;
          return rampAt(jacketRamp, patternT(look, t, x - ox, y));
        case Part.Pants:
          if (based && !rc.bottom) return null;
          return rampAt(pantsRamp, t);
        case Part.Boots:
          return based ? null : rampAt(bootRamp, t);
        case Part.Knee:
          return look.kneePads ? null : rampAt(pantsRamp, t * 0.7);
        default:
          return null;
      }
    });

    // 4) 加長的頭髮（畫在身後）
    if (!based) addHair(ctx);
    // 5) 身上配件、臉部配件、帽子
    for (const id of look.body) BODY[id](ctx);
    for (const id of look.face) FACE[id](ctx);
    if (look.head) drawBitmap(ctx, HATS[look.head].art, headRamp, 'over', dy);
    if (look.head === 'helmet') line(ctx, 22, 15 + dy, 23, 24 + dy, FIXED.b);

    // 6) 體格：脖子以下整段加寬或變窄（像素欄位複製／移除，不會糊）
    if (look.widen) widenBody(c, ox, F, look.widen);
    // 7) 啤酒肚、駝背
    if (look.belly) addBelly(c, ox, look.belly);
    if (look.hunch) hunchHead(c, ox, F, look.hunch);
    // 8) 修外框
    reoutline(c, ox, F);
  }
  return { width: c.w, height: c.h, data: c.px, colors: sampleArmColors(c, look, skinRamp, jacketRamp) };
}

/**
 * WeaponRig 畫手臂用的袖子顏色：取軀幹上衣像素（底圖手臂多半被手和槍擋住，取樣不準）。
 * 無袖的底圖（背心）手臂就是皮膚。
 */
function sampleArmColors(c: Canvas, look: CrewLook, skinRamp: Ramp, jacketRamp: Ramp): PaintedCrew['colors'] {
  const toHex = (p: RGB): number => (Math.round(p[0]) << 16) | (Math.round(p[1]) << 8) | Math.round(p[2]);
  const byLum = (a: RGB, b: RGB): number => lumOf(...a) - lumOf(...b);
  const sleeve: RGB[] = [];
  const skin: RGB[] = [];
  for (let y = 26; y <= 40; y++) for (let x = 18; x <= 34; x++) if (c.get(x, y) === Part.Jacket) sleeve.push(c.rgb(x, y));
  for (let y = 10; y <= 24; y++) for (let x = 20; x <= 36; x++) if (c.get(x, y) === Part.Skin) skin.push(c.rgb(x, y));
  sleeve.sort(byLum);
  skin.sort(byLum);
  const skinMid = skin.length ? skin[Math.floor(skin.length * 0.6)] : hex(skinRamp[2]);
  if (crewBase(look.base)?.bareArms || sleeve.length < 6) {
    const lo = skin.length ? skin[Math.floor(skin.length * 0.3)] : hex(skinRamp[1]);
    return { sleeve: toHex(lo), sleeveHi: toHex(skinMid), skin: toHex(skinMid) };
  }
  // 最常見的顏色當袖子（避開領帶、鈕扣這類點綴），比它亮的裡面最常見的當反光
  const mode = (list: RGB[]): RGB | undefined => {
    const n = new Map<number, number>();
    for (const p of list) n.set(toHex(p), (n.get(toHex(p)) ?? 0) + 1);
    let best: number | undefined;
    for (const [k, v] of n) if (best === undefined || v > (n.get(best) ?? 0)) best = k;
    return best === undefined ? undefined : hex(best);
  };
  const mid = mode(sleeve) ?? hex(jacketRamp[1]);
  const near = sleeve.filter((p) => {
    const d = lumOf(...p) - lumOf(...mid);
    return d > 12 && d < 60 && Math.abs(p[0] - mid[0]) + Math.abs(p[1] - mid[1]) + Math.abs(p[2] - mid[2]) < 140;
  });
  const hi = mode(near) ?? mix(mid, [255, 255, 255], 0.18);
  return { sleeve: toHex(mid), sleeveHi: toHex(hi), skin: toHex(skinMid) };
}

interface FrameCtx {
  c: Canvas;
  ox: number;
  dy: number;
  look: CrewLook;
  hairRamp: Ramp;
  skinRamp: Ramp;
  gearRamp: Ramp;
  headRamp: Ramp;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function retag(c: Canvas, ox: number, from: Part, to: Part): void {
  for (let y = 0; y < c.h; y++) for (let x = ox; x < ox + 64; x++) if (c.get(x, y) === from) c.part[c.idx(x, y)] = to;
}

function recolor(
  c: Canvas,
  ox: number,
  ranges: Map<Part, [number, number]>,
  fn: (part: Part, t: number, x: number, y: number) => RGB | null,
): void {
  for (let y = 0; y < c.h; y++)
    for (let x = ox; x < ox + 64; x++) {
      const part = c.get(x, y);
      const r = ranges.get(part);
      if (!r) continue;
      const t = (c.lum(x, y) - r[0]) / (r[1] - r[0]);
      const rgb = fn(part, t, x, y);
      if (rgb) c.set(x, y, rgb, part);
    }
}

function patternT(look: CrewLook, t: number, x: number, y: number): number {
  if (look.pattern === 'plaid') {
    const line = x % 4 === 1 || y % 4 === 2;
    const cross = x % 4 === 1 && y % 4 === 2;
    return t - (cross ? 0.35 : line ? 0.18 : 0);
  }
  if (look.pattern === 'camo') {
    const n = hash2(x >> 2, y >> 1, look.jacket) * 0.6 + hash2(x >> 1, y >> 2, look.jacket + 7) * 0.4;
    return t + (n < 0.33 ? -0.3 : n > 0.7 ? 0.22 : 0);
  }
  return t;
}

/** 髮型：以頭骨橢圓修剪頭髮 */
function shapeHair(ctx: FrameCtx): void {
  const { c, ox, dy, look } = ctx;
  const style = look.hairStyle;
  if (style === 'messy' || style === 'long' || style === 'ponytail') return;
  const rx = style === 'short' ? 11.5 : 10.8;
  const ry = style === 'short' ? 9.2 : 8.4;
  const cx = 27.5;
  const cy = 13.5 + dy;
  for (let y = 0; y < 26 + dy; y++)
    for (let x = ox; x < ox + 42; x++) {
      const p = c.get(x, y);
      if (p !== Part.Hair && p !== Part.Outline) continue;
      if (p === Part.Outline && y > 15 + dy) continue;
      const lx = x - ox;
      const keepMohawk = style === 'mohawk' && lx >= 24 && lx <= 31 && y >= 1;
      const d = ((lx - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1 && !keepMohawk) c.clear(x, y);
    }
  if (style === 'mohawk') {
    // 往上豎起的一排尖刺
    const spikes = [
      [25, 2],
      [26, 1],
      [27, 2],
      [28, 0],
      [29, 1],
      [30, 3],
    ];
    for (const [sx, top] of spikes)
      for (let y = top + dy; y < 6 + dy; y++) if (y >= 0) c.set(ox + sx, y, rampAt(ctx.hairRamp, 0.4 + (y - top) * 0.1), Part.Gear);
  }
}

/** 戴帽子：剪掉帽子上緣以上的頭髮，免得從帽子上面戳出來 */
function clipForHat(ctx: FrameCtx, clipY: number): void {
  const { c, ox, dy } = ctx;
  for (let y = 0; y < clipY + dy; y++)
    for (let x = ox; x < ox + 44; x++) {
      const p = c.get(x, y);
      if (p === Part.Hair || p === Part.Outline || p === Part.Band || p === Part.Gear) c.clear(x, y);
    }
}

/** 長髮、馬尾：畫在身後（只填透明處） */
function addHair(ctx: FrameCtx): void {
  const { look, hairRamp, dy } = ctx;
  if (look.hairStyle === 'long') {
    drawBitmap(ctx, LONG_HAIR, hairRamp, 'behind', dy);
    // 前面垂到肩上的一撮
    drawBitmap(ctx, { x: 17, y: 16, rows: ['o3o', 'o3o', 'o2o', 'o2o', 'o2o', 'o1o', '.o.'] }, hairRamp, 'overHairOnly', dy);
  } else if (look.hairStyle === 'ponytail') {
    drawBitmap(ctx, PONYTAIL, hairRamp, 'behind', dy);
  }
}

type DrawMode = 'over' | 'behind' | 'overHairOnly';

function drawBitmap(ctx: FrameCtx, bm: Bitmap, ramp: Ramp, mode: DrawMode, dy = 0, dx = 0): void {
  const { c, ox } = ctx;
  bm.rows.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      const ch = row[rx];
      if (ch === '.' || ch === ' ') continue;
      const x = ox + bm.x + rx + dx;
      const y = bm.y + ry + dy;
      if (!c.inside(x, y, ox)) continue;
      const cur = c.get(x, y);
      if (mode === 'behind' && cur !== Part.None) continue;
      if (mode === 'overHairOnly' && cur !== Part.None && cur !== Part.Hair && cur !== Part.Outline && cur !== Part.Band) continue;
      let rgb: RGB;
      if (ch === 'o') rgb = OUTLINE_RGB;
      else if (ch >= '1' && ch <= '4') rgb = hex(ramp[Number(ch) - 1]);
      else if (ch === 'g') {
        // 鏡片：原本的顏色加一層淡藍
        rgb = cur === Part.None ? [150, 190, 210] : mix(c.rgb(x, y), [170, 210, 230], 0.45);
      } else rgb = FIXED[ch] ?? OUTLINE_RGB;
      c.set(x, y, rgb, ch === 'o' ? Part.Outline : Part.Gear);
    }
  });
}

function line(ctx: FrameCtx, x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (ctx.c.get(ctx.ox + x, y) !== Part.None) ctx.c.set(ctx.ox + x, y, rgb, Part.Gear);
  }
}

/** 對某區域裡的指定部位重新上色 */
function paintZone(
  ctx: FrameCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  parts: Part[],
  fn: (x: number, y: number, rgb: RGB, lum: number) => RGB | null,
): void {
  const { c, ox } = ctx;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = c.get(ox + x, y);
      if (!parts.includes(p)) continue;
      const rgb = fn(x, y, c.rgb(ox + x, y), c.lum(ox + x, y));
      if (rgb) c.set(ox + x, y, rgb, Part.Gear);
    }
}

/** 軀幹中線（第 0 格座標）與開始加寬的列 */
const BODY_CENTER_X = 27;
const BODY_TOP_Y = 25;

/**
 * 加寬：從中線往兩側推開，中間複製中線那一欄；變窄：從中線往內收。
 * 頭不動，所以壯的人看起來肩寬體厚、頭相對小；瘦的人反過來。
 */
function widenBody(c: Canvas, ox: number, F: number, d: number): void {
  const cx = ox + BODY_CENTER_X;
  const L = Math.ceil(Math.abs(d) / 2);
  const R = Math.floor(Math.abs(d) / 2);
  for (let y = BODY_TOP_Y; y < c.h; y++) {
    const rowPx: number[][] = [];
    const rowPart: number[] = [];
    for (let x = ox; x < ox + F; x++) {
      const i = c.idx(x, y);
      rowPx.push([c.px[i * 4], c.px[i * 4 + 1], c.px[i * 4 + 2], c.px[i * 4 + 3]]);
      rowPart.push(c.part[i]);
    }
    const src = (x: number): number => {
      // 回傳舊列裡的 x（-1 = 透明）
      if (d > 0) {
        if (x < cx - L) return x + L;
        if (x < cx + R) return cx;
        return x - R;
      }
      if (x < cx) return x - L;
      return x + R;
    };
    for (let x = ox; x < ox + F; x++) {
      const sx = src(x);
      const i = c.idx(x, y);
      if (sx < ox || sx >= ox + F) {
        c.px[i * 4 + 3] = 0;
        c.part[i] = Part.None;
        continue;
      }
      const p = rowPx[sx - ox];
      c.px[i * 4] = p[0];
      c.px[i * 4 + 1] = p[1];
      c.px[i * 4 + 2] = p[2];
      c.px[i * 4 + 3] = p[3];
      c.part[i] = rowPart[sx - ox];
    }
  }
}

/**
 * 啤酒肚：胸口以下、胯下以上，肚子那一段的前半身往前推（複製中線那欄），中間凸最多。
 * 手臂在更前面（x ≥ 37）且高度在肚子之上，不會被推到。
 */
function addBelly(c: Canvas, ox: number, amount: number): void {
  const y0 = 32;
  const y1 = 47;
  const cx = ox + BODY_CENTER_X;
  for (let y = y0; y <= y1; y++) {
    const b = Math.round(amount * Math.sin((Math.PI * (y - y0)) / (y1 - y0)));
    if (b <= 0) continue;
    // 找這一列的前緣（中線往前第一個透明處）
    let edge = cx;
    while (edge < ox + 63 && c.part[c.idx(edge + 1, y)] !== Part.None && edge < ox + 40) edge++;
    for (let x = Math.min(ox + 63, edge + b); x > cx + b; x--) copyPx(c, x - b, y, x, y);
    for (let x = cx + 1; x <= cx + b; x++) copyPx(c, cx, y, x, y);
  }
}

/** 駝背：頭（肩膀以上）往前、往下移，像彎著腰 */
function hunchHead(c: Canvas, ox: number, F: number, amount: number): void {
  const neck = 26;
  const dx = amount;
  const dy = Math.ceil(amount / 2);
  const buf: { x: number; y: number; px: number[]; part: number }[] = [];
  for (let y = 0; y < neck; y++)
    for (let x = ox; x < ox + 41; x++) {
      const i = c.idx(x, y);
      if (c.part[i] === Part.None || c.part[i] === Part.Gun) continue;
      buf.push({ x, y, px: [c.px[i * 4], c.px[i * 4 + 1], c.px[i * 4 + 2], c.px[i * 4 + 3]], part: c.part[i] });
      c.clear(x, y);
    }
  for (const p of buf) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (x >= ox + F || y >= c.h) continue;
    const i = c.idx(x, y);
    c.px[i * 4] = p.px[0];
    c.px[i * 4 + 1] = p.px[1];
    c.px[i * 4 + 2] = p.px[2];
    c.px[i * 4 + 3] = p.px[3];
    c.part[i] = p.part;
  }
  // 脖子後面露出的縫：用上衣補
  for (let y = neck - 2; y < neck + dy; y++)
    for (let x = ox + 14; x < ox + BODY_CENTER_X + dx; x++) {
      const i = c.idx(x, y);
      if (c.part[i] !== Part.None) continue;
      const below = c.idx(x, y + 1);
      const right = c.idx(x + 1, y);
      if (c.part[below] !== Part.None && c.part[right] !== Part.None && c.part[c.idx(x - 1, y)] !== Part.None) copyPx(c, x, y + 1, x, y);
    }
}

function copyPx(c: Canvas, sx: number, sy: number, dx: number, dy: number): void {
  const s = c.idx(sx, sy);
  const d = c.idx(dx, dy);
  for (let k = 0; k < 4; k++) c.px[d * 4 + k] = c.px[s * 4 + k];
  c.part[d] = c.part[s];
}

/**
 * 外框修補：剪掉頭髮後露出的邊補上外框，孤零零的舊外框拿掉。
 */
function reoutline(c: Canvas, ox: number, F: number): void {
  const solid = (x: number, y: number): boolean => {
    if (x < ox || x >= ox + F || y < 0 || y >= c.h) return false;
    const p = c.get(x, y);
    return p !== Part.None && p !== Part.Outline;
  };
  const add: [number, number][] = [];
  const drop: [number, number][] = [];
  for (let y = 0; y < c.h; y++)
    for (let x = ox; x < ox + F; x++) {
      const p = c.get(x, y);
      if (p === Part.None) {
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push([x, y]);
      } else if (p === Part.Outline) {
        let near = false;
        for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1 && !near; i++) if (solid(x + i, y + j)) near = true;
        if (!near) drop.push([x, y]);
      }
    }
  for (const [x, y] of drop) c.clear(x, y);
  for (const [x, y] of add) c.set(x, y, OUTLINE_RGB, Part.Outline);
}

// ───────────────────────── 帽子 ─────────────────────────
/** clipY：這條線以上的頭髮剪掉（第 0 格座標） */
const HATS: Record<HeadGearId, { clipY: number; art: Bitmap }> = {
  cap: {
    clipY: 12,
    art: {
      x: 15,
      y: 4,
      rows: [
        '.......oooooooo.........',
        '.....oo22333333oo.......',
        '....o2223333333443o.....',
        '...o22223333333344o.....',
        '..o122223333w33334o.....',
        '..o1222223333333334o....',
        '..o1122222233333333o....',
        '..o11122222222222233o...',
        '..oo111111111111111ooooo',
        '...ooooooooo2333333333o.',
        '............oooooooooo..',
      ],
    },
  },
  beanie: {
    clipY: 12,
    art: {
      x: 15,
      y: 3,
      rows: [
        '.........oooo...........',
        '......ooo3443ooo........',
        '....oo22333333333oo.....',
        '...o2223333333333343o...',
        '..o12222333333333334o...',
        '..o12222233333333333o...',
        '..o11222222333333333o...',
        '..o11122222222333333o...',
        '..o11112222222223333o...',
        '..oo2121212121212121oo..',
        '..o2121212121212121212o.',
        '..o1212121212121212121o.',
        '...oooooooooooooooooooo.',
      ],
    },
  },
  helmet: {
    clipY: 13,
    art: {
      x: 13,
      y: 2,
      rows: [
        '........oooooooo..........',
        '.....ooo22333334ooo.......',
        '....o222233333334433o.....',
        '...o12222333333333443o....',
        '..o1122222333333333334o...',
        '..o1122222233333333333o...',
        '..o1112222222333333333o...',
        '..o1112222222223333333o...',
        '.o1111222222222222333332o.',
        '.o1111122222222222223332o.',
        '.o1111111222222222222221o.',
        'o111111111111111111111111o',
        'oooooooooooooooooooooooooo',
      ],
    },
  },
  hardhat: {
    clipY: 12,
    art: {
      x: 13,
      y: 3,
      rows: [
        '.........oooooo...........',
        '.......oo233w43oo.........',
        '.....oo2223344333oo.......',
        '....o222233344433334o.....',
        '...o1222233344433334o.....',
        '...o12222233444333334o....',
        '...o12222223444333333o....',
        '...o11222222344333333o....',
        '..oo11122222234433333oo...',
        '.o1111111111111111111222o.',
        'o11111111111111111111111o.',
        '.ooooooooooooooooooooooo..',
      ],
    },
  },
  bucket: {
    clipY: 11,
    art: {
      x: 13,
      y: 4,
      rows: [
        '.......oooooooooo.........',
        '......o2233333334o........',
        '.....o222333333334o.......',
        '.....o2222333333334o......',
        '.....o1222233333333o......',
        '....oo1111111111111oo.....',
        '...o11222222333333333o....',
        '..o1122222222333333333o...',
        '.o11222222222233333333o...',
        'o1111111111111111111111o..',
        'oooooooooooooooooooooooo..',
      ],
    },
  },
  cowboy: {
    clipY: 11,
    art: {
      x: 9,
      y: 1,
      rows: [
        '...........ooo.oooo..........',
        '.........oo223o23334o........',
        '........o22223323333o........',
        '........o122223333334o.......',
        '........o122222333333o.......',
        '........o112222233333o.......',
        '........o112222223333o.......',
        '........o111222222233o.......',
        '.oo.....okkkkkkkkkkkkko...oo.',
        'o22o...oo1111111111111oo.o33o',
        'o122ooo222222222333333333o33o',
        '.o1111222222222222233333333o.',
        '..oo111111111111111111111oo..',
        '....ooooooooooooooooooooo....',
      ],
    },
  },
};

const LONG_HAIR: Bitmap = {
  x: 10,
  y: 12,
  rows: [
    '....o33o',
    '...o233o',
    '..o2233o',
    '..o1223o',
    '.o12223o',
    '.o11223o',
    '.o11222o',
    '.o11122o',
    '.o1112o.',
    '.o1112o.',
    '.o1111o.',
    '.o111o..',
    '.o11o...',
    '..oo....',
  ],
};

const PONYTAIL: Bitmap = {
  x: 6,
  y: 9,
  rows: [
    '......ooo',
    '..ooo2kko',
    '.o2333kko',
    'o12233o..',
    'o11223o..',
    'o1122o...',
    '.o112o...',
    '.o112o...',
    '.o11o....',
    '..o1o....',
    '..oo.....',
  ],
};

// ───────────────────────── 臉部 ─────────────────────────
const FACE: Record<FaceGearId, (ctx: FrameCtx) => void> = {
  glasses: (ctx) =>
    drawBitmap(
      ctx,
      {
        x: 24,
        y: 17,
        rows: ['ooooo.oooo', 'oggggoogggo', 'oggggo.oggo', '.ooo...oo.'],
      },
      ctx.hairRamp,
      'over',
      ctx.dy,
    ),
  sunglasses: (ctx) =>
    drawBitmap(ctx, { x: 24, y: 17, rows: ['oooooooooooo', 'okwkkkokwkko', '.okkko.okkko', '..ooo...ooo.'] }, ctx.hairRamp, 'over', ctx.dy),
  goggles: (ctx) => {
    line(ctx, 17, 16 + ctx.dy, 24, 17 + ctx.dy, FIXED.k);
    drawBitmap(ctx, { x: 24, y: 16, rows: ['.oooo.oooo.', 'oaaywoaayao', 'oaaaaoaaaao', '.oooo.oooo.'] }, ctx.hairRamp, 'over', ctx.dy);
  },
  eyepatch: (ctx) => {
    line(ctx, 19, 13 + ctx.dy, 30, 17 + ctx.dy, FIXED.k);
    drawBitmap(ctx, { x: 30, y: 17, rows: ['okkko', 'okkkko', '.okko'] }, ctx.hairRamp, 'over', ctx.dy);
  },
  mask: (ctx) =>
    drawBitmap(
      ctx,
      {
        x: 22,
        y: 21,
        rows: ['.oooooooooooooo', 'o22333333333334o', 'o12223333333334o', '.o1222333333333o', '..o12222233333o.', '...oo11122222o..', '.....ooooooo....'],
      },
      ctx.gearRamp,
      'over',
      ctx.dy,
    ),
  beard: (ctx) =>
    paintZone(ctx, 20, 19 + ctx.dy, 37, 26 + ctx.dy, [Part.Skin, Part.Detail], (x, y, _rgb, lum) => {
      const ly = y - ctx.dy;
      // 鬢角 + 下巴，留出嘴巴一點皮膚
      const jaw = ly >= 22 || (x <= 24 && ly >= 19);
      if (!jaw) return null;
      if (ly === 22 && x >= 32) return null;
      return rampAt(ctx.hairRamp, lum / 255 + 0.15);
    }),
  stubble: (ctx) =>
    paintZone(ctx, 21, 21 + ctx.dy, 37, 26 + ctx.dy, [Part.Skin], (x, y, rgb) =>
      hash2(x, y - ctx.dy, 3) < 0.45 ? mix(rgb, hex(ctx.hairRamp[0]), 0.45) : null,
    ),
  bandage: (ctx) => drawBitmap(ctx, { x: 21, y: 20, rows: ['lwwl', 'wlwl', 'lwwl'] }, ctx.hairRamp, 'over', ctx.dy),
  cigarette: (ctx) => drawBitmap(ctx, { x: 35, y: 23, rows: ['wwwa', '...r'] }, ctx.hairRamp, 'over', ctx.dy),
};

// ───────────────────────── 身上 ─────────────────────────
/** 軀幹範圍（不含往前伸的手臂） */
const inTorso = (x: number, y: number): boolean => x >= 19 && x <= 35 && y >= 26 && y <= 44 && !(y <= 34 && x >= 33);

const BODY: Record<BodyGearId, (ctx: FrameCtx) => void> = {
  vest: (ctx) => {
    paintZone(ctx, 19, 26, 35, 44, [Part.Jacket], (x, y, _rgb, lum) => {
      if (!inTorso(x, y)) return null;
      // 肩帶之間露出裡面的夾克
      if (y <= 28 && x >= 25 && x <= 30) return null;
      return rampAt(ctx.gearRamp, lum / 150);
    });
    drawBitmap(ctx, { x: 20, y: 35, rows: ['oooooo.oooooo', 'o3443o.o3443o', 'o2222o.o2222o', 'o1111o.o1111o', 'oooooo.oooooo'] }, ctx.gearRamp, 'over');
  },
  hivis: (ctx) => {
    paintZone(ctx, 19, 26, 35, 44, [Part.Jacket], (x, y, _rgb, lum) => {
      if (!inTorso(x, y)) return null;
      if (y <= 28 && x >= 25 && x <= 30) return null;
      if (y === 33 || y === 39) return x % 2 ? FIXED.w : FIXED.l;
      return rampAt(ctx.gearRamp, lum / 130 + 0.15);
    });
  },
  armband: (ctx) => drawBitmap(ctx, { x: 33, y: 26, rows: ['owwwo', 'owrwo', 'orrro', 'owrwo', 'owwwo'] }, ctx.gearRamp, 'over'),
  toolbelt: (ctx) =>
    drawBitmap(
      ctx,
      {
        x: 17,
        y: 41,
        rows: ['ooooooooooooooooooooo', 'obbbbbbbbbbymybbbbbbbo', 'ooooooooooooooooooomo', '.o3332o.........ommmo', '.o2221o..........omo.', '.o1111o..........omo.', '.oooooo..........ooo.'],
      },
      CLOTH[7].ramp,
      'over',
    ),
  bandolier: (ctx) => {
    for (let i = 0; i <= 15; i++) {
      const x = 21 + Math.round(i * 0.9);
      const y = 27 + i;
      for (const [ddx, col] of [
        [0, FIXED.b],
        [1, i % 2 ? FIXED.y : FIXED.b],
        [2, FIXED.k],
      ] as [number, RGB][]) {
        const p = ctx.c.get(ctx.ox + x + ddx, y);
        if (p === Part.Jacket || p === Part.Gear) ctx.c.set(ctx.ox + x + ddx, y, col, Part.Gear);
      }
    }
  },
  backpack: (ctx) =>
    drawBitmap(
      ctx,
      {
        x: 10,
        y: 25,
        rows: [
          '...ooooooo',
          '..o2233334o',
          '.o12233333o',
          '.o12223333o',
          'oo11111111o',
          'o1222233334',
          'o1222233333',
          'o1222223333',
          'o1122222333',
          'o1122222233',
          'o1112222223',
          'o1111222222',
          'o1111122222',
          'o1111111111',
          '.o111111111',
          '..ooooooooo',
        ],
      },
      ctx.gearRamp,
      'behind',
    ),
  scarf: (ctx) => {
    drawBitmap(
      ctx,
      { x: 21, y: 24, rows: ['.ooooooooooooo', 'o2333333333334o', 'o1222222333333o', '.o111111111111o', '..oooooooooooo'] },
      ctx.gearRamp,
      'over',
    );
    drawBitmap(ctx, { x: 16, y: 26, rows: ['oooo', 'o23o', 'o22o', 'o12o', 'o12o', 'o11o', 'oooo'] }, ctx.gearRamp, 'behind');
  },
};
