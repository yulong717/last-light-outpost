import Phaser from 'phaser';
import { THEMES } from '../data/scenery';
import { canvasTexture, mix, OUTLINE, tone, type Painter } from './Painter';

/**
 * 探索事件的插圖：事件卡最上方的一格「漫畫分鏡」（284×86 邏輯像素），
 * 把事件寫到的東西直接畫出來（上鎖的鐵櫃、公車頂上的人、圍著槍械櫃的警察霧屍…），
 * 不用只靠文字想像。另外有一組 12×12 的小圖示，給選項按鈕與戰利品清單用。
 *
 * 全部用 Painter 程式畫；同一個事件在不同區域會換上那一區的牆色、地板與天色。
 * 貼圖 key = evart_<事件>_<區域>，第一次用到才畫。
 */

export const VIG_W = 284;
export const VIG_H = 86;
/** 分鏡裡的地面線 */
const FY = 72;
const W = VIG_W;
const H = VIG_H;

interface Look {
  wall: number;
  floor: number;
  light: number;
  sky: [number, number];
}

function lookFor(zone: string): Look {
  const t = THEMES[zone] ?? THEMES.gas;
  return { wall: t.wall, floor: t.floor, light: t.light, sky: t.sky };
}

/** 有專屬插圖的事件；其他事件（或之後新增的）退回一般的走廊 */
const PAINTERS: Record<string, (p: Painter, l: Look) => void> = {
  stash: paintStash,
  locked: paintLocked,
  floor: paintFloor,
  ambush: paintAmbush,
  door: paintShutter,
  sleepers: paintSleepers,
  patrol: paintPatrol,
  trapped: paintTrapped,
  quiet: paintQuiet,
  hold: paintHold,
  trader: paintTrader,
  wounded: paintWounded,
  trap: paintTrap,
  cache: paintCache,
  shelter: paintShelter,
  armory: paintArmory,
  horde: paintHorde,
  walk: paintWalk,
};

export function hasEventArt(id: string): boolean {
  return id in PAINTERS;
}

export function ensureEventArt(scene: Phaser.Scene, eventId: string, zone: string): string {
  const key = `evart_${eventId}_${zone}`;
  if (scene.textures.exists(key)) return key;
  const l = lookFor(zone);
  const draw = PAINTERS[eventId] ?? paintStash;
  canvasTexture(scene, key, W, H, (p) => {
    draw(p, l);
    vignette(p);
  });
  return key;
}

// ── 共用：背景 ─────────────────────────────────────

/** 室內：牆面漸層、牆板接縫、踢腳板、地板 */
function interior(p: Painter, l: Look, o: { tiles?: boolean } = {}): void {
  const wall = tone(l.wall, -0.25);
  p.gradient(0, 0, W, FY, tone(wall, -0.25), tone(wall, -0.05), 5);
  for (let x = 6; x < W; x += 28) p.rect(x, 0, 1, FY - 10, tone(wall, -0.35), 0.7);
  if (o.tiles) for (let y = FY - 26; y < FY - 10; y += 4) p.rect(0, y, W, 1, tone(wall, -0.3), 0.6);
  // 牆上的髒污、剝落
  for (let i = 0; i < 40; i++) p.px(p.rnd.between(0, W), p.rnd.between(4, FY - 12), tone(wall, p.rnd.frac() < 0.5 ? -0.4 : 0.15), 0.8);
  p.rect(0, FY - 10, W, 10, tone(wall, -0.45));
  p.rect(0, FY - 10, W, 1, tone(wall, 0.15));
  floor(p, l.floor);
}

function floor(p: Painter, c: number): void {
  p.gradient(0, FY, W, H - FY, tone(c, 0.05), tone(c, -0.5), 3);
  p.rect(0, FY, W, 1, OUTLINE);
  for (let x = 0; x < W; x += 22) p.line(x, FY + 1, x - 10, H, tone(c, -0.25), 0.5);
  for (let i = 0; i < 26; i++) p.px(p.rnd.between(0, W), p.rnd.between(FY + 2, H - 1), tone(c, p.rnd.frac() < 0.5 ? -0.35 : 0.2));
}

/** 室外：天空、遠方樓群剪影、路面 */
function exterior(p: Painter, l: Look, o: { red?: boolean } = {}): void {
  const [top, bot] = o.red ? [0x120808, 0x5a1a14] : l.sky;
  p.gradient(0, 0, W, FY, tone(top, -0.3), tone(bot, -0.25), 6);
  for (let i = 0; i < 24; i++) p.px(p.rnd.between(0, W), p.rnd.between(0, 24), 0xffffff, p.rnd.realInRange(0.15, 0.5));
  const far = mix(tone(top, -0.4), 0x101014, 0.4);
  let x = -4;
  while (x < W) {
    const w = p.rnd.between(14, 30);
    const h = p.rnd.between(18, 44);
    p.rect(x, FY - h, w, h, far);
    for (let wy = FY - h + 4; wy < FY - 4; wy += 5) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (p.rnd.frac() < 0.04) p.rect(wx, wy, 2, 2, 0x8a6a34);
    x += w + p.rnd.between(0, 4);
  }
  // 貼地的霧
  for (let i = 0; i < W; i += 2) p.px(i, FY - 4 - Math.round(Math.sin(i * 0.07) * 2), mix(bot, 0xb0b0b0, 0.4), 0.25);
  p.dither(0, FY - 8, W, 8, mix(bot, 0xa0a0a0, 0.35), 0.35, 0.18);
  const road = 0x34363c;
  p.gradient(0, FY, W, H - FY, tone(road, 0.05), tone(road, -0.5), 3);
  p.rect(0, FY, W, 1, tone(road, 0.3));
  for (let x2 = 10; x2 < W; x2 += 36) p.rect(x2, FY + 7, 14, 1, 0x8a7a40, 0.7);
  for (let i = 0; i < 24; i++) p.px(p.rnd.between(0, W), p.rnd.between(FY + 2, H - 1), tone(road, -0.4));
}

/** 四周壓暗，像一格分鏡 */
function vignette(p: Painter): void {
  for (let i = 0; i < 8; i++) {
    const a = 0.12 * (1 - i / 8);
    p.rect(i, 0, 1, H, 0x000000, a * 2);
    p.rect(W - 1 - i, 0, 1, H, 0x000000, a * 2);
    p.rect(0, i, W, 1, 0x000000, a);
    p.rect(0, H - 1 - i, W, 1, 0x000000, a * 1.6);
  }
}

// ── 共用：光 ─────────────────────────────────────

