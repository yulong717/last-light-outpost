import Phaser from 'phaser';
import { canvasTexture, mix, OUTLINE, tone, type Painter } from './Painter';
import { carton, crate, fig, glow, grenadeIcon, lookFor, PAL, shake, type Look, type Pal } from './EventArt';
import type { QteGrade } from '../data/explore';

/**
 * 招牌 QTE 事件的漫畫分鏡（每格 128×78 邏輯像素，畫面上放大 2 倍）。
 * 一個事件五格：s1、s2（交代狀況）、great／ok／fail（依 QTE 結果）。動作格沿用 s2 放大裁切。
 * 美式漫畫的味道靠：速度線、網點、爆炸框、斜構圖、大特寫。
 * 全部用 Painter 程式畫，同一格在不同區域會換上那一區的牆色與天色。貼圖 key = comic_<事件>_<格>_<區域>。
 */

export const PANEL_W = 128;
export const PANEL_H = 78;
const W = PANEL_W;
const H = PANEL_H;
/** 地面線 */
const FY = 62;

export type PanelSlot = 's1' | 's2' | QteGrade;

type Paint = (p: Painter, l: Look) => void;

const DOG: Pal = { h: 0x3a2a20, s: 0x9a6458, b: 0x6a5040, l: 0x4a3a30, e: 0xe8f070 };
const BLOOD = 0x9a1a1a;
const HOT = 0xffd24a;

// ── 共用：漫畫效果 ─────────────────────────────────

/** 放射狀速度線：從畫面四周往焦點收 */
function speedLines(p: Painter, cx: number, cy: number, c = 0xffffff, a = 0.35, n = 28): void {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + p.rnd.realInRange(-0.06, 0.06);
    const r0 = p.rnd.between(26, 40);
    const r1 = 110;
    p.line(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1, c, a);
  }
}

/** 水平速度線（衝刺、墜落） */
function dashLines(p: Painter, y0: number, y1: number, c = 0xffffff, a = 0.3, vertical = false): void {
  for (let i = 0; i < 18; i++) {
    const len = p.rnd.between(10, 34);
    if (vertical) {
      const x = p.rnd.between(0, W);
      const y = p.rnd.between(y0, y1);
      p.rect(x, y, 1, len, c, a);
    } else {
      const y = p.rnd.between(y0, y1);
      const x = p.rnd.between(-10, W);
      p.rect(x, y, len, 1, c, a);
    }
  }
}

/** 網點：整格疊一層規則的圓點（印刷感） */
function halftone(p: Painter, x: number, y: number, w: number, h: number, c: number, a = 0.18, step = 4): void {
  for (let j = 0; j < h; j += step) for (let i = (j / step) % 2 ? step / 2 : 0; i < w; i += step) p.px(x + i, y + j, c, a);
}

/** 鋸齒爆炸框（撞擊、爆炸） */
function burst(p: Painter, cx: number, cy: number, r: number, c: number, inner = 0xffffff): void {
  const pts = 14;
  for (let k = 0; k < pts; k++) {
    const a0 = (k / pts) * Math.PI * 2;
    const rr = k % 2 ? r : r * 0.55;
    p.line(cx, cy, cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr, c);
    p.line(cx + 1, cy, cx + 1 + Math.cos(a0) * rr, cy + Math.sin(a0) * rr, c);
  }
  p.circle(cx, cy, Math.round(r * 0.45), c);
  p.circle(cx, cy, Math.round(r * 0.25), inner);
}

/** 汗珠、驚嚇符號 */
function sweat(p: Painter, x: number, y: number): void {
  p.rect(x, y, 2, 3, 0xa8d8ff);
  p.px(x, y - 1, 0xa8d8ff);
  p.rect(x + 4, y + 3, 2, 3, 0xa8d8ff);
}

function exclaim(p: Painter, x: number, y: number, c = HOT): void {
  p.rect(x - 1, y - 1, 4, 10, OUTLINE);
  p.rect(x, y, 2, 6, c);
  p.rect(x, y + 7, 2, 2, c);
}

/** 整格染色（失敗格偏紅、回憶格偏藍） */
function tint(p: Painter, c: number, a: number): void {
  p.rect(0, 0, W, H, c, a);
}

