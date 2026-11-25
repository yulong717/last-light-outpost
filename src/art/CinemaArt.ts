import Phaser from 'phaser';
import { canvasTexture, mix, OUTLINE, tone, type Painter } from './Painter';
import { fig, glow, PAL, type Pal } from './EventArt';

/**
 * 劇情漫畫格的插圖（序章、過場、角色介紹）。
 *
 * 現階段全部是程式畫的占位圖：構圖、明暗、焦點位置先定下來，之後換成本地模型生成的像素插圖。
 * 換圖方式：PNG 預載成同名貼圖 key（例如 'pro_roof'），src/comic/art.ts 會優先用已存在的貼圖。
 *
 * 尺寸規則：插圖會用「整數倍」放大到蓋滿畫格（畫格 400×150 → 插圖 200×75 放大 2 倍），
 * 畫格內的運鏡（推近、平移）會在插圖範圍內移動，所以構圖要留一點邊。
 * 突破格子的物件（pop）用透明底。
 */

interface CinemaDef {
  w: number;
  h: number;
  paint: (p: Painter, w: number, h: number) => void;
}

const STUDENT: Pal = { h: 0x1a1410, s: 0xd8a878, b: 0xe4e2d8, l: 0x2a3048 };
const SUNSET: [number, number, number] = [0x3a2050, 0xc85a3a, 0xf0b060];
const BLOOD = 0x8a1414;

// ── 共用 ─────────────────────────────────────────

function halftone(p: Painter, x: number, y: number, w: number, h: number, c: number, a = 0.2, step = 3): void {
  for (let j = 0; j < h; j += step) for (let i = (j / step) % 2 ? Math.floor(step / 2) : 0; i < w; i += step) p.px(x + i, y + j, c, a);
}

function sunsetSky(p: Painter, w: number, h: number): void {
  p.gradient(0, 0, w, Math.round(h * 0.45), SUNSET[0], SUNSET[1], 5);
  p.gradient(0, Math.round(h * 0.45), w, Math.round(h * 0.3), SUNSET[1], SUNSET[2], 4);
}

function city(p: Painter, w: number, base: number, maxH: number, c: number): void {
  let x = -2;
  while (x < w) {
    const bw = p.rnd.between(6, 16);
    const bh = p.rnd.between(Math.round(maxH * 0.35), maxH);
    p.rect(x, base - bh, bw, bh, c);
    for (let wy = base - bh + 2; wy < base - 2; wy += 3) for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (p.rnd.frac() < 0.07) p.px(wx, wy, 0xf0c060);
    x += bw + p.rnd.between(0, 2);
  }
}

/** 遠方的黑煙 */
function smoke(p: Painter, x: number, y: number, h: number): void {
  for (let i = 0; i < h; i += 2) {
    const r = 2 + Math.floor(i / 5);
    p.circle(x + Math.round(Math.sin(i * 0.3) * 3) + Math.floor(i / 3), y - i, r, 0x1a1418, 0.55);
  }
}

// ── 序章開場 ─────────────────────────────────────