/** 圓形光暈（一圈圈疊淡色） */
function glow(p: Painter, cx: number, cy: number, r: number, c: number, a = 0.08): void {
  for (let k = r; k > 2; k -= 3) p.circle(cx, cy, k, c, a);
}

/** 從上往下打的錐形光 */
function cone(p: Painter, x: number, y: number, topW: number, botW: number, c: number, a = 0.1): void {
  for (let j = y; j < FY + 6; j++) {
    const t = (j - y) / (FY + 6 - y);
    const w = topW + (botW - topW) * t;
    p.rect(x - w / 2, j, w, 1, c, a);
  }
}

/** 動作線（撞擊、晃動） */
function shake(p: Painter, x: number, y: number, c = 0xffffff, a = 0.7): void {
  p.line(x, y, x + 4, y - 3, c, a);
  p.line(x + 1, y + 4, x + 6, y + 3, c, a);
  p.line(x, y + 8, x + 4, y + 10, c, a);
}

function zzz(p: Painter, x: number, y: number): void {
  const c = 0xb0c4de;
  const z = (zx: number, zy: number, s: number) => {
    p.rect(zx, zy, s, 1, c, 0.8);
    p.line(zx + s - 1, zy + 1, zx, zy + s - 1, c, 0.8);
    p.rect(zx, zy + s - 1, s, 1, c, 0.8);
  };
  z(x, y + 6, 3);
  z(x + 4, y + 2, 4);
  z(x + 9, y - 3, 5);
}

// ── 共用：人物 ─────────────────────────────────────

const FIG = {
  stand: ['..hhh..', '.hhhhh.', '.hhsss.', '..sss..', '.bbbbb.', 'bbbbbbb', 'sbbbbbs', '.bbbbb.', '.lllll.', '.ll.ll.', '.ll.ll.', '.kk.kk.'],
  handsUp: ['s.....s', 'b.hhh.b', 'bhhhhhb', 'b.sss.b', 'bbsssbb', '.bbbbb.', '.bbbbb.', '.bbbbb.', '.lllll.', '.ll.ll.', '.ll.ll.', '.kk.kk.'],
  wave: ['......s', '..hhh.b', '.hhhhhb', '.hhsssb', '..sssbb', '.bbbbb.', 'sbbbbb.', '.bbbbb.', '.lllll.', '.ll.ll.', '.ll.ll.', '.kk.kk.'],
  sit: ['..hhh....', '.hhhhh...', '.hhsss...', '..sss....', '.bbbbb...', 'bbbbbbb..', 'bbbbbbs..', 'bbbbbb...', 'lllllllll', 'lllllllkk'],
  crouch: ['.........', '..hhh....', '.hhhhh...', '.hhsss...', '..sssbbs.', '.bbbbbb..', 'bbbbbbb..', '.lllll...', 'll...ll..', 'kk...kk..'],
  gun: ['..hhh....', '.hhhhh...', '.hhsss...', '..sss....', '.bbbbbggg', 'bbbbbbs..', 'bbbbbb...', '.bbbbb...', '.lllll...', '.ll.ll...', '.ll..ll..', '.kk..kk..'],
  zShamble: ['..hh....', '.hssss..', '.ssses..', '..sss...', '.bbbbsss', '.bbbbb..', '.bbbbbss', '..bbb...', '..lll...', '.ll.l...', '.l..ll..', '.k...k..'],
  zStand: ['...hh..', '..hsss.', '..sess.', '...ss..', '.bbbbb.', 'bbbbbbb', 'sbbbbbs', 's.bbb.s', '..lll..', '.ll.ll.', '.l...l.', '.k...k.'],
  zReach: ['s.....s', 's.hh..s', 'b.sss.b', 'bbsesbb', '.bbbbb.', '.bbbbb.', '.bbbbb.', '..bbb..', '..lll..', '.ll.ll.', '.l...l.', '.k...k.'],
  zSleep: ['.........', '..hh.....', '.hsss....', '.ssss....', '.bbbbb...', 'bbbbbbs..', 'bbbbbb...', 'lllllllll', 'lllllllkk'],
};
type FigName = keyof typeof FIG;

interface Pal {
  h: number;
  s: number;
  b: number;
  l: number;
  k?: number;
  e?: number;
  g?: number;
}

const PAL = {
  you: { h: 0x2a2018, s: 0xd8a878, b: 0x4a5a3a, l: 0x2e3440 } as Pal,
  survivor: { h: 0x3a2a1c, s: 0xd0a070, b: 0x8a5a3a, l: 0x3a3a48 } as Pal,
  nurse: { h: 0x2a2018, s: 0xd8a878, b: 0xc8d8d8, l: 0x6a8a8a } as Pal,
  zombie: { h: 0x2a2a22, s: 0x7a9070, b: 0x4a4a3a, l: 0x2e3030, e: 0xd8f070 } as Pal,
  zombie2: { h: 0x1a1a18, s: 0x8a9a78, b: 0x5a3a3a, l: 0x2a2a30, e: 0xd8f070 } as Pal,
  zombie3: { h: 0x3a2a1a, s: 0x6a8068, b: 0x3a4a5a, l: 0x26282e, e: 0xd8f070 } as Pal,
  cop: { h: 0x14182a, s: 0x7a9070, b: 0x2a3a6a, l: 0x1a2240, e: 0xd8f070 } as Pal,
  masked: { h: 0x2a2a26, s: 0x5a6058, b: 0x5a5034, l: 0x3a3428 } as Pal,
};

/**
 * 依字元圖畫一個人：先畫一圈深色外框，再填色，s = 每格幾像素。
 * h 頭髮、s 皮膚、b 衣服、l 褲子、k 鞋、e 發光的眼睛、g 槍。
 */
function fig(p: Painter, x: number, foot: number, name: FigName, pal: Pal, s = 3, flip = false, dim = 0): void {
  const rows = FIG[name];
  const w = rows[0].length;
  const top = foot - rows.length * s;
  const cell = (i: number, j: number) => {
    const ch = rows[j]?.[flip ? w - 1 - i : i];
    return ch && ch !== '.' ? ch : null;
  };
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < w; i++) if (cell(i, j)) p.rect(x + i * s - 1, top + j * s - 1, s + 2, s + 2, OUTLINE);
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < w; i++) {
      const ch = cell(i, j);
      if (!ch) continue;
      const base = { h: pal.h, s: pal.s, b: pal.b, l: pal.l, k: pal.k ?? 0x1a1614, e: pal.e ?? pal.s, g: pal.g ?? 0x2a2a2e }[ch] ?? pal.b;
      const c = dim ? mix(base, 0x0a0c12, dim) : base;
      p.rect(x + i * s, top + j * s, s, s, c);
      // 每格左上亮一點，有點體積感
      if (ch !== 'e' && s >= 3) p.rect(x + i * s, top + j * s, s, 1, tone(c, 0.12));
      if (ch === 'e') p.rect(x + i * s, top + j * s, s, s, pal.e ?? 0xd8f070);
    }
  }
}