/** 四周壓暗 */
function vignette(p: Painter): void {
  for (let i = 0; i < 6; i++) {
    const a = 0.16 * (1 - i / 6);
    p.rect(i, 0, 1, H, 0x000000, a * 2);
    p.rect(W - 1 - i, 0, 1, H, 0x000000, a * 2);
    p.rect(0, i, W, 1, 0x000000, a);
    p.rect(0, H - 1 - i, W, 1, 0x000000, a * 1.5);
  }
}

// ── 共用：背景 ─────────────────────────────────────

function room(p: Painter, l: Look, fy = FY): void {
  const wall = tone(l.wall, -0.25);
  p.gradient(0, 0, W, fy, tone(wall, -0.3), tone(wall, -0.05), 5);
  for (let x = 4; x < W; x += 20) p.rect(x, 0, 1, fy - 8, tone(wall, -0.35), 0.7);
  for (let i = 0; i < 24; i++) p.px(p.rnd.between(0, W), p.rnd.between(2, fy - 9), tone(wall, p.rnd.frac() < 0.5 ? -0.4 : 0.15));
  p.rect(0, fy - 8, W, 8, tone(wall, -0.45));
  p.rect(0, fy - 8, W, 1, tone(wall, 0.15));
  ground(p, l.floor, fy);
}

function ground(p: Painter, c: number, fy = FY): void {
  p.gradient(0, fy, W, H - fy, tone(c, 0.05), tone(c, -0.5), 3);
  p.rect(0, fy, W, 1, OUTLINE);
  for (let x = 0; x < W; x += 16) p.line(x, fy + 1, x - 8, H, tone(c, -0.25), 0.5);
}