/** 頂樓全景：夕陽、遠方的城市與黑煙、水塔後面睡著的阿凱 */
function proRoof(p: Painter, w: number, h: number): void {
  sunsetSky(p, w, h);
  p.circle(52, 40, 9, 0xffe0a0);
  glow(p, 52, 40, 20, 0xffd080, 0.08);
  city(p, w, 50, 22, mix(SUNSET[0], 0x101018, 0.5));
  smoke(p, 150, 34, 30);
  smoke(p, 30, 40, 18);
  // 頂樓地板
  const fy = 52;
  p.gradient(0, fy, w, h - fy, 0x6a5a58, 0x2a2228, 4);
  for (let x = 0; x < w; x += 18) p.line(x, fy, x - 14, h, 0x3a3034, 0.6);
  // 欄杆
  p.rect(0, fy - 9, w, 2, OUTLINE);
  for (let x = 2; x < 130; x += 6) p.rect(x, fy - 9, 1, 10, OUTLINE);
  // 水塔
  const tx = 138;
  p.box(tx, 12, 44, 30, 0x8a8a90);
  for (let y = 18; y < 40; y += 6) p.rect(tx + 1, y, 42, 1, 0x5a5a62);
  p.rect(tx + 4, 42, 3, 14, OUTLINE);
  p.rect(tx + 36, 42, 3, 14, OUTLINE);
  p.rect(tx, 12, 6, 30, 0xf0a060, 0.35);
  // 水塔的影子裡，睡著的阿凱
  p.rect(tx - 10, fy + 2, 64, 10, 0x000000, 0.35);
  fig(p, tx + 6, fy + 10, 'sit', STUDENT, 2);
  p.rect(tx + 24, fy + 6, 6, 3, 0x2a3a6a); // 書包
  // Z
  p.rect(tx + 18, fy - 12, 4, 1, 0xffffff);
  p.px(tx + 20, fy - 11, 0xffffff);
  p.rect(tx + 19, fy - 10, 4, 1, 0xffffff);
  // 烏鴉
  for (const [x, y] of [[90, 18], [98, 14], [104, 22]]) {
    p.line(x - 2, y - 1, x, y, OUTLINE);
    p.line(x, y, x + 2, y - 1, OUTLINE);
  }
  halftone(p, 0, fy, w, h - fy, 0x000000, 0.18);
}

/** 大特寫：阿凱猛然睜眼，夕陽從左邊打在臉上 */
function proWake(p: Painter, w: number, h: number): void {
  p.gradient(0, 0, w, h, 0xe08048, 0x5a2838, 5);
  halftone(p, 0, 0, w, h, 0xffffff, 0.12);
  const cx = 52;
  const cy = 50;
  // 臉
  p.ellipse(cx, cy + 2, 31, 37, OUTLINE);
  p.ellipse(cx, cy + 2, 30, 36, STUDENT.s);
  // 背光的右半邊
  for (let y = -36; y <= 38; y++) p.rect(cx + 6 + Math.round(Math.abs(y) * 0.1), cy + y, 26, 1, tone(STUDENT.s, -0.35));
  // 頭髮
  p.ellipse(cx, cy - 26, 34, 18, OUTLINE);
  p.ellipse(cx, cy - 27, 33, 16, STUDENT.h);
  for (let i = 0; i < 8; i++) p.rect(cx - 30 + i * 8, cy - 14, 6, 6 + (i % 3) * 3, STUDENT.h);
  p.rect(cx - 33, cy - 32, 10, 3, tone(STUDENT.h, 0.3));
  // 眼睛：瞪大、瞳孔縮小
  for (const ex of [cx - 13, cx + 13]) {
    p.ellipse(ex, cy + 2, 8, 5, OUTLINE);
    p.ellipse(ex, cy + 2, 7, 4, 0xf4f0e8);
    p.rect(ex - 1, cy + 1, 3, 3, OUTLINE);
    p.rect(ex - 9, cy - 8, 16, 2, OUTLINE); // 眉
  }
  // 嘴
  p.rect(cx - 5, cy + 22, 10, 2, OUTLINE);
  // 汗
  p.rect(cx + 28, cy - 12, 3, 5, 0xa8d8ff);
  p.px(cx + 29, cy - 13, 0xa8d8ff);
  p.rect(cx + 34, cy - 2, 2, 4, 0xa8d8ff);
  // 衣領
  p.rect(cx - 30, h - 10, 60, 10, OUTLINE);
  p.rect(cx - 29, h - 9, 58, 9, STUDENT.b);
  p.rect(cx - 4, h - 9, 8, 9, 0x2a3a6a);
  // 驚嚇線
  for (let i = 0; i < 5; i++) p.rect(cx + 40 + i * 3, 6 + (i % 2) * 4, 1, 10, OUTLINE);
}