function shadow(p: Painter, x: number, w: number, a = 0.35): void {
  p.ellipse(x, FY + 2, w, 2, 0x000000, a);
}

// ── 共用：物件 ─────────────────────────────────────

function crate(p: Painter, x: number, y: number, w: number, h: number, c = 0x8a6038): void {
  p.box(x, y, w, h, c);
  p.line(x + 1, y + 1, x + w - 2, y + h - 2, tone(c, -0.3));
  p.line(x + w - 2, y + 1, x + 1, y + h - 2, tone(c, -0.3));
  p.rect(x + 1, y + Math.floor(h / 2), w - 2, 1, tone(c, -0.25));
}

function carton(p: Painter, x: number, y: number, w: number, h: number, open = false): void {
  const c = 0xa07a4a;
  p.box(x, y, w, h, c);
  p.rect(x + Math.floor(w / 2), y + 1, 1, 3, tone(c, -0.35));
  p.rect(x + 2, y + h - 5, 6, 2, tone(c, -0.2));
  if (open) {
    p.line(x, y, x - 4, y - 4, OUTLINE);
    p.line(x - 4, y - 4, x - 4 + 8, y - 4, tone(c, 0.1));
    p.line(x + w - 1, y, x + w + 3, y - 4, OUTLINE);
  }
}

function cabinet(p: Painter, x: number, y: number, w: number, h: number, c = 0x5a6470): void {
  p.box(x, y, w, h, c);
  const mid = x + Math.floor(w / 2);
  p.rect(mid, y + 1, 1, h - 2, tone(c, -0.5));
  for (let vy = y + 5; vy < y + 16; vy += 3) {
    p.rect(x + 4, vy, w / 2 - 8, 1, tone(c, -0.35));
    p.rect(mid + 4, vy, w / 2 - 8, 1, tone(c, -0.35));
  }
  p.rect(mid - 3, y + h / 2 - 2, 2, 5, 0x9aa0a8);
  p.rect(mid + 2, y + h / 2 - 2, 2, 5, 0x9aa0a8);
}

function padlock(p: Painter, x: number, y: number): void {
  p.rect(x + 1, y - 5, 6, 6, OUTLINE);
  p.rect(x + 2, y - 4, 4, 5, 0x1a1a1a);
  p.rect(x + 2, y - 4, 1, 4, 0xb0a070);
  p.rect(x + 5, y - 4, 1, 4, 0xb0a070);
  p.box(x, y, 8, 8, 0xc8a040);
  p.rect(x + 3, y + 3, 2, 3, OUTLINE);
}

function chain(p: Painter, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n + Math.sin((i / n) * Math.PI) * 3);
    p.rect(x, y, 2, 2, i % 2 ? 0x8a8a90 : 0x5a5a60);
  }
}

function door(p: Painter, x: number, w: number, h: number, c = 0x6a4a30, openGap = 0, light?: number): void {
  const y = FY - h;
  p.rect(x - 2, y - 2, w + 4, h + 2, tone(c, -0.5));
  if (openGap && light !== undefined) {
    p.rect(x, y, w, h, light);
    glow(p, x + 4, FY - h / 2, 24, light, 0.05);
  } else p.rect(x, y, w, h, 0x080808);
  p.box(x + openGap, y, w - openGap, h, c);
  p.rect(x + openGap + 3, y + 4, w - openGap - 6, h / 2 - 6, tone(c, -0.15));
  p.rect(x + openGap + 3, y + h / 2 + 2, w - openGap - 6, h / 2 - 6, tone(c, -0.15));
  p.rect(x + openGap + 2, y + h / 2, 2, 2, 0xc0a060);
}

function bulb(p: Painter, x: number, y: number, c: number): void {
  p.line(x, 0, x, y - 2, 0x1a1a1a);
  p.rect(x - 3, y - 2, 7, 2, 0x2a2a2e);
  p.rect(x - 1, y, 3, 2, tone(c, 0.4));
  glow(p, x, y + 1, 14, c, 0.07);
}

function car(p: Painter, x: number, c: number, flip = false): void {
  const y = FY - 18;
  p.box(x, y + 6, 54, 12, c);
  const roofX = flip ? x + 16 : x + 12;
  p.box(roofX, y, 26, 8, tone(c, -0.1));
  p.rect(roofX + 2, y + 2, 10, 5, 0x1c2630);
  p.rect(roofX + 14, y + 2, 10, 5, 0x1c2630);
  p.rect(x + 1, y + 11, 52, 1, tone(c, -0.3));
  for (const wx of [x + 10, x + 44]) {
    p.circle(wx, FY - 2, 4, OUTLINE);
    p.circle(wx, FY - 2, 2, 0x4a4a4a);
  }
  p.rect(flip ? x + 1 : x + 50, y + 8, 3, 2, 0xf0d060);
}

function grenadeIcon(p: Painter, x: number, y: number): void {
  p.ellipse(x + 3, y + 5, 3, 4, OUTLINE);
  p.ellipse(x + 3, y + 5, 2, 3, 0x5a6a3a);
  p.rect(x + 2, y, 3, 2, 0x8a8a90);
  p.rect(x + 2, y + 3, 1, 1, 0x7a8a5a);
}

function ammoBox(p: Painter, x: number, y: number, w = 20, h = 11): void {
  p.box(x, y, w, h, 0x4a5a2a);
  p.rect(x + 3, y + 3, w - 6, 4, 0xc8a040);
  p.rect(x + 4, y + 4, 2, 2, OUTLINE);
  p.rect(x + w / 2 - 2, y - 2, 4, 2, 0x2a2a2a);
}

function shelf(p: Painter, x: number, w: number, h: number): void {
  const c = 0x5a5a62;
  p.rect(x, FY - h, 2, h, OUTLINE);
  p.rect(x + w - 2, FY - h, 2, h, OUTLINE);
  for (let y = FY - h; y < FY; y += 14) p.rect(x, y, w, 2, c);
}

// ── 各事件 ─────────────────────────────────────