function street(p: Painter, l: Look): void {
  const [top, bot] = l.sky;
  p.gradient(0, 0, W, FY, tone(top, -0.3), tone(bot, -0.2), 5);
  const far = mix(tone(top, -0.4), 0x101014, 0.4);
  let x = -3;
  while (x < W) {
    const w = p.rnd.between(10, 22);
    const h = p.rnd.between(14, 34);
    p.rect(x, FY - h, w, h, far);
    for (let wy = FY - h + 3; wy < FY - 3; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (p.rnd.frac() < 0.05) p.rect(wx, wy, 1, 2, 0x8a6a34);
    x += w + p.rnd.between(0, 3);
  }
  p.dither(0, FY - 6, W, 6, mix(bot, 0xa0a0a0, 0.35), 0.35, 0.2);
  const road = 0x34363c;
  p.gradient(0, FY, W, H - FY, tone(road, 0.05), tone(road, -0.5), 3);
  p.rect(0, FY, W, 1, tone(road, 0.3));
  for (let x2 = 6; x2 < W; x2 += 26) p.rect(x2, FY + 6, 10, 1, 0x8a7a40, 0.7);
}

/** 單色剪影背景（動作格的戲劇化處理） */
function flatBg(p: Painter, c: number, lines = true, cx = W / 2, cy = H / 2): void {
  p.rect(0, 0, W, H, c);
  halftone(p, 0, 0, W, H, tone(c, 0.35), 0.35, 3);
  if (lines) speedLines(p, cx, cy, tone(c, 0.5), 0.45, 36);
}

// ── 共用：物件 ─────────────────────────────────────

/** 大特寫用的手臂（水平），bite：咬痕 */
function arm(p: Painter, x: number, y: number, len: number, skin: number, sleeve: number, bite = false): void {
  p.rect(x - 1, y - 1, len + 2, 12, OUTLINE);
  p.rect(x, y, len, 10, skin);
  p.rect(x, y, len, 2, tone(skin, 0.15));
  p.rect(x, y + 8, len, 2, tone(skin, -0.2));
  p.box(x - 20, y - 3, 22, 16, sleeve);
  if (bite) {
    for (let i = 0; i < 6; i++) {
      p.rect(x + 26 + i * 4, y + 1 + (i % 2), 2, 3, BLOOD);
      p.rect(x + 26 + i * 4, y + 6 - (i % 2), 2, 3, BLOOD);
    }
    p.rect(x + 30, y + 10, 2, 5, BLOOD);
    p.rect(x + 38, y + 10, 1, 8, BLOOD);
  }
}

/** 大特寫的霧屍頭（張嘴） */
function zHead(p: Painter, cx: number, cy: number, r: number, pal: Pal = PAL.zombie): void {
  p.circle(cx, cy, r + 1, OUTLINE);
  p.circle(cx, cy, r, pal.s);
  p.rect(cx - r, cy - r, r * 2, Math.round(r * 0.7), pal.h);
  p.rect(cx - r + 1, cy - r + Math.round(r * 0.7), 2, 3, pal.h);
  // 眼睛
  p.rect(cx - Math.round(r * 0.55), cy - 2, 4, 3, OUTLINE);
  p.rect(cx + Math.round(r * 0.15), cy - 2, 4, 3, OUTLINE);
  p.rect(cx - Math.round(r * 0.55) + 1, cy - 1, 2, 1, pal.e ?? 0xd8f070);
  p.rect(cx + Math.round(r * 0.15) + 1, cy - 1, 2, 1, pal.e ?? 0xd8f070);
  // 嘴
  const mw = Math.round(r * 0.9);
  p.rect(cx - mw / 2, cy + 4, mw, Math.round(r * 0.45), 0x2a0808);
  for (let i = 0; i < mw; i += 2) {
    p.px(cx - mw / 2 + i, cy + 4, 0xd8d0b0);
    p.px(cx - mw / 2 + i + 1, cy + 3 + Math.round(r * 0.45), 0xd8d0b0);
  }
  p.rect(cx - 2, cy + 4 + Math.round(r * 0.45), 1, 4, BLOOD);
}

function wardrobe(p: Painter, x: number, w: number, h: number, open = 0): void {
  const c = 0x6a4a30;
  const y = FY - h;
  p.box(x, y, w, h, c);
  p.rect(x + 2, y + 2, w - 4, h - 4, 0x0a0806);
  const dw = (w - 4) / 2;
  // 兩扇門：open 0 關上、1 全開（往外翻）
  const lw = Math.max(2, Math.round(dw * (1 - open)));
  p.box(x + 2, y + 2, lw, h - 4, tone(c, 0.05));
  p.box(x + w - 2 - lw, y + 2, lw, h - 4, tone(c, 0.05));
  if (open > 0) {
    p.box(x - Math.round(dw * open) + 2, y + 4, Math.round(dw * open), h - 8, tone(c, -0.15));
    p.box(x + w - 2, y + 4, Math.round(dw * open), h - 8, tone(c, -0.15));
  } else {
    p.rect(x + w / 2 - 3, y + h / 2, 2, 4, 0xc0a060);
    p.rect(x + w / 2 + 1, y + h / 2, 2, 4, 0xc0a060);
  }
  p.rect(x - 2, y - 3, w + 4, 3, tone(c, -0.3));
}

function shutter(p: Painter, x: number, w: number, top: number, bottom: number): void {
  p.rect(x - 4, top - 6, w + 8, 8, 0x3a3e46);
  p.rect(x - 4, top - 6, w + 8, 1, 0x6a707a);
  for (let y = top; y < bottom; y += 3) {
    p.rect(x, y, w, 3, 0x7a808a);
    p.rect(x, y, w, 1, 0x9aa0aa);
    p.rect(x, y + 2, w, 1, 0x4a4e56);
  }
  p.rect(x, bottom - 1, w, 2, 0x2a2c30);
  p.rect(x - 4, top - 6, 4, FY - top + 6, 0x2a2c30);
  p.rect(x + w, top - 6, 4, FY - top + 6, 0x2a2c30);
}

function stairs(p: Painter, l: Look): void {
  room(p, l);
  // 往右上爬的樓梯
  const c = tone(l.floor, 0.1);
  for (let i = 0; i < 9; i++) {
    const x = 34 + i * 10;
    const y = FY - i * 7;
    p.rect(x, y - 7, W, 7, tone(c, -i * 0.03));
    p.rect(x, y - 7, W, 1, tone(c, 0.25));
    p.rect(x, y - 7, 1, 7, OUTLINE);
  }
  // 扶手
  p.line(30, FY - 20, 124, FY - 84, 0x8a8a90);
  p.line(30, FY - 19, 124, FY - 83, 0x4a4a50);
  for (let i = 0; i < 9; i++) p.rect(36 + i * 10, FY - 26 - i * 7, 1, 14, 0x5a5a60);
}

function underCar(p: Painter, x: number, y: number, w: number): void {
  const c = 0x4a5260;
  p.box(x, y, w, 20, c);
  p.box(x + 12, y - 12, w - 28, 14, tone(c, -0.1));
  p.rect(x + 15, y - 9, (w - 34) / 2, 9, 0x1c2630);
  p.rect(x + 17 + (w - 34) / 2, y - 9, (w - 34) / 2, 9, 0x1c2630);
  p.rect(x + 2, y + 20, w - 4, FY - y - 20, 0x050505);
  for (const wx of [x + 12, x + w - 12]) {
    p.circle(wx, FY - 4, 6, OUTLINE);
    p.circle(wx, FY - 4, 3, 0x4a4a4a);
  }
}

// ── 各事件 ─────────────────────────────────────

const floorHole = (p: Painter, l: Look, x0: number) => {
  p.rect(x0, FY - 1, W - x0, H - FY + 1, 0x050505);
  for (let x = x0; x < x0 + 6; x++) p.rect(x, FY + p.rnd.between(-1, 3), 1, 4, tone(l.floor, -0.2));
  // 橫樑
  for (const bx of [x0 + 16, x0 + 34, x0 + 50]) p.box(bx, FY - 1, W - bx > 0 ? 6 : 0, 4, 0x6a4a30);
};

const PANELS: Record<string, Record<PanelSlot, Paint>> = {
  floor: {
    s1: (p, l) => {
      room(p, l);
      floorHole(p, l, 62);
      fig(p, 30, FY, 'stand', PAL.you, 3, false);
      shake(p, 66, FY - 6, 0xc8a070);
    },
    s2: (p, l) => {
      // 往下看：黑洞裡發光的眼睛與伸上來的手
      p.rect(0, 0, W, H, 0x040404);
      p.rect(0, 0, W, 8, tone(l.floor, -0.1));
      p.rect(0, H - 8, W, 8, tone(l.floor, -0.1));
      for (let i = 0; i < 5; i++) p.box(14 + i * 24, 0, 6, H, 0x5a3e28);
      const eyes = [[20, 34], [46, 46], [70, 30], [96, 50], [110, 36], [58, 60]];
      for (const [x, y] of eyes) {
        glow(p, x, y, 6, 0xd8f070, 0.06);
        p.rect(x - 3, y, 2, 1, 0xe8f070);
        p.rect(x + 1, y, 2, 1, 0xe8f070);
      }
      for (const [x, y] of [[34, 62], [84, 60], [104, 66]]) {
        p.rect(x, y - 14, 3, 16, PAL.zombie.s);
        p.rect(x - 1, y - 16, 5, 3, PAL.zombie.s);
      }
    },
    great: (p, l) => {
      flatBg(p, tone(l.wall, -0.2), true, 64, 30);
      p.rect(0, FY, 26, H - FY, tone(l.floor, -0.1));
      p.rect(W - 30, FY, 30, H - FY, tone(l.floor, -0.1));
      p.rect(26, FY, W - 56, H - FY, 0x050505);
      fig(p, 50, 44, 'crouch', PAL.you, 3, false);
      dashLines(p, 20, 50, 0xffffff, 0.4);
      carton(p, 104, FY - 10, 14, 10, true);
      glow(p, 110, FY - 8, 12, HOT, 0.08);
    },
    ok: (p, l) => {
      room(p, l, 34);
      p.rect(0, 34, W, H - 34, 0x050505);
      p.box(0, 33, W, 4, tone(l.floor, -0.1));
      fig(p, 56, 72, 'hang', PAL.you, 3, false);
      sweat(p, 82, 40);
      sweat(p, 46, 44);
    },
    fail: (p, l) => {
      p.rect(0, 0, W, H, 0x060606);
      dashLines(p, 0, H, 0x9aa0a8, 0.25, true);
      p.box(18, 14, 26, 5, 0x6a4a30);
      p.box(80, 30, 22, 5, 0x6a4a30);
      for (let i = 0; i < 8; i++) p.rect(p.rnd.between(10, 118), p.rnd.between(4, 74), 3, 3, tone(l.floor, -0.1));
      fig(p, 54, 66, 'fall', PAL.you, 3);
      burst(p, 26, 60, 12, 0xd84a2a, HOT);
      tint(p, 0x600000, 0.18);
    },
  },
  ambush: {
    s1: (p, l) => {
      room(p, l);
      wardrobe(p, 46, 40, 52);
      shake(p, 88, 24, 0xffffff, 0.8);
      shake(p, 38, 34, 0xffffff, 0.8);
      // 門縫的抓痕
      for (let i = 0; i < 3; i++) p.line(63 + i * 2, 22, 61 + i * 2, 34, 0xc8b8a0);
    },
    s2: (p, l) => {
      flatBg(p, tone(l.wall, -0.15), true, 64, 36);
      wardrobe(p, 40, 48, 60, 1);
      burst(p, 64, 30, 22, 0xffffff, HOT);
      fig(p, 50, FY + 6, 'zReach', PAL.zombie2, 4, false);
    },
    great: (p, l) => {
      room(p, l);
      wardrobe(p, 70, 40, 52, 1);
      fig(p, 74, FY - 8, 'zSleep', PAL.zombie2, 3);
      fig(p, 32, FY, 'kick', PAL.you, 3, false);
      burst(p, 66, 40, 12, 0xffffff, HOT);
    },
    ok: (p, l) => {
      room(p, l);
      wardrobe(p, 86, 34, 50, 1);
      fig(p, 40, FY + 1, 'zSleep', PAL.zombie2, 3, true);
      fig(p, 20, FY, 'gun', PAL.you, 3, false);
      p.rect(48, FY - 2, 6, 1, BLOOD);
    },
    fail: (p) => {
      p.rect(0, 0, W, H, 0x2a0a0a);
      halftone(p, 0, 0, W, H, 0x7a2a2a, 0.4, 3);
      arm(p, 40, 44, 88, PAL.you.s, PAL.you.b, true);
      zHead(p, 72, 30, 16, PAL.zombie2);
      tint(p, 0x900000, 0.15);
    },
  },
  door: {
    s1: (p, l) => {
      room(p, l);
      shutter(p, 26, 76, 8, 36);
      p.rect(26, 36, 76, FY - 36, 0x060606);
      fig(p, 8, FY, 'stand', PAL.you, 3, false);
    },
    s2: (p, l) => {
      // 從門縫往裡看
      p.rect(0, 0, W, H, 0x050505);
      p.rect(0, 0, W, 22, 0x7a808a);
      for (let y = 0; y < 22; y += 3) p.rect(0, y, W, 1, 0x9aa0aa);
      p.rect(0, 21, W, 2, 0x2a2c30);
      glow(p, 64, 48, 30, l.light, 0.05);
      crate(p, 12, 40, 26, 20);
      crate(p, 42, 34, 30, 26, 0x6a7a40);
      crate(p, 78, 42, 22, 18);
      crate(p, 102, 38, 24, 22, 0x6a7a40);
      p.rect(48, 40, 18, 5, 0xc8a040);
    },
    great: (p, l) => {
      room(p, l);
      shutter(p, 26, 76, 6, 10);
      p.rect(26, 10, 76, FY - 10, tone(l.light, -0.6));
      crate(p, 70, 40, 24, 22);
      crate(p, 94, 44, 8, 18, 0x6a7a40);
      fig(p, 40, FY, 'handsUp', PAL.you, 3, false);
      burst(p, 64, 8, 10, 0xffffff, HOT);
    },
    ok: (p, l) => {
      room(p, l);
      shutter(p, 26, 76, 8, 34);
      p.rect(26, 34, 76, FY - 34, 0x0a0a0a);
      fig(p, 54, FY, 'crouch', PAL.you, 3, false);
      dashLines(p, 38, 60, 0xffffff, 0.25);
    },
    fail: (p, l) => {
      room(p, l);
      shutter(p, 26, 76, 8, FY);
      for (let i = 0; i < 14; i++) p.circle(p.rnd.between(20, 110), p.rnd.between(48, 66), p.rnd.between(2, 5), 0x9a9088, 0.5);
      fig(p, 4, FY + 2, 'sit', PAL.you, 3, false);
      burst(p, 64, 52, 12, 0xffffff, HOT);
      tint(p, 0x600000, 0.12);
    },
  },
  trap: {
    s1: (p, l) => {
      room(p, l);
      // 低角度：前景的鞋子、橫過走廊的細線
      p.line(0, FY - 4, W, FY - 6, 0xd8d8d8);
      p.px(60, FY - 5, 0xffffff);
      glow(p, 60, FY - 5, 5, 0xffffff, 0.1);
      p.box(8, FY - 10, 22, 10, 0x1a1614);
      p.box(26, FY - 8, 18, 8, 0x1a1614);
      p.rect(8, FY - 18, 14, 9, PAL.you.l);
    },
    s2: (p, l) => {
      p.rect(0, 0, W, H, tone(l.wall, -0.45));
      halftone(p, 0, 0, W, H, tone(l.wall, -0.1), 0.3, 3);
      // 大特寫：綁在桌腳上的手榴彈
      p.box(52, 0, 10, H, 0x6a4a30);
      for (let k = 0; k < 4; k++) p.rect(50, 24 + k * 4, 14, 2, 0x8a8a80);
      p.ellipse(72, 40, 12, 16, OUTLINE);
      p.ellipse(72, 40, 11, 15, 0x5a6a3a);
      for (let k = 0; k < 4; k++) p.rect(62, 30 + k * 6, 20, 1, tone(0x5a6a3a, -0.3));
      p.rect(66, 20, 12, 6, 0x8a8a90);
      p.circle(84, 22, 4, 0x8a8a90);
      p.circle(84, 22, 2, tone(l.wall, -0.45));
      p.line(84, 22, W, 30, 0xd8d8d8);
      for (let i = 0; i < 8; i++) p.px(62 + p.rnd.between(0, 20), 30 + p.rnd.between(0, 20), 0x8a4a2a);
      exclaim(p, 100, 46, 0xff6b6b);
    },
    great: (p) => {
      flatBg(p, 0x2a3a2a, true);
      // 手捧拆下的引信、零件排好
      arm(p, 20, 46, 40, PAL.you.s, PAL.you.b);
      p.rect(64, 44, 6, 12, 0x8a8a90);
      grenadeIcon(p, 80, 40);
      grenadeIcon(p, 92, 42);
      for (let i = 0; i < 4; i++) p.box(76 + i * 10, 56, 6, 4, 0x9aa0a8);
      glow(p, 90, 50, 18, HOT, 0.07);
    },
    ok: (p, l) => {
      room(p, l);
      p.line(0, FY - 4, 50, FY - 5, 0xd8d8d8);
      p.line(58, FY - 3, 76, FY + 3, 0xd8d8d8);
      fig(p, 66, FY + 2, 'sit', PAL.you, 3, false);
      sweat(p, 92, 26);
      sweat(p, 62, 30);
    },
    fail: (p) => {
      p.rect(0, 0, W, H, 0xffe0a0);
      burst(p, 64, 40, 40, 0xff8a2a, 0xffffff);
      burst(p, 64, 40, 24, 0xffd24a, 0xffffff);
      for (let i = 0; i < 16; i++) p.rect(p.rnd.between(0, W), p.rnd.between(0, H), 3, 2, OUTLINE);
      fig(p, 14, 70, 'fall', { ...PAL.you, h: OUTLINE, s: OUTLINE, b: OUTLINE, l: OUTLINE }, 3);
    },
  },
  chase: {
    s1: (p, l) => {
      stairs(p, l);
      // 樓上的影子
      p.rect(96, 0, 32, 20, 0x050505, 0.7);
      fig(p, 108, 22, 'zShamble', PAL.zombie3, 2, true, 0.6);
      for (let i = 0; i < 3; i++) shake(p, 92 - i * 6, 8 + i * 5, 0xffffff, 0.6);
      fig(p, 10, FY, 'stand', PAL.you, 3, false);
    },
    s2: (p, l) => {
      flatBg(p, tone(l.wall, -0.1), true, 64, 40);
      fig(p, 38, 76, 'zReach', PAL.zombie3, 5, false);
      exclaim(p, 112, 10);
    },
    great: (p, l) => {
      stairs(p, l);
      fig(p, 4, FY + 2, 'zSleep', PAL.zombie3, 3, true);
      burst(p, 18, FY - 8, 9, 0xffffff, HOT);
      fig(p, 76, FY - 34, 'gun', PAL.you, 3, false);
    },
    ok: (p, l) => {
      stairs(p, l);
      fig(p, 20, FY, 'gun', PAL.you, 3, false);
      fig(p, 52, FY - 8, 'zShamble', PAL.zombie3, 3, true);
      burst(p, 50, FY - 26, 10, 0xffffff, HOT);
    },
    fail: (p, l) => {
      stairs(p, l);
      fig(p, 20, FY + 2, 'zSleep', PAL.zombie3, 3, false);
      fig(p, 34, FY + 2, 'sit', PAL.you, 3, true);
      for (let i = 0; i < 4; i++) burst(p, 18 + i * 14, FY - 26 - (i % 2) * 6, 4, 0xffffff, HOT);
      tint(p, 0x600000, 0.15);
    },
  },
  dogs: {
    s1: (p, l) => {
      street(p, l);
      underCar(p, 36, 30, 80);
      for (const x of [62, 72]) {
        glow(p, x, 56, 5, 0xe8f070, 0.08);
        p.rect(x - 1, 56, 3, 1, 0xe8f070);
      }
      shake(p, 30, 50, 0xc8c8c8, 0.6);
    },
    s2: (p, l) => {
      flatBg(p, tone(l.sky[1], -0.3), true, 70, 36);
      fig(p, 24, 70, 'dog', DOG, 6, false);
      p.rect(96, 38, 2, 6, 0xd8d0b0);
      p.rect(102, 38, 2, 6, 0xd8d0b0);
    },
    great: (p, l) => {
      street(p, l);
      fig(p, 16, FY, 'gun', PAL.you, 3, false);
      fig(p, 54, FY - 18, 'dogLeap', DOG, 3, true);
      burst(p, 50, FY - 22, 12, 0xffffff, HOT);
    },
    ok: (p, l) => {
      street(p, l);
      underCar(p, 56, 30, 70);
      // 尾巴夾著、半截屁股還露在車外
      p.rect(48, 52, 12, 8, OUTLINE);
      p.rect(49, 53, 11, 6, DOG.b);
      p.rect(44, 57, 6, 2, DOG.b);
      shake(p, 40, 46, 0xffffff, 0.7);
      fig(p, 14, FY, 'gun', PAL.you, 3, false);
    },
    fail: (p) => {
      p.rect(0, 0, W, H, 0x2a0a0a);
      halftone(p, 0, 0, W, H, 0x7a2a2a, 0.4, 3);
      // 小腿特寫＋咬住的狗頭
      p.rect(46, 0, 22, 60, OUTLINE);
      p.rect(47, 0, 20, 60, PAL.you.l);
      p.box(40, 58, 34, 14, 0x1a1614);
      p.circle(80, 36, 18, OUTLINE);
      p.circle(80, 36, 17, DOG.s);
      p.rect(66, 22, 14, 8, DOG.h);
      p.rect(84, 30, 4, 3, OUTLINE);
      p.rect(85, 31, 2, 1, DOG.e!);
      for (let i = 0; i < 5; i++) p.rect(58 + i * 4, 40 + (i % 2) * 6, 2, 4, 0xd8d0b0);
      p.rect(56, 46, 3, 10, BLOOD);
      p.rect(62, 48, 2, 14, BLOOD);
      tint(p, 0x900000, 0.12);
    },
  },
};

export function hasComic(id: string): boolean {
  return id in PANELS;
}

/** 畫一格分鏡，回傳貼圖 key（第一次用到才畫） */
export function ensureComicPanel(scene: Phaser.Scene, comic: string, slot: PanelSlot, zone: string): string {
  const key = `comic_${comic}_${slot}_${zone}`;
  if (scene.textures.exists(key)) return key;
  const draw = PANELS[comic]?.[slot] ?? PANELS.floor.s1;
  const l = lookFor(zone);
  canvasTexture(scene, key, W, H, (p) => {
    draw(p, l);
    vignette(p);
  });
  return key;
}