/** 從欄杆往下看：操場上一群走路不對勁的人，跑道上倒著一個人 */
function proYard(p: Painter, w: number, h: number): void {
  // 操場：跑道＋草地
  p.rect(0, 0, w, h, 0x6a3a2e);
  p.rect(20, 18, w - 40, h - 30, 0x3a5a32);
  for (let k = 0; k < 4; k++) {
    const m = 4 + k * 4;
    p.rect(20 - m, 18 - m, w - 40 + m * 2, 1, 0xd8c8b0, 0.5);
    p.rect(20 - m, h - 12 + m - 1, w - 40 + m * 2, 1, 0xd8c8b0, 0.5);
  }
  p.dither(20, 18, w - 40, h - 30, 0x2e4a28, 0.3);
  // 斜長的影子與人影（俯視角，用小的站姿）
  const zs: [number, number][] = [[44, 40], [60, 52], [78, 36], [96, 58], [110, 44], [70, 66], [52, 64]];
  for (const [x, y] of zs) {
    p.rect(x + 2, y, 10, 2, 0x000000, 0.4);
    fig(p, x - 3, y, 'zShamble', PAL.zombie, 1);
  }
  // 倒在跑道上的人、血跡
  p.rect(120, 74, 9, 3, STUDENT.b);
  p.rect(129, 74, 3, 3, STUDENT.s);
  p.ellipse(124, 78, 8, 2, BLOOD);
  p.line(110, 76, 124, 78, BLOOD, 0.8);
  // 前景：頂樓欄杆（畫面上緣）
  p.rect(0, 0, w, 6, 0x1a1418);
  for (let x = 4; x < w; x += 10) p.rect(x, 0, 2, 12, 0x1a1418);
  // 警報的紅光
  p.rect(0, 0, w, h, 0xc02020, 0.12);
  halftone(p, 0, 0, w, h, 0x000000, 0.22);
}

/** 動作格：一把抓起靠在牆邊的球棒 */
function proGrab(p: Painter, w: number, h: number): void {
  p.rect(0, 0, w, h, 0x3a2a40);
  halftone(p, 0, 0, w, h, 0xffffff, 0.15);
  // 球棒（斜放）
  for (let i = 0; i < 56; i++) {
    const t = i / 56;
    const r = 1 + Math.round(t * 3);
    const x = 8 + i;
    const y = 58 - Math.round(i * 0.85);
    p.circle(x, y, r + 1, OUTLINE);
  }
  for (let i = 0; i < 56; i++) {
    const t = i / 56;
    const r = 1 + Math.round(t * 3);
    p.circle(8 + i, 58 - Math.round(i * 0.85), r, 0xc89a5a);
    p.px(8 + i, 58 - Math.round(i * 0.85) - r + 1, 0xe8c080);
  }
  // 握住的手
  const hx = 22;
  const hy = 44;
  p.ellipse(hx, hy, 9, 7, OUTLINE);
  p.ellipse(hx, hy, 8, 6, STUDENT.s);
  for (let i = 0; i < 4; i++) p.rect(hx - 6 + i * 4, hy - 6, 3, 4, tone(STUDENT.s, -0.2));
  // 袖子
  p.box(hx - 26, hy - 2, 22, 14, STUDENT.b);
  p.rect(hx - 6, hy, 2, 10, tone(STUDENT.b, -0.3));
}