/** 沒人碰過的儲物間：半掩的門透出光，堆滿紙箱，有一箱打開露出東西 */
function paintStash(p: Painter, l: Look): void {
  interior(p, l);
  bulb(p, 170, 16, l.light);
  cone(p, 170, 18, 6, 90, l.light, 0.06);
  door(p, 30, 30, 50, 0x6a4a30, 10, mix(l.light, 0xffffff, 0.3));
  carton(p, 120, FY - 16, 22, 16);
  carton(p, 142, FY - 14, 20, 14);
  carton(p, 128, FY - 30, 20, 14);
  carton(p, 178, FY - 18, 26, 18, true);
  // 箱子裡露出來的東西：罐頭、繃帶、子彈
  p.rect(182, FY - 22, 4, 5, 0xb0b8c0);
  p.rect(188, FY - 21, 6, 4, 0xe8e8e0);
  p.rect(189, FY - 20, 4, 1, 0xd04040);
  p.rect(196, FY - 23, 2, 6, 0xc8a040);
  p.rect(199, FY - 22, 2, 5, 0xc8a040);
  carton(p, 210, FY - 12, 16, 12);
  carton(p, 236, FY - 22, 24, 22);
  carton(p, 240, FY - 36, 18, 14);
  shadow(p, 160, 80, 0.25);
  fig(p, 80, FY, 'stand', PAL.you, 3, false);
}

/** 上鎖的鐵櫃：鍊條、大鎖，裡面有東西在晃 */
function paintLocked(p: Painter, l: Look): void {
  interior(p, l);
  bulb(p, 142, 12, l.light);
  cone(p, 142, 14, 6, 110, l.light, 0.07);
  cabinet(p, 112, FY - 58, 60, 58);
  chain(p, 114, FY - 32, 170, FY - 32);
  padlock(p, 138, FY - 30);
  shake(p, 176, FY - 50, 0xffffff, 0.8);
  shake(p, 100, FY - 46, 0xffffff, 0.8);
  p.rect(140, FY - 66, 2, 6, 0xffd24a);
  p.rect(140, FY - 58, 2, 2, 0xffd24a);
  shadow(p, 142, 34);
  fig(p, 56, FY, 'stand', PAL.you);
  crate(p, 214, FY - 16, 18, 16);
  crate(p, 232, FY - 12, 14, 12);
}

/** 腐朽的樓板：只剩幾根橫樑，下面黑洞裡有發光的眼睛（這張的地面拉高，洞才看得清楚） */
function paintFloor(p: Painter, l: Look): void {
  interior(p, l);
  const gy = 50;
  // 把地板往上延伸，牆變矮
  p.rect(0, gy - 8, W, 8, tone(l.wall, -0.5));
  p.rect(0, gy - 8, W, 1, tone(l.wall, 0.1));
  p.gradient(0, gy, W, H - gy, tone(l.floor, 0.05), tone(l.floor, -0.4), 4);
  p.rect(0, gy, W, 1, OUTLINE);
  // 塌掉的大洞：越往下越黑，邊緣是斷裂的木板
  const x0 = 76;
  const x1 = 214;
  p.rect(x0, gy + 1, x1 - x0, H - gy, 0x050506);
  p.rect(x0, gy + 1, x1 - x0, 6, 0x141416);
  for (let j = 0; j < H - gy; j += 2) {
    p.rect(x0 - p.rnd.between(0, 4), gy + j, 4, 2, tone(l.floor, -0.2));
    p.rect(x1 - p.rnd.between(0, 3), gy + j, 4, 2, tone(l.floor, -0.2));
  }
  // 斷掉的橫樑
  const beam = 0x6a4a2a;
  p.box(x0 - 6, gy - 1, 52, 5, beam);
  p.box(x0 + 52, gy + 6, 40, 4, tone(beam, -0.15));
  p.line(x0 + 44, gy + 2, x0 + 54, gy + 8, beam);
  p.box(x1 - 44, gy - 1, 50, 5, beam);
  p.box(x0 + 30, gy + 16, 60, 3, tone(beam, -0.35));
  // 黑洞深處的眼睛
  for (const [ex, ey] of [[100, 70], [118, 74], [150, 68], [172, 78], [190, 71], [136, 80]]) {
    p.rect(ex, ey, 2, 1, 0xd8f070);
    p.rect(ex + 4, ey, 2, 1, 0xd8f070);
  }
  fig(p, 34, gy, 'crouch', PAL.you);
  // 對面地上的背包
  p.box(236, gy - 10, 12, 10, 0x6a5a2a);
  p.rect(238, gy - 8, 8, 2, tone(0x6a5a2a, 0.2));
  glow(p, 242, gy - 6, 12, 0xffd24a, 0.05);
}

/** 衣櫃裡衝出來的霧屍 */
function paintAmbush(p: Painter, l: Look): void {
  interior(p, l);
  // 衣櫃，門被撞開
  const wx = 120;
  p.box(wx, FY - 60, 48, 60, 0x5a3a24);
  p.rect(wx + 4, FY - 56, 40, 52, 0x0a0806);
  p.box(wx - 18, FY - 58, 18, 56, 0x6a4a2e);
  p.box(wx + 48, FY - 58, 16, 56, 0x6a4a2e);
  // 霧屍撲出來（往左）
  fig(p, wx + 8, FY, 'zShamble', PAL.zombie2, 4, true);
  // 主角往後倒
  fig(p, 46, FY, 'stand', PAL.you, 3, false);
  // 衝擊線
  for (let i = 0; i < 6; i++) p.line(wx - 6, FY - 50 + i * 7, wx - 26 - (i % 2) * 6, FY - 52 + i * 7, 0xffffff, 0.6);
  p.rect(0, 0, W, H, 0xa01010, 0.12);
  // 衣架掉地上
  p.line(200, FY - 2, 214, FY - 6, 0x9aa0a8);
  p.rect(206, FY - 8, 2, 3, 0x9aa0a8);
}

/** 卡住的鐵捲門：門縫透出光，看得到箱子 */
function paintShutter(p: Painter, l: Look): void {
  interior(p, l);
  const x = 80;
  const w = 130;
  const gapTop = FY - 22;
  // 門框
  p.rect(x - 6, FY - 66, w + 12, 66, tone(l.wall, -0.6));
  // 門後亮著的倉庫
  p.rect(x, gapTop, w, 22, mix(l.light, 0x6a5a40, 0.4));
  for (let i = 0; i < 5; i++) crate(p, x + 6 + i * 25, FY - 14 - (i % 2) * 4, 20, 14 + (i % 2) * 4, i % 2 ? 0x7a5a34 : 0x5a6a34);
  // 半空的鐵捲門
  for (let y = FY - 64; y < gapTop; y += 3) {
    p.rect(x, y, w, 3, 0x7a8088);
    p.rect(x, y, w, 1, 0x9aa0a8);
    p.rect(x, y + 2, w, 1, 0x4a5058);
  }
  p.rect(x, gapTop - 2, w, 3, 0x3a3e44);
  p.rect(x + w / 2 - 6, gapTop - 1, 12, 2, 0xb0b0b0);
  // 光從門縫灑到地上
  for (let j = 0; j < 12; j++) p.rect(x - j * 1.5, FY + j, w + j * 3, 1, l.light, 0.08);
  fig(p, 40, FY, 'stand', PAL.you);
  fig(p, 232, FY, 'stand', PAL.survivor, 3, true);
}

/** 沉睡的屍群：大廳裡一動也不動的影子，後面是物資 */
function paintSleepers(p: Painter, l: Look): void {
  interior(p, l, { tiles: true });
  p.rect(0, 0, W, H, 0x000010, 0.25);
  const pals = [PAL.zombie, PAL.zombie2, PAL.zombie3];
  [[70, 3], [100, 3], [132, 3], [160, 3], [190, 3]].forEach(([x], i) => {
    fig(p, x, FY + (i % 2) * 2, 'zStand', pals[i % 3], 3, i % 2 === 1, 0.35);
  });
  zzz(p, 120, 18);
  zzz(p, 176, 22);
  // 遠處的物資
  crate(p, 236, FY - 18, 20, 18, 0x5a6a34);
  crate(p, 254, FY - 14, 16, 14);
  glow(p, 250, FY - 10, 18, 0xffd24a, 0.05);
  // 主角躲在左邊柱子後
  p.box(28, 0, 14, FY, tone(l.wall, -0.3));
  fig(p, 10, FY, 'crouch', PAL.you, 3, false);
}

/** 巡邏的霧屍：停車場、路燈、車子 */
function paintPatrol(p: Painter, l: Look): void {
  exterior(p, l);
  // 路燈
  p.rect(150, 10, 2, FY - 10, 0x2a2a2e);
  p.rect(150, 10, 12, 2, 0x2a2a2e);
  p.rect(158, 12, 6, 2, 0xf0e0a0);
  cone(p, 161, 14, 4, 70, 0xf0e0a0, 0.06);
  car(p, 20, 0x8a2a2a);
  car(p, 190, 0x2a4a7a, true);
  fig(p, 110, FY, 'zShamble', PAL.zombie, 3, false);
  fig(p, 160, FY + 2, 'zStand', PAL.zombie3, 3, true);
  // 霧屍的視線
  p.rect(136, FY - 26, 40, 1, 0xfff3a0, 0.25);
  fig(p, 250, FY, 'zShamble', PAL.zombie2, 3, true, 0.3);
  // 停車格線
  for (let x = 0; x < W; x += 46) p.rect(x, FY + 4, 1, 10, 0xc8c8c0, 0.4);
}

/** 被包圍的倖存者：公車頂上的人揮手，下面一圈霧屍 */
function paintTrapped(p: Painter, l: Look): void {
  exterior(p, l);
  // 公車（側面，鏡頭拉遠一點：人物縮小，車頂上的人才放得進畫面）
  const bx = 66;
  const by = FY - 30;
  p.box(bx, by, 150, 26, 0xc89a2a);
  p.rect(bx + 1, by + 18, 148, 3, 0x8a3a2a);
  for (let i = 0; i < 6; i++) p.window(bx + 8 + i * 23, by + 4, 18, 10, { broken: i === 2 || i === 4 });
  for (const wx of [bx + 26, bx + 124]) {
    p.circle(wx, FY - 3, 5, OUTLINE);
    p.circle(wx, FY - 3, 2, 0x4a4a4a);
  }
  // 車頂上的倖存者
  fig(p, 136, by, 'wave', PAL.survivor, 2, false);
  p.rect(154, by - 26, 1, 4, 0xffffff, 0.7);
  p.rect(157, by - 23, 3, 1, 0xffffff, 0.7);
  // 車邊的霧屍
  const pals = [PAL.zombie, PAL.zombie2, PAL.zombie3];
  [54, 78, 100, 124, 166, 190, 214, 236].forEach((x, i) => fig(p, x, FY + 2 + (i % 2) * 2, 'zReach', pals[i % 3], 2, i % 2 === 0));
  fig(p, 262, FY + 4, 'zShamble', PAL.zombie, 2, true, 0.4);
}

/** 睡在門口的大傢伙 */
function paintQuiet(p: Painter, l: Look): void {
  interior(p, l);
  p.rect(0, 0, W, H, 0x000010, 0.2);
  door(p, 132, 36, 56);
  // 巨大的霧屍擋在門前站著打盹
  fig(p, 132, FY + 2, 'zStand', { ...PAL.zombie, b: 0x5a4a3a, e: 0x5a6a40 }, 5, false);
  zzz(p, 172, 6);
  fig(p, 60, FY, 'zSleep', PAL.zombie3, 3, false, 0.2);
  fig(p, 214, FY, 'zSleep', PAL.zombie2, 3, true, 0.2);
  // 主角拿著球棒躡手躡腳
  fig(p, 20, FY, 'crouch', PAL.you, 3, false);
  p.line(40, FY - 22, 48, FY - 36, 0x8a6a3a);
  p.line(41, FY - 22, 49, FY - 36, 0x6a4a2a);
}

/** 倉庫裡的補給：整箱彈藥，門口已經有影子 */
function paintHold(p: Painter, l: Look): void {
  interior(p, l);
  shelf(p, 14, 60, 54);
  for (let i = 0; i < 3; i++) ammoBox(p, 18 + i * 18, FY - 52 + 2, 16, 10);
  for (let i = 0; i < 3; i++) ammoBox(p, 18 + i * 18, FY - 38 + 2, 16, 10);
  ammoBox(p, 96, FY - 12, 24, 12);
  ammoBox(p, 100, FY - 24, 20, 12);
  ammoBox(p, 124, FY - 12, 22, 12);
  glow(p, 112, FY - 16, 26, 0xffd24a, 0.05);
  fig(p, 150, FY, 'gun', PAL.you, 3, false);
  // 右邊門口湧進來的影子
  door(p, 220, 40, 54, 0x3a3a40, 0);
  fig(p, 222, FY, 'zShamble', PAL.zombie, 3, true, 0.2);
  fig(p, 240, FY + 2, 'zShamble', PAL.zombie2, 3, true, 0.4);
  p.rect(214, FY - 64, 2, 7, 0xff6b6b);
  p.rect(214, FY - 55, 2, 2, 0xff6b6b);
}