/** 重大事件：樓梯間的門窗被撞破，一張臉擠進來 */
function proDoor(p: Painter, w: number, h: number): void {
  // 牆、門
  p.rect(0, 0, w, h, 0x2a3a34);
  halftone(p, 0, 0, w, h, 0x000000, 0.25);
  const dx = 34;
  p.box(dx, 4, 90, h, 0x5a6a5a);
  p.rect(dx + 8, 54, 10, 4, 0x9a9a8a); // 門把
  // 門上的窗：被撞破
  const wx = dx + 22;
  const wy = 12;
  const ww = 46;
  const wh = 38;
  p.rect(wx - 2, wy - 2, ww + 4, wh + 4, OUTLINE);
  p.rect(wx, wy, ww, wh, 0x0a0c0a);
  // 霧屍的臉
  const cx = wx + ww / 2;
  const cy = wy + wh / 2 + 4;
  p.circle(cx, cy, 17, OUTLINE);
  p.circle(cx, cy, 16, PAL.zombie.s);
  p.rect(cx - 16, cy - 16, 32, 9, PAL.zombie.h);
  for (const ex of [cx - 7, cx + 7]) {
    p.rect(ex - 3, cy - 3, 6, 4, OUTLINE);
    p.rect(ex - 2, cy - 2, 4, 2, 0xe8f070);
  }
  glow(p, cx, cy - 2, 14, 0xe8f070, 0.05);
  p.rect(cx - 8, cy + 5, 16, 8, OUTLINE);
  for (let i = 0; i < 5; i++) p.rect(cx - 7 + i * 3, cy + 5, 2, 3, 0xd8d0b0);
  p.rect(cx - 6, cy + 12, 2, 5, BLOOD);
  // 碎玻璃
  for (let i = 0; i < 26; i++) {
    const a = p.rnd.realInRange(0, Math.PI * 2);
    const r = p.rnd.between(18, 46);
    const gx = cx + Math.cos(a) * r;
    const gy = cy + Math.sin(a) * r * 0.8;
    p.rect(gx, gy, p.rnd.between(1, 3), p.rnd.between(1, 3), 0xd8f0ff, 0.85);
  }
  for (const [x0, y0, x1, y1] of [[wx, wy, cx - 8, cy - 6], [wx + ww, wy, cx + 9, cy - 8], [wx, wy + wh, cx - 10, cy + 8], [wx + ww, wy + wh, cx + 12, cy + 6]]) p.line(x0, y0, x1, y1, 0xd8f0ff, 0.9);
  // 緊急照明：紅
  p.rect(0, 0, w, h, 0xb01818, 0.16);
  glow(p, 140, 8, 24, 0xff3030, 0.06);
  p.box(134, 4, 12, 6, 0xff4040);
}

/** 突破格子的霧屍手（透明底） */
function proHand(p: Painter): void {
  const s = PAL.zombie.s;
  p.rect(0, 9, 22, 12, OUTLINE);
  p.rect(1, 10, 20, 10, PAL.zombie.b);
  p.ellipse(28, 15, 8, 7, OUTLINE);
  p.ellipse(28, 15, 7, 6, s);
  for (let i = 0; i < 4; i++) {
    const fy = 9 + i * 3;
    p.rect(33, fy - 1, 9 + (i === 1 || i === 2 ? 3 : 0), 4, OUTLINE);
    p.rect(34, fy, 8 + (i === 1 || i === 2 ? 3 : 0), 2, s);
    p.px(41 + (i === 1 || i === 2 ? 3 : 0), fy, 0x3a2a20);
  }
  p.rect(24, 4, 4, 6, OUTLINE);
  p.rect(25, 5, 2, 5, s);
  p.rect(10, 19, 2, 6, BLOOD);
}

function missing(p: Painter, w: number, h: number): void {
  p.rect(0, 0, w, h, 0x2a2a30);
  halftone(p, 0, 0, w, h, 0xffffff, 0.15);
  p.rect(w / 2 - 6, h / 2 - 10, 12, 4, 0x8a8a90);
  p.rect(w / 2 + 2, h / 2 - 6, 4, 6, 0x8a8a90);
  p.rect(w / 2 - 2, h / 2, 4, 4, 0x8a8a90);
  p.rect(w / 2 - 2, h / 2 + 7, 4, 3, 0x8a8a90);
}

const ART: Record<string, CinemaDef> = {
  pro_roof: { w: 200, h: 75, paint: proRoof },
  pro_wake: { w: 100, h: 90, paint: proWake },
  pro_yard: { w: 140, h: 85, paint: proYard },
  pro_grab: { w: 75, h: 66, paint: proGrab },
  pro_door: { w: 157, h: 100, paint: proDoor },
  pro_hand: { w: 46, h: 28, paint: proHand },
  missing: { w: 80, h: 45, paint: missing },
};

export function hasCinemaArt(id: string): boolean {
  return id in ART;
}

/** 畫一張劇情插圖，回傳貼圖 key（第一次用到才畫） */
export function ensureCinemaArt(scene: Phaser.Scene, id: string): string {
  const key = `cine_${id}`;
  if (scene.textures.exists(key)) return key;
  const def = ART[id] ?? ART.missing;
  canvasTexture(scene, key, def.w, def.h, (p) => def.paint(p, def.w, def.h));
  return key;
}