/** 陌生的拾荒者：營火旁戴防毒面具的人舉起雙手 */
function paintTrader(p: Painter, l: Look): void {
  exterior(p, l);
  // 營火
  const fx = 142;
  glow(p, fx, FY - 6, 40, 0xf0a030, 0.06);
  p.rect(fx - 8, FY - 3, 16, 3, 0x4a2a1a);
  p.line(fx - 9, FY - 1, fx + 8, FY - 4, 0x5a3a22);
  p.ellipse(fx, FY - 8, 4, 6, 0xf07020);
  p.ellipse(fx, FY - 9, 2, 4, 0xffd24a);
  p.px(fx + 2, FY - 18, 0xf0a030);
  p.px(fx - 2, FY - 22, 0xf0a030, 0.6);
  // 拾荒者：大背包＋防毒面具
  p.box(186, FY - 34, 16, 24, 0x5a4a2a);
  p.rect(188, FY - 30, 12, 2, 0x3a2a1a);
  p.rect(190, FY - 40, 8, 6, 0x3a5a7a);
  fig(p, 176, FY, 'handsUp', PAL.masked, 3, true);
  // 面具的濾毒罐
  p.rect(178, FY - 27, 4, 4, 0x3a3a3a);
  p.rect(184, FY - 30, 2, 2, 0x8ab0c0);
  fig(p, 70, FY, 'gun', PAL.you, 3, false);
  p.rect(0, 0, W, H, 0xf0a030, 0.04);
}

/** 受傷的倖存者：靠著牆坐，抱著腿，地上一灘血 */
function paintWounded(p: Painter, l: Look): void {
  interior(p, l);
  p.rect(0, 0, W, H, 0x000010, 0.15);
  bulb(p, 150, 14, l.light);
  cone(p, 150, 16, 6, 80, l.light, 0.05);
  p.ellipse(158, FY + 3, 26, 3, 0x6a1010);
  p.ellipse(162, FY + 3, 14, 2, 0x8a1a1a);
  fig(p, 126, FY, 'sit', PAL.survivor, 3, false);
  // 腿上的傷
  p.rect(148, FY - 6, 6, 3, 0xb02020);
  p.rect(150, FY - 5, 2, 1, 0xe04040);
  // 手印
  p.rect(130, FY - 40, 3, 4, 0x6a1010, 0.8);
  p.rect(134, FY - 38, 2, 3, 0x6a1010, 0.8);
  fig(p, 60, FY, 'stand', PAL.you);
  // 他的背包
  p.box(196, FY - 12, 14, 12, 0x3a5a3a);
}

/** 可疑的絆線：橫過走廊的細線，牆邊綁著生鏽的手榴彈 */
function paintTrap(p: Painter, l: Look): void {
  interior(p, l);
  // 水管
  p.rect(214, 0, 4, FY, 0x5a5a60);
  p.rect(214, 0, 1, FY, 0x8a8a90);
  // 手榴彈綁在水管上
  grenadeIcon(p, 210, FY - 18);
  grenadeIcon(p, 211, FY - 18);
  p.rect(212, FY - 12, 6, 1, 0xc0a060);
  // 絆線（閃一下的亮線）
  p.line(40, FY - 6, 212, FY - 10, 0xe8e8e8, 0.9);
  for (let x = 80; x < 200; x += 30) p.px(x, FY - 8, 0xffffff);
  glow(p, 214, FY - 14, 12, 0xff6b6b, 0.08);
  p.rect(36, FY - 10, 4, 10, 0x5a5a60);
  // 主角停下腳步
  fig(p, 62, FY, 'stand', PAL.you);
  p.rect(84, FY - 46, 2, 6, 0xffd24a);
  p.rect(84, FY - 38, 2, 2, 0xffd24a);
  // 走廊盡頭的門
  door(p, 246, 26, 46, 0x4a3a2a);
}

/** 藏匿點：鐵絲網後面的物資箱，入口有霧屍 */
function paintCache(p: Painter, l: Look): void {
  exterior(p, l);
  // 防水布蓋著的物資堆
  p.box(190, FY - 30, 70, 30, 0x3a5a3a);
  p.line(190, FY - 30, 226, FY - 40, 0x2a4a2a);
  p.line(226, FY - 40, 260, FY - 30, 0x2a4a2a);
  p.rect(200, FY - 20, 50, 1, tone(0x3a5a3a, -0.3));
  crate(p, 196, FY - 14, 16, 14);
  ammoBox(p, 232, FY - 12);
  glow(p, 226, FY - 20, 30, 0xffd24a, 0.05);
  // 鐵絲網
  for (let x = 150; x < 280; x += 8) p.rect(x, FY - 44, 1, 44, 0x6a6a70, 0.6);
  p.rect(150, FY - 44, 130, 1, 0x8a8a90);
  for (let y = FY - 40; y < FY; y += 6) for (let x = 150; x < 280; x += 8) p.line(x, y, x + 8, y + 6, 0x6a6a70, 0.3);
  // 入口的霧屍
  fig(p, 120, FY, 'zStand', PAL.zombie, 3, true);
  fig(p, 140, FY + 2, 'zShamble', PAL.zombie2, 3, true);
  fig(p, 30, FY, 'crouch', PAL.you, 3, false);
}

/** 避難所：家具堵住的門，外面的霧屍在撞門 */
function paintShelter(p: Painter, l: Look): void {
  interior(p, l);
  door(p, 170, 40, 58, 0x5a3a24, 0);
  // 門縫透光
  p.rect(170, FY - 58, 1, 58, 0xffd890);
  p.rect(209, FY - 58, 1, 58, 0xffd890);
  // 門前堆的家具與木板
  p.box(160, FY - 22, 56, 22, 0x6a4a30);
  p.rect(162, FY - 12, 52, 1, tone(0x6a4a30, -0.3));
  p.line(166, FY - 52, 212, FY - 34, 0x8a6a3a);
  p.line(166, FY - 51, 212, FY - 33, 0x6a4a2a);
  p.line(166, FY - 30, 212, FY - 48, 0x8a6a3a);
  // 撞門的霧屍
  fig(p, 112, FY, 'zReach', PAL.zombie, 3, false);
  fig(p, 136, FY + 2, 'zShamble', PAL.zombie3, 3, false);
  fig(p, 84, FY, 'zShamble', PAL.zombie2, 3, false, 0.25);
  shake(p, 156, FY - 46);
  shake(p, 156, FY - 26);
  fig(p, 20, FY, 'gun', PAL.you, 3, false);
}

/** 上鎖的槍械櫃：一整排，旁邊站著穿制服的霧屍 */
function paintArmory(p: Painter, l: Look): void {
  interior(p, l);
  for (let i = 0; i < 4; i++) {
    const x = 120 + i * 38;
    p.box(x, FY - 58, 34, 58, 0x3a4048);
    p.rect(x + 4, FY - 54, 26, 36, 0x101418);
    // 玻璃後的槍影
    p.rect(x + 8, FY - 50, 2, 28, 0x2a2a2a);
    p.rect(x + 15, FY - 50, 2, 28, 0x2a2a2a);
    p.rect(x + 22, FY - 50, 2, 28, 0x2a2a2a);
    p.line(x + 5, FY - 52, x + 14, FY - 44, 0x6a8090, 0.5);
    padlock(p, x + 13, FY - 14);
  }
  fig(p, 96, FY, 'zStand', PAL.cop, 3, true);
  fig(p, 270, FY + 2, 'zStand', PAL.cop, 3, true, 0.15);
  fig(p, 28, FY, 'crouch', PAL.you, 3, false);
}

/** 屍潮：紅色的霧裡湧出一大群影子 */
function paintHorde(p: Painter, l: Look): void {
  exterior(p, l, { red: true });
  const pals = [PAL.zombie, PAL.zombie2, PAL.zombie3];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 12; i++) {
      const x = 80 + i * 17 + p.rnd.between(-4, 4) + row * 6;
      fig(p, x, FY - 6 + row * 5, i % 2 ? 'zShamble' : 'zReach', pals[(i + row) % 3], 2 + (row === 2 ? 1 : 0), true, 0.55 - row * 0.2);
    }
  }
  fig(p, 26, FY + 4, 'gun', PAL.you, 3, false);
  p.rect(0, 0, W, H, 0xa01010, 0.1);
}

/** 沿街前進：主角往右走，路邊有翻倒的車、遠方的影子 */
function paintWalk(p: Painter, l: Look): void {
  exterior(p, l);
  car(p, 160, 0x5a5a62);
  fig(p, 60, FY, 'stand', PAL.you);
  fig(p, 248, FY, 'zShamble', PAL.zombie, 3, true, 0.5);
  // 往右的箭頭
  for (let i = 0; i < 3; i++) p.rect(100 + i * 10, FY + 8, 6, 2, 0xf5d76e, 0.7);
}

// ── 小圖示（12×12） ───────────────────────────────

export type IconId =
  | 'scrap'
  | 'ammo'
  | 'medkit'
  | 'grenade'
  | 'lockpick'
  | 'decoy'
  | 'gun'
  | 'survivor'
  | 'hurt'
  | 'noise'
  | 'timing'
  | 'arrows'
  | 'mash'
  | 'stealth'
  | 'fight'
  | 'protect'
  | 'survive'
  | 'check'
  | 'bag'
  | 'leave'
  | 'walk'
  | 'melee'
  | 'trade'
  | 'fast'
  | 'none';

/** 字元圖：# 外框、其他字元對應下面的顏色 */
const ICONS: Record<Exclude<IconId, 'none'>, { rows: string[]; pal: Record<string, number> }> = {
  scrap: { rows: ['....##......', '...#aa#.....', '..#aaaa#....', '.#aa##aa#...', '.#a#..#a#...', '.#aa##aa#...', '..#aaaa#.##.', '...#aa#.#bb#', '....##.#bbb#', '.......#bbb#', '........###.', '............'], pal: { a: 0x9aa0a8, b: 0xb07a4a } },
  ammo: { rows: ['..#...#...#.', '.#y#.#y#.#y#', '.#y#.#y#.#y#', '#bbb##bb##bb', '#bbb##bb##bb', '#bbb##bb##bb', '#bbb##bb##bb', '#bbb##bb##bb', '#ddd##dd##dd', '############', '............', '............'], pal: { y: 0xe0c060, b: 0xc8a040, d: 0x8a6a2a } },
  medkit: { rows: ['....####....', '...#....#...', '############', '#wwwwwwwwww#', '#wwwwrrwwww#', '#wwwwrrwwww#', '#wwrrrrrrww#', '#wwwwrrwwww#', '#wwwwrrwwww#', '#gggggggggg#', '############', '............'], pal: { w: 0xe8e8e0, r: 0xd03030, g: 0xa8a8a0 } },
  grenade: { rows: ['....##......', '...#ss#.##..', '...#ss##s#..', '..######....', '.#gggggg#...', '#gGgGgGgg#..', '#gggggggg#..', '#gGgGgGgg#..', '#gggggggg#..', '.#gggggg#...', '..######....', '............'], pal: { s: 0x9aa0a8, g: 0x5a6a3a, G: 0x3a4a2a } },
  lockpick: { rows: ['..######....', '.#......#...', '.#.####.#...', '.#.#..#.#...', '############', '#yyyyyyyyyy#', '#yyyy##yyyy#', '#yyyy##yyyy#', '#yyyyy#yyyy#', '#yyyyyyyyyy#', '############', '............'], pal: { y: 0xc8a040 } },
  decoy: { rows: ['.##......##.', '#rr#....#rr#', '.#.######.#.', '..#wwwwww#..', '.#ww#wwwww#.', '.#ww#wwwww#.', '.#ww###www#.', '.#wwwwwwww#.', '..#wwwwww#..', '...######...', '..#......#..', '............'], pal: { r: 0xd03030, w: 0xe8e0c8 } },
  gun: { rows: ['............', '.##########.', '#gggggggggg#', '#gGGGGGGGgg#', '.####gg####.', '....#gg#....', '...#gg#.....', '..#gg#......', '..#gg#......', '..####......', '............', '............'], pal: { g: 0x5a5e66, G: 0x8a8e96 } },
  survivor: { rows: ['....####....', '...#hhhh#...', '...#ssss#...', '...#ssss#...', '....####....', '..########..', '.#bbbbbbbb#.', '.#bbbbbbbb#.', '.#bbbbbbbb#.', '..#ll##ll#..', '..#ll##ll#..', '..###..###..'], pal: { h: 0x3a2a1c, s: 0xd8a878, b: 0x6ab04a, l: 0x3a3a48 } },
  hurt: { rows: ['.....##.....', '....#rr#....', '....#rr#....', '...#rrrr#...', '..#rrrrrr#..', '.#rrrwrrrr#.', '.#rrwrrrrr#.', '.#rrrrrrrr#.', '.#rrrrrrrr#.', '..#rrrrrr#..', '...######...', '............'], pal: { r: 0xd03030, w: 0xff9090 } },
  noise: { rows: ['.....#......', '....##...#..', '...#w#.#..#.', '####w#..#.#.', '#www.#.#.#.#', '#www.#.#.#.#', '#www.#.#.#.#', '####w#..#.#.', '...#w#.#..#.', '....##...#..', '.....#......', '............'], pal: { w: 0xffcc80 } },
  timing: { rows: ['............', '############', '#dddggggddd#', '#dddggggddd#', '#dddggggddd#', '############', '.....#y.....', '....#yy#....', '...#yyyy#...', '...######...', '............', '............'], pal: { d: 0x2a2f3a, g: 0x4caf50, y: 0xf5d76e } },
  arrows: { rows: ['.....##.....', '....#yy#....', '...#yyyy#...', '..###yy###..', '.##..yy..##.', '#yy..yy..yy#', '#yyyyyyyyyy#', '.##......##.', '..#.####.#..', '....#yy#....', '.....##.....', '............'], pal: { y: 0xf5d76e } },
  mash: { rows: ['..##.##.##..', '.#ss#ss#ss#.', '.#ss#ss#ss#.', '.#ss#ss#ss##', '.#ssssssss#s', '.#ssssssss##', '.#ssssssss#.', '..#ssssss#..', '..#bbbbbb#..', '..#bbbbbb#..', '..########..', '............'], pal: { s: 0xd8a878, b: 0x4a5a3a } },
  stealth: { rows: ['............', '....####....', '..##wwww##..', '.#wwwbbwww#.', '#wwwbbbbwww#', '#wwwbbbbwww#', '.#wwwbbwww#.', '..##wwww##..', '....####....', '.#........#.', '..#......#..', '............'], pal: { w: 0xc8d0d8, b: 0x2a3a5a } },
  fight: { rows: ['....rrrr....', '..rr.rr.rr..', '.r...rr...r.', '.r........r.', 'r..........r', 'rrrr....rrrr', 'rrrr....rrrr', 'r..........r', '.r........r.', '.r...rr...r.', '..rr.rr.rr..', '....rrrr....'], pal: { r: 0xff6b6b } },
  protect: { rows: ['.##########.', '#bbbbbbbbbb#', '#bbbwwwwbbb#', '#bbbwwwwbbb#', '#bwwwwwwwwb#', '#bwwwwwwwwb#', '.#bbwwwwbb#.', '.#bbbwwbbb#.', '..#bbbbbb#..', '...#bbbb#...', '....####....', '............'], pal: { b: 0x4a7ab0, w: 0xe8e8e0 } },
  survive: { rows: ['############', '#..........#', '.#yyyyyyyy#.', '..#yyyyyy#..', '...#yyyy#...', '....#yy#....', '....#..#....', '...#....#...', '..#..yy..#..', '.#.yyyyyy.#.', '############', '............'], pal: { y: 0xf5d76e } },
  check: { rows: ['.##########.', '#wwwwwwwwww#', '#w##wwww##w#', '#w##wwww##w#', '#wwwww##www#', '#wwww##wwww#', '#wwwwwwwwww#', '#w##wwww##w#', '#w##wwww##w#', '#wwwwwwwwww#', '.##########.', '............'], pal: { w: 0xe8e8e0 } },
  bag: { rows: ['....####....', '...#....#...', '..##########', '.#bbbbbbbbb#', '#bbbbbbbbbbb', '#bbbyyyybbb#', '#bbbyyyybbb#', '#bbbbbbbbbb#', '#bbbbbbbbbb#', '#BBBBBBBBBB#', '.##########.', '............'], pal: { b: 0x8a6a3a, B: 0x6a4a2a, y: 0xc8a040 } },
  leave: { rows: ['#######.....', '#ddddd#.....', '#ddddd#..#..', '#ddddd#..##.', '#dddyd######', '#ddddd#wwww#', '#ddddd######', '#ddddd#..##.', '#ddddd#..#..', '#ddddd#.....', '#######.....', '............'], pal: { d: 0x6a4a30, y: 0xc8a040, w: 0x9ad17a } },
  walk: { rows: ['....##......', '...#hh#.....', '...#ss#.....', '..######....', '.#bbbbb#....', '.#bbbbb##...', '..#bbbb#....', '..#ll#l#....', '.#ll#.#l#...', '#ll#...#l#..', '###.....##..', '............'], pal: { h: 0x2a2018, s: 0xd8a878, b: 0x4a5a3a, l: 0x2e3440 } },
  melee: { rows: ['.........##.', '........#ww#', '.......#ww#.', '......#ww#..', '.....#ww#...', '....#ww#....', '.##.#w#.....', '.#b##.......', '..#bb#......', '.#b##b#.....', '#b#..#......', '##..........'], pal: { w: 0xc8d0d8, b: 0x6a4a2a } },
  fast: { rows: ['............', '.#...#......', '#y#.#y#.....', '#yy##yy#....', '.#yy##yy#...', '..#yy##yy#..', '..#yy##yy#..', '.#yy##yy#...', '#yy##yy#....', '#y#.#y#.....', '.#...#......', '............'], pal: { y: 0xf5d76e } },
  trade: { rows: ['............', '.####..####.', '#yyyy##yyyy#', '#y##y##y##y#', '#yyyy##yyyy#', '.####..####.', '...#....#...', '..#......#..', '.#ssssssss#.', '#ssssssssss#', '.##########.', '............'], pal: { y: 0xc8a040, s: 0xd8a878 } },
};

/** 所有小圖示畫在一張貼圖上，每格 12×12（frame 名稱就是 id） */
export function ensureIcons(scene: Phaser.Scene): string {
  const key = 'evicons';
  if (scene.textures.exists(key)) return key;
  const ids = Object.keys(ICONS) as Exclude<IconId, 'none'>[];
  const tex = canvasTexture(scene, key, ids.length * 12, 12, (p) => {
    ids.forEach((id, n) => {
      const { rows, pal } = ICONS[id];
      rows.forEach((row, j) => {
        for (let i = 0; i < 12; i++) {
          const ch = row[i];
          if (!ch || ch === '.') continue;
          p.px(n * 12 + i, j, ch === '#' ? OUTLINE : pal[ch] ?? 0xffffff);
        }
      });
    });
  });
  ids.forEach((id, n) => tex.add(id, 0, n * 12, 0, 12, 12));
  return key;
}

export function icon(scene: Phaser.Scene, x: number, y: number, id: IconId): Phaser.GameObjects.Image | null {
  if (id === 'none') return null;
  return scene.add.image(x, y, ensureIcons(scene), id).setDepth(101);
}
