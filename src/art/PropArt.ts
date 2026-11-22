import Phaser from 'phaser';
import { OUTLINE, Painter, frameSheet, tone } from './Painter';

/**
 * 場景道具的像素圖（全部程式畫）。貼圖 key 是 `prop_<id>`，原點放在底部中央（腳底）。
 * 有多個影格的：0 完好／開著燈，1 損壞／熄燈，2 之後見各別說明。
 * 新增道具：在 PROPS 加一筆，場景資料（src/data/scenery.ts）就能用 id 擺放。
 *
 * 比例尺：角色圖 60px 高 = 175cm，所以 1 公尺 ≈ 34px（PX_PER_M）。
 * 每個道具註明真實尺寸，像素大小照這個換算：轎車 4.6m 長 → 156px，油桶 88cm 高 → 30px。
 */

export const PX_PER_M = 34;

/** 路燈燈頭相對腳底的位置（光暈、受擊框用） */
export const LAMP_HEAD = { dx: 15, dy: -190 };

interface PropArt {
  w: number;
  h: number;
  frames?: number;
  draw: (p: Painter, f: number) => void;
}

const WOOD = 0x7a5636;

/** 輪子 */
function wheel(p: Painter, cx: number, cy: number, r: number, burnt: boolean): void {
  p.circle(cx, cy, r, OUTLINE);
  p.circle(cx, cy, r - 1, burnt ? 0x1a1816 : 0x1e1e1e);
  p.circle(cx, cy, Math.round(r * 0.55), burnt ? 0x3a3430 : 0x8a8e94);
  p.circle(cx, cy, Math.max(1, Math.round(r * 0.2)), burnt ? 0x2a2420 : 0x4a4e54);
}

/**
 * 轎車側面（4.6m × 1.45m → 156×50）。body 是車身色；f=1 燒毀。
 */
function car(p: Painter, f: number, body: number, opt: { police?: boolean; taxi?: boolean } = {}): void {
  const w = 156;
  const h = 50;
  const burnt = f === 1;
  const c = burnt ? 0x2c2622 : body;
  const sill = h - 10; // 車身下緣
  const belt = h - 27; // 腰線（車窗下緣）
  // 下半車身：引擎蓋前低後高，後車廂
  p.rect(2, belt - 2, w - 4, sill - belt + 2, OUTLINE);
  p.rect(3, belt - 1, w - 6, sill - belt, c);
  p.rect(1, belt + 3, 2, 12, OUTLINE);
  p.rect(w - 3, belt + 3, 2, 12, OUTLINE);
  p.rect(3, belt - 1, w - 6, 2, tone(c, 0.3));
  p.rect(3, sill - 3, w - 6, 3, tone(c, -0.35));
  p.rect(3, belt + 8, w - 6, 1, tone(c, 0.15));
  // 車廂（梯形）：前擋風斜、後擋風斜
  const r0 = 34;
  const r1 = 118;
  const roof = h - 46;
  for (let y = roof; y < belt - 1; y++) {
    const t = (y - roof) / (belt - 1 - roof);
    const a = Math.round(r0 + 14 * (1 - t));
    const b = Math.round(r1 - 4 - 18 * (1 - t));
    p.rect(a - 1, y, b - a + 2, 1, OUTLINE);
    p.rect(a, y, b - a, 1, y === roof + 1 ? tone(c, 0.35) : tone(c, 0.05));
  }
  // 車窗
  const glass = burnt ? 0x0c0c0c : 0x2c3e4c;
  const pillar = 76;
  for (let y = roof + 3; y < belt - 2; y++) {
    const t = (y - roof - 3) / (belt - 5 - roof);
    const a = Math.round(r0 + 16 * (1 - t)) + 2;
    const b = Math.round(r1 - 6 - 18 * (1 - t)) - 2;
    p.rect(a, y, pillar - a - 1, 1, glass);
    p.rect(pillar + 2, y, b - pillar - 2, 1, glass);
  }
  if (!burnt) {
    p.line(r0 + 14, belt - 4, r0 + 24, roof + 5, tone(glass, 0.35));
    p.line(pillar + 8, belt - 4, pillar + 16, roof + 5, tone(glass, 0.35));
  }
  p.rect(pillar - 1, roof + 2, 3, belt - roof, OUTLINE);
  // 車門縫、門把、後照鏡
  p.rect(pillar, belt, 1, sill - belt - 2, tone(c, -0.4));
  p.rect(r0 + 8, belt, 1, sill - belt - 2, tone(c, -0.4));
  p.rect(r1 - 4, belt, 1, sill - belt - 2, tone(c, -0.4));
  p.rect(pillar - 12, belt + 5, 6, 2, tone(c, 0.45));
  p.rect(pillar + 8, belt + 5, 6, 2, tone(c, 0.45));
  p.rect(r1 - 2, belt - 4, 5, 3, OUTLINE);
  // 車燈、保險桿
  p.rect(w - 6, belt + 2, 4, 6, burnt ? 0x3a2a20 : 0xf2e6a0);
  p.rect(2, belt + 2, 4, 6, burnt ? 0x3a2a20 : 0xb02a20);
  p.rect(w - 10, sill - 4, 9, 4, 0x4a4e54);
  p.rect(1, sill - 4, 9, 4, 0x4a4e54);
  // 車底陰影與輪拱
  p.rect(10, sill, w - 20, 3, 0x0c0c0c);
  for (const wx of [30, w - 30]) {
    p.circle(wx, sill - 1, 13, OUTLINE);
    p.circle(wx, sill - 1, 12, 0x0c0c0c);
    wheel(p, wx, h - 11, 11, burnt);
  }
  if (opt.police && !burnt) {
    p.rect(66, roof - 4, 22, 4, OUTLINE);
    p.rect(67, roof - 3, 10, 3, 0xd03030);
    p.rect(77, roof - 3, 10, 3, 0x3060e0);
    p.rect(3, belt + 10, w - 6, 5, 0xf0f0f0);
    p.rect(84, belt + 4, 24, 2, 0x2a4a9a);
  }
  if (opt.taxi && !burnt) {
    p.rect(68, roof - 5, 18, 5, OUTLINE);
    p.rect(69, roof - 4, 16, 4, 0xf0d040);
    p.rect(3, belt + 12, w - 6, 2, 0x2a2a2a);
  }
  if (burnt) {
    p.dither(4, belt, w - 8, sill - belt, 0x5a3a24, 0.25);
    p.dither(r0, roof, r1 - r0, belt - roof, 0x000000, 0.3);
  }
}

/** 一個沙包（約 60×12cm → 20×7） */
function sandbag(p: Painter, x: number, y: number, w = 22, h = 8): void {
  p.box(x, y, w, h, 0x8d7a54, { light: 0.2 });
  p.rect(x + Math.floor(w / 2), y + 1, 1, h - 2, 0x6a5a3e);
}

export const PROPS: Record<string, PropArt> = {
  // ── 可互動 ──
  /** 200L 紅色油桶（88cm × 58cm → 20×30）：0 完好、1 凹陷漏油 */
  barrel: {
    w: 20,
    h: 30,
    frames: 2,
    draw: (p, f) => {
      const c = 0xa8281e;
      p.box(0, 1, 20, 29, c);
      p.rect(1, 1, 18, 2, tone(c, 0.3));
      p.rect(0, 9, 20, 1, OUTLINE);
      p.rect(0, 20, 20, 1, OUTLINE);
      p.rect(3, 3, 3, 25, tone(c, 0.25));
      p.rect(14, 3, 3, 25, tone(c, -0.3));
      // 易燃標誌
      p.rect(7, 12, 6, 6, 0xf0c030);
      p.line(8, 16, 11, 13, OUTLINE);
      p.rect(13, 0, 4, 1, 0x3a3a3a);
      if (f === 1) {
        p.rect(0, 13, 4, 4, 0x6a1a12);
        p.rect(3, 27, 8, 3, 0x2a2018);
        p.ellipse(8, 29, 7, 1, 0x1a1410, 0.8);
      }
    },
  },
  /** 汽油桶（35cm → 12×12） */
  gascan: {
    w: 13,
    h: 13,
    draw: (p) => {
      p.box(0, 3, 13, 10, 0xc03020);
      p.rect(8, 0, 4, 4, OUTLINE);
      p.rect(9, 1, 2, 2, 0x707070);
      p.rect(1, 1, 6, 3, OUTLINE);
      p.rect(2, 6, 9, 4, tone(0xc03020, -0.25));
    },
  },
  /** 木箱（60cm → 22×20）：0 完好、1 被打爛 */
  crate: {
    w: 22,
    h: 20,
    frames: 2,
    draw: (p, f) => {
      if (f === 1) {
        p.rect(0, 15, 7, 5, WOOD);
        p.rect(8, 16, 10, 4, tone(WOOD, -0.2));
        p.rect(5, 12, 4, 3, tone(WOOD, 0.2));
        p.rect(15, 14, 7, 3, WOOD);
        return;
      }
      p.box(0, 0, 22, 20, WOOD);
      p.rect(1, 6, 20, 1, tone(WOOD, -0.35));
      p.rect(1, 13, 20, 1, tone(WOOD, -0.35));
      p.line(2, 18, 19, 2, tone(WOOD, 0.25));
      p.line(2, 17, 19, 1, tone(WOOD, -0.3));
      for (const [x, y] of [[2, 2], [19, 2], [2, 17], [19, 17]]) p.px(x, y, 0x3a3a3a);
    },
  },
  /** 軍用彈藥箱（70×35cm → 24×13）：0 完好、1 打開 */
  ammobox: {
    w: 24,
    h: 14,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 2, 24, 12, 0x4a5a32);
      p.rect(2, 7, 20, 1, tone(0x4a5a32, -0.3));
      p.rect(4, 9, 9, 3, 0xd8c890);
      p.rect(9, 0, 6, 3, OUTLINE);
      if (f === 1) {
        p.rect(1, 1, 22, 3, 0x1a1a14);
        for (const x of [3, 7, 11, 15]) p.rect(x, 1, 2, 2, 0xd8a840);
      }
    },
  },
  /** 路燈（6m 高 → 200px，燈臂往右伸）：0 亮、1 被打壞 */
  lamppost: {
    w: 52,
    h: 202,
    frames: 2,
    draw: (p, f) => {
      const x = 12;
      p.box(x, 12, 6, 190, 0x3a3f46);
      p.rect(x - 3, 190, 12, 12, 0x2a2e34);
      p.rect(x - 3, 190, 12, 1, 0x4a5058);
      // 彎曲的燈臂
      p.rect(x + 2, 8, 4, 6, 0x3a3f46);
      p.rect(x + 4, 6, 24, 3, 0x3a3f46);
      p.box(x + 20, 4, 18, 6, 0x2a2e34);
      p.rect(x + 22, 9, 14, 3, f === 0 ? 0xfff0b0 : 0x303030);
      if (f === 1) p.px(x + 28, 13, 0x9a9a9a);
      // 貼滿的小廣告
      p.rect(x + 1, 120, 4, 8, 0xd8d0b8);
      p.rect(x + 1, 132, 4, 6, 0xe8e070);
    },
  },
  /** 天花板日光燈（1.2m → 40px，從上往下掛） */
  tubelight: {
    w: 42,
    h: 10,
    frames: 2,
    draw: (p, f) => {
      p.rect(7, 0, 1, 5, 0x2a2a2a);
      p.rect(34, 0, 1, 5, 0x2a2a2a);
      p.box(0, 4, 42, 6, 0x8a8e94);
      p.rect(2, 6, 38, 3, f === 0 ? 0xf6fbff : 0x40444a);
    },
  },
  /** 電箱（50×60cm → 18×22）：0 通電、1 斷電 */
  fusebox: {
    w: 18,
    h: 22,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 18, 22, 0x6a7078);
      p.rect(2, 3, 14, 11, 0x4a5058);
      for (let i = 0; i < 5; i++) p.rect(3 + i * 3, 5, 1, 6, f === 0 ? 0xd0d0d0 : 0x707070);
      p.rect(3, 16, 3, 3, f === 0 ? 0x50e060 : 0x502020);
      p.rect(12, 16, 3, 3, f === 1 ? 0xe04040 : 0x403030);
      p.rect(6, 0, 6, 1, 0xf0c030);
    },
  },
  /** 室內門（90cm × 2.1m → 32×72）：0 關著、1 被撞開、2 用木板封住 */
  door: {
    w: 36,
    h: 74,
    frames: 3,
    draw: (p, f) => {
      p.box(0, 0, 36, 74, 0x3a3430);
      const leaf = 0x6d5a46;
      if (f === 1) {
        p.rect(3, 3, 30, 71, 0x07080a);
        p.rect(3, 3, 7, 71, tone(leaf, -0.15));
        p.rect(4, 4, 5, 69, leaf);
        return;
      }
      p.rect(3, 3, 30, 71, leaf);
      p.rect(6, 7, 24, 24, tone(leaf, -0.15));
      p.rect(6, 37, 24, 32, tone(leaf, -0.15));
      p.rect(9, 10, 18, 14, 0x2a3440);
      p.line(11, 22, 17, 12, 0x3a4a58);
      p.rect(28, 38, 3, 3, 0xd0b060);
      if (f === 2) {
        for (const y of [16, 40]) {
          p.box(-1, y, 38, 7, 0x8d6e4a);
          p.px(2, y + 3, 0xc0c0c0);
          p.px(33, y + 3, 0xc0c0c0);
        }
        p.line(2, 64, 33, 30, 0x5a4030);
        p.line(2, 65, 33, 31, 0x8d6e4a);
        p.line(2, 66, 33, 32, 0x8d6e4a);
      }
    },
  },
  /** 玻璃窗（1.2 × 1.0m → 40×34，嵌在牆上）：0 完好、1 打破 */
  glasswin: {
    w: 42,
    h: 36,
    frames: 2,
    draw: (p, f) => p.window(1, 1, 40, 33, { frame: 0x4a4e56, glass: 0x24323e, broken: f === 1 }),
  },

  // ── 車輛 ──
  car_red: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0x9a2c26) },
  car_blue: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0x2c4c8a) },
  car_white: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0xb8bcc0) },
  car_green: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0x3c5a3a) },
  car_taxi: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0xd8a820, { taxi: true }) },
  policecar: { w: 156, h: 50, frames: 2, draw: (p, f) => car(p, f, 0x22283a, { police: true }) },
  /** 救護車（6m × 2.6m → 204×88） */
  ambulance: {
    w: 204,
    h: 90,
    frames: 2,
    draw: (p, f) => {
      const burnt = f === 1;
      const c = burnt ? 0x2c2622 : 0xe4e4e0;
      // 後車廂
      p.box(1, 6, 150, 70, c);
      // 車頭
      p.box(148, 30, 54, 46, c);
      for (let y = 30; y < 52; y++) p.rect(150, y, Math.round((y - 30) * 0.8), 1, burnt ? 0x0c0c0c : 0x2c3e4c);
      p.rect(170, 34, 22, 18, burnt ? 0x0c0c0c : 0x2c3e4c);
      p.rect(195, 56, 6, 8, burnt ? 0x3a2a20 : 0xf2e6a0);
      p.rect(150, 70, 52, 6, 0x4a4e54);
      // 後門
      p.rect(4, 12, 1, 60, tone(c, -0.3));
      p.rect(140, 12, 1, 60, tone(c, -0.3));
      p.rect(156, 50, 1, 22, tone(c, -0.3));
      if (!burnt) {
        p.rect(3, 50, 197, 6, 0xc82828);
        p.rect(60, 20, 30, 8, 0xc82828);
        p.rect(71, 9, 8, 30, 0xc82828);
        p.rect(40, 0, 50, 6, OUTLINE);
        p.rect(41, 1, 24, 5, 0xe03030);
        p.rect(65, 1, 24, 5, 0x3050e0);
      } else p.dither(4, 10, 196, 60, 0x5a3a24, 0.3);
      p.rect(10, 76, 186, 3, 0x0c0c0c);
      for (const wx of [36, 172]) wheel(p, wx, 77, 13, burnt);
    },
  },
  /** 公車（10.5m × 3.1m → 356×106） */
  bus: {
    w: 356,
    h: 108,
    frames: 2,
    draw: (p, f) => {
      const burnt = f === 1;
      const c = burnt ? 0x2c2622 : 0x3a7a5a;
      p.box(1, 4, 354, 88, c);
      p.rect(2, 5, 352, 3, tone(c, 0.35));
      p.rect(2, 66, 352, 8, tone(c, 0.25));
      p.rect(2, 74, 352, 2, tone(c, -0.3));
      // 側窗
      for (let x = 14; x < 300; x += 42) p.window(x, 16, 38, 34, { glass: 0x1e2a32, broken: burnt || x % 84 === 14 });
      // 前門（摺疊門）
      p.rect(306, 16, 40, 70, OUTLINE);
      p.rect(307, 17, 18, 68, 0x1e2a32);
      p.rect(327, 17, 18, 68, 0x1e2a32);
      p.rect(316, 17, 1, 68, 0x3a4a56);
      p.rect(336, 17, 1, 68, 0x3a4a56);
      // 路線牌
      p.rect(20, 54, 60, 8, burnt ? 0x1a1a1a : 0x1a1a14);
      if (!burnt) for (let i = 0; i < 6; i++) p.rect(24 + i * 9, 56, 6, 4, 0xe8a020);
      p.rect(346, 76, 8, 8, burnt ? 0x3a2a20 : 0xf2e6a0);
      p.rect(10, 92, 336, 4, 0x0c0c0c);
      if (burnt) p.dither(4, 8, 348, 80, 0x5a3a24, 0.3);
      for (const wx of [62, 290]) wheel(p, wx, 93, 15, burnt);
    },
  },
  /** 軍用卡車（7m × 3m → 238×102） */
  truck: {
    w: 238,
    h: 104,
    frames: 2,
    draw: (p, f) => {
      const burnt = f === 1;
      const c = burnt ? 0x2c2622 : 0x4a5232;
      // 帆布車斗
      p.box(1, 4, 160, 80, tone(c, -0.08));
      for (let x = 16; x < 156; x += 22) p.rect(x, 6, 2, 76, tone(c, -0.35));
      p.rect(2, 5, 158, 4, tone(c, 0.18));
      p.box(1, 74, 160, 12, tone(c, -0.2));
      p.rect(20, 40, 26, 18, 0xe8e8e0);
      p.rect(31, 42, 4, 14, c);
      p.rect(24, 47, 18, 4, c);
      // 車頭
      p.box(158, 34, 78, 52, c);
      p.rect(176, 40, 34, 22, burnt ? 0x0c0c0c : 0x24303a);
      p.rect(212, 40, 22, 16, tone(c, -0.15));
      for (let y = 42; y < 56; y += 3) p.rect(214, y, 18, 1, OUTLINE);
      p.rect(160, 80, 76, 4, tone(c, -0.35));
      p.rect(232, 60, 4, 8, burnt ? 0x3a2a20 : 0xf2e6a0);
      p.rect(10, 86, 220, 4, 0x0c0c0c);
      if (burnt) p.dither(4, 8, 228, 76, 0x5a3a24, 0.3);
      for (const wx of [36, 84, 204]) wheel(p, wx, 90, 14, burnt);
    },
  },
  /** 機車（1.8m × 1.1m → 62×38） */
  scooter: {
    w: 62,
    h: 38,
    frames: 2,
    draw: (p, f) => {
      const burnt = f === 1;
      const c = burnt ? 0x2a2420 : p.rnd.pick([0xd8d0c0, 0xc83a2a, 0x3a6ac8, 0x2a2a2a]);
      wheel(p, 12, 29, 8, burnt);
      wheel(p, 50, 29, 8, burnt);
      // 車身與踏板
      p.box(6, 18, 34, 10, c);
      p.box(24, 22, 16, 5, tone(c, -0.2));
      // 坐墊
      p.box(8, 12, 26, 7, 0x2a2a2a);
      // 前叉、龍頭、擋風
      p.box(40, 10, 10, 18, c);
      p.line(48, 28, 52, 8, 0x3a3a3a);
      p.rect(44, 4, 14, 3, 0x3a3a3a);
      p.rect(52, 10, 5, 4, burnt ? 0x3a2a20 : 0xf2e6a0);
      p.rect(2, 16, 5, 4, burnt ? 0x3a2a20 : 0xb02a20);
      // 安全帽掛在後照鏡
      if (!burnt) p.circle(56, 4, 3, 0xe8e8e0);
    },
  },

  // ── 掩體與障礙 ──
  /** 紐澤西護欄（2m × 0.8m → 68×28） */
  jersey: {
    w: 68,
    h: 28,
    draw: (p) => {
      const c = 0x9a968c;
      for (let y = 0; y < 28; y++) {
        const inset = y < 14 ? Math.round((14 - y) * 0.5) + 4 : Math.max(0, 4 - Math.round((y - 14) * 0.6));
        p.rect(inset, y, 68 - inset * 2, 1, OUTLINE);
        p.rect(inset + 1, y, 66 - inset * 2, 1, y < 3 ? tone(c, 0.2) : y > 24 ? tone(c, -0.25) : c);
      }
      for (let x = 4; x < 64; x += 10) p.rect(x, 18, 6, 4, x % 20 === 4 ? 0xd8b030 : 0x2a2a2a);
      p.dither(2, 4, 64, 20, tone(c, -0.15), 0.12);
    },
  },
  /** 沙包牆（80cm 高 → 64×28） */
  sandbags: {
    w: 66,
    h: 30,
    draw: (p) => {
      for (let i = 0; i < 3; i++) sandbag(p, i * 22, 22);
      for (let i = 0; i < 3; i++) sandbag(p, 4 + i * 20, 15, 20);
      for (let i = 0; i < 2; i++) sandbag(p, 12 + i * 21, 8, 21);
      sandbag(p, 22, 1, 22);
    },
  },
  /** 一疊輪胎（直徑 65cm、疊 3 層 → 24×22） */
  tires: {
    w: 24,
    h: 22,
    draw: (p) => {
      for (let i = 0; i < 3; i++) {
        p.box(0, 14 - i * 7, 24, 8, 0x262626, { light: 0.15 });
        p.rect(8, 16 - i * 7, 8, 3, 0x111111);
      }
    },
  },
  /** 大型垃圾子車（1.8 × 1.2m → 62×42） */
  dumpster: {
    w: 62,
    h: 44,
    draw: (p) => {
      const c = 0x2f5a3a;
      p.box(0, 8, 62, 30, c);
      p.rect(0, 3, 62, 6, OUTLINE);
      p.rect(1, 4, 60, 4, tone(c, 0.15));
      for (let x = 8; x < 56; x += 10) p.rect(x, 12, 2, 22, tone(c, -0.3));
      p.rect(4, 0, 12, 4, 0x3a3a3a);
      for (const x of [6, 52]) {
        p.rect(x, 38, 4, 3, OUTLINE);
        p.circle(x + 2, 42, 2, 0x1a1a1a);
      }
      p.rect(42, 0, 8, 4, 0x2a2a2a);
    },
  },
  /** 黑色垃圾袋堆（60cm → 30×20） */
  trashbags: {
    w: 30,
    h: 20,
    draw: (p) => {
      p.ellipse(9, 13, 8, 6, 0x1a1c20);
      p.ellipse(21, 14, 8, 5, 0x22252a);
      p.ellipse(15, 8, 7, 6, 0x2a2d33);
      p.rect(14, 1, 3, 3, 0x2a2d33);
      p.px(12, 5, 0x50545a);
      p.px(6, 9, 0x40444a);
      p.px(22, 10, 0x40444a);
    },
  },
  /** 三角錐（70cm → 12×24） */
  cone: {
    w: 14,
    h: 24,
    draw: (p) => {
      p.rect(0, 21, 14, 3, OUTLINE);
      p.rect(1, 21, 12, 2, 0xc85018);
      for (let y = 1; y < 21; y++) {
        const hw = 1 + Math.round(y * 0.25);
        p.rect(7 - hw, y, hw * 2, 1, y > 7 && y < 12 ? 0xf0f0f0 : 0xe86020);
      }
    },
  },
  /** 加油機（1.8m × 0.6m → 22×62）：0 完好、1 燒毀 */
  pump: {
    w: 26,
    h: 62,
    frames: 2,
    draw: (p, f) => {
      const c = f === 1 ? 0x2a2420 : 0xd8d4c8;
      p.box(2, 10, 22, 52, c);
      p.rect(0, 58, 26, 4, 0x6a6a6a);
      p.rect(5, 14, 16, 12, OUTLINE);
      p.rect(6, 15, 14, 10, f === 1 ? 0x101010 : 0x304a30);
      if (f === 0) for (let i = 0; i < 3; i++) p.rect(7, 16 + i * 3, 8 - i * 2, 1, 0x80ff80);
      p.rect(3, 0, 20, 10, 0xc83020);
      p.rect(3, 4, 20, 2, 0xf0f0f0);
      // 油槍與油管
      p.rect(22, 30, 3, 16, OUTLINE);
      p.rect(19, 30, 4, 4, 0x2a2a2a);
      p.line(24, 46, 22, 56, 0x1a1a1a);
      p.rect(5, 30, 12, 3, 0xc83020);
      p.rect(5, 36, 12, 1, tone(c, -0.3));
    },
  },
  /** 收銀台（1.6m × 0.9m → 56×32） */
  counter: {
    w: 56,
    h: 40,
    draw: (p) => {
      const c = 0x6a6e72;
      p.box(0, 10, 56, 30, c);
      p.rect(0, 8, 56, 3, OUTLINE);
      p.rect(1, 9, 54, 1, 0x9aa0a6);
      p.rect(4, 16, 48, 1, tone(c, -0.3));
      // 收銀機
      p.box(34, 0, 16, 9, 0x2a2a2e);
      p.rect(37, 2, 10, 3, 0x50e060);
      p.rect(8, 4, 12, 5, 0xc8a070);
    },
  },
  /** 辦公桌＋螢幕（1.4m 長、75cm 高 → 48×40） */
  desk: {
    w: 50,
    h: 42,
    draw: (p) => {
      p.box(0, 16, 50, 6, 0x6a4a30);
      p.rect(2, 22, 4, 20, 0x3a2a1c);
      p.box(32, 21, 16, 21, 0x5a3e28);
      p.rect(35, 26, 10, 1, 0x2a1a10);
      p.rect(35, 33, 10, 1, 0x2a1a10);
      p.box(8, 0, 20, 15, 0x2a2a2e);
      p.rect(10, 2, 16, 10, 0x1c2a3a);
      p.rect(16, 15, 4, 2, OUTLINE);
      p.rect(30, 13, 12, 3, 0xd8d8d0);
    },
  },
  /** 檔案櫃（50cm × 1.3m → 18×44） */
  filecab: {
    w: 18,
    h: 44,
    draw: (p) => {
      const c = 0x6a727a;
      p.box(0, 0, 18, 44, c);
      for (let y = 3; y < 42; y += 10) {
        p.rect(2, y, 14, 9, tone(c, -0.12));
        p.rect(7, y + 3, 4, 1, 0xc0c0c0);
        p.rect(5, y + 6, 8, 1, 0xd8d0b8);
      }
    },
  },
  /** 鐵製置物櫃（雙門 60cm × 1.8m → 22×62）：0 關著、1 打開 */
  locker: {
    w: 22,
    h: 62,
    frames: 2,
    draw: (p, f) => {
      const c = 0x4a5a6a;
      p.box(0, 0, 22, 62, c);
      p.rect(11, 1, 1, 60, OUTLINE);
      for (const x of [3, 14]) for (let y = 5; y < 15; y += 2) p.rect(x, y, 5, 1, 0x26303a);
      p.rect(8, 30, 1, 5, 0xc0c0c0);
      p.rect(14, 30, 1, 5, 0xc0c0c0);
      if (f === 1) {
        p.rect(12, 1, 9, 60, 0x0c0e10);
        p.rect(13, 14, 7, 1, 0x5a5a5a);
        p.rect(14, 16, 5, 14, 0x3a4a6a);
      }
    },
  },
  /** 槍械櫃（80cm × 1.8m → 28×62）：0 鎖著、1 撬開 */
  gunlocker: {
    w: 30,
    h: 62,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 30, 62, 0x3a4048);
      p.rect(2, 3, 26, 56, 0x14181c);
      for (let i = 0; i < 4; i++) {
        p.rect(4 + i * 6, 8, 2, 40, 0x2a2a2a);
        p.rect(4 + i * 6, 38, 3, 12, 0x5a3e28);
        p.rect(3 + i * 6, 14, 4, 3, 0x1a1a1a);
      }
      for (let y = 3; y < 59; y += 5) p.rect(2, y, 26, 1, f === 1 ? 0x14181c : 0x5a6068);
      if (f === 0) {
        p.rect(12, 30, 6, 6, 0xd0a030);
        p.rect(13, 27, 4, 3, 0x9a9a9a);
      } else p.rect(25, 3, 5, 56, 0x3a4048);
    },
  },
  /** 超市貨架（1.2m 寬 × 1.8m 高 → 42×62） */
  shelf: {
    w: 44,
    h: 64,
    draw: (p) => {
      p.box(0, 0, 44, 64, 0x8a8e94);
      const colors = [0xc83a2a, 0x2a7ac8, 0xe8c040, 0x3aa050, 0xe8e0d0, 0x9a4ac0, 0xe07a30];
      for (let row = 0; row < 5; row++) {
        const y = 3 + row * 12;
        p.rect(2, y + 9, 40, 2, 0x5a5e64);
        for (let x = 3; x < 41; ) {
          const w = 3 + Math.floor(p.rnd.frac() * 3);
          const h = 4 + Math.floor(p.rnd.frac() * 5);
          if (p.rnd.frac() < 0.3) {
            x += w;
            continue;
          }
          const c = colors[Math.floor(p.rnd.frac() * colors.length)];
          p.rect(x, y + 9 - h, Math.min(w, 41 - x), h, c);
          p.rect(x, y + 9 - h, 1, h, tone(c, 0.25));
          x += w + 1;
        }
      }
    },
  },
  /** 倒在地上的貨架（1.8m → 62×22） */
  shelf_low: {
    w: 62,
    h: 22,
    draw: (p) => {
      p.box(0, 8, 62, 14, 0x7a7e84);
      for (let x = 4; x < 60; x += 12) p.rect(x, 9, 1, 12, 0x4a4e54);
      for (const [x, w, c] of [[4, 6, 0xc83a2a], [14, 5, 0xe8c040], [30, 7, 0x2a7ac8], [44, 4, 0x3aa050], [52, 6, 0xe8e0d0]] as const) {
        p.rect(x, 8 - w, w, w, c);
      }
    },
  },
  /** 購物車（1m × 1m → 34×34） */
  cart: {
    w: 36,
    h: 34,
    draw: (p) => {
      const m = 0x9aa0a6;
      // 籃子（前窄後寬）
      p.rect(6, 6, 28, 1, m);
      p.rect(9, 20, 23, 1, m);
      p.line(6, 6, 9, 20, m);
      p.line(33, 6, 31, 20, m);
      for (let x = 9; x < 33; x += 3) p.line(x, 7, x + 1, 19, 0x6a7076, 0.8);
      for (let y = 10; y < 20; y += 3) p.rect(8, y, 24, 1, 0x6a7076, 0.8);
      // 把手
      p.line(33, 6, 35, 2, m);
      p.rect(33, 1, 3, 2, 0xc83a2a);
      // 底架與輪子
      p.line(10, 21, 8, 28, m);
      p.line(30, 21, 32, 28, m);
      p.rect(6, 28, 28, 1, m);
      p.circle(8, 31, 2, OUTLINE);
      p.circle(32, 31, 2, OUTLINE);
    },
  },
  /** 冷藏櫃（80cm × 2m → 28×68） */
  fridge: {
    w: 30,
    h: 68,
    draw: (p) => {
      p.box(0, 0, 30, 68, 0xd8dce0);
      p.rect(3, 6, 24, 54, 0x9ad0e0);
      for (let y = 8; y < 58; y += 10) {
        p.rect(3, y + 8, 24, 1, 0x6a8a9a);
        for (let x = 4; x < 26; x += 3) p.rect(x, y + 1, 2, 7, [0xc83a2a, 0x3aa050, 0xe8c040, 0x2a7ac8][(x + y) % 4]);
      }
      p.rect(3, 6, 2, 54, 0xe0f4ff);
      p.rect(2, 1, 26, 4, 0x2a7ac8);
      p.rect(24, 30, 2, 8, 0x5a5e64);
    },
  },
  /** 病床（2m × 0.9m → 68×30） */
  bed: {
    w: 68,
    h: 32,
    draw: (p) => {
      p.box(0, 12, 68, 7, 0xd8dce0);
      p.rect(1, 9, 66, 4, 0xa8c8d8);
      p.box(3, 5, 16, 6, 0xf0f0f0);
      p.rect(0, 0, 3, 32, 0x9aa0a6);
      p.rect(65, 6, 3, 26, 0x9aa0a6);
      p.rect(22, 8, 30, 1, 0x9aa0a6);
      p.rect(30, 10, 10, 3, 0x8a2a22);
      p.rect(8, 19, 2, 10, 0x7a8086);
      p.rect(58, 19, 2, 10, 0x7a8086);
      p.circle(9, 30, 2, OUTLINE);
      p.circle(59, 30, 2, OUTLINE);
    },
  },
  /** 點滴架（1.8m → 14×62） */
  ivstand: {
    w: 16,
    h: 62,
    draw: (p) => {
      p.rect(7, 2, 2, 56, 0x9aa0a6);
      p.rect(1, 2, 14, 1, 0x9aa0a6);
      p.box(9, 4, 6, 11, 0xd0e8f0, { outline: 0x6a8090 });
      p.rect(11, 15, 1, 18, 0xb0c0c8);
      p.rect(1, 58, 14, 1, 0x6a7076);
      p.circle(2, 60, 1, OUTLINE);
      p.circle(14, 60, 1, OUTLINE);
    },
  },
  /** 輪椅（90cm → 30×32） */
  wheelchair: {
    w: 30,
    h: 32,
    draw: (p) => {
      p.circle(11, 21, 10, OUTLINE);
      p.circle(11, 21, 9, 0x6a7076);
      p.circle(11, 21, 7, 0x14161a);
      p.circle(11, 21, 2, 0x9aa0a6);
      p.box(6, 12, 16, 4, 0x2a3a5a);
      p.box(4, 2, 4, 12, 0x2a3a5a);
      p.rect(2, 0, 3, 3, 0x9aa0a6);
      p.rect(20, 14, 2, 12, 0x9aa0a6);
      p.rect(20, 25, 8, 2, 0x9aa0a6);
      p.circle(26, 29, 2, OUTLINE);
    },
  },
  /** 長椅（1.5m、椅背 80cm → 52×28） */
  bench: {
    w: 52,
    h: 28,
    draw: (p) => {
      p.box(0, 0, 52, 5, 0x6a4a30);
      p.box(0, 7, 52, 5, 0x6a4a30);
      p.box(0, 13, 52, 5, 0x7a5636);
      for (const x of [4, 44]) {
        p.rect(x, 0, 4, 28, 0x2a2a2a);
      }
    },
  },
  /** 盆栽（80cm → 20×28） */
  plant: {
    w: 20,
    h: 28,
    draw: (p) => {
      p.box(5, 18, 10, 10, 0x8a4a2a);
      p.rect(5, 18, 10, 2, 0x6a3a1e);
      for (let i = 0; i < 22; i++) {
        const x = 2 + Math.floor(p.rnd.frac() * 15);
        const y = 1 + Math.floor(p.rnd.frac() * 16);
        p.rect(x, y, 3, 2, p.rnd.frac() < 0.5 ? 0x2a5a2a : 0x3a7a3a);
      }
      p.rect(9, 8, 1, 10, 0x3a4a2a);
    },
  },
  /** 沙發（2m × 0.85m → 68×30） */
  sofa: {
    w: 68,
    h: 30,
    draw: (p) => {
      const c = 0x7a4444;
      p.box(4, 0, 60, 16, tone(c, -0.1));
      p.box(0, 14, 68, 13, c);
      p.box(0, 8, 10, 19, tone(c, -0.1));
      p.box(58, 8, 10, 19, tone(c, -0.1));
      p.rect(34, 15, 1, 10, tone(c, -0.35));
      p.rect(4, 27, 3, 3, OUTLINE);
      p.rect(61, 27, 3, 3, OUTLINE);
      p.rect(20, 4, 5, 3, 0x3a1a1a);
      p.box(46, 4, 10, 10, 0xd8c890);
    },
  },
  /** 衣櫃（1m × 1.9m → 34×64）：0 關著、1 門打開 */
  wardrobe: {
    w: 36,
    h: 66,
    frames: 2,
    draw: (p, f) => {
      const c = 0x5a3e28;
      p.box(0, 0, 36, 66, c);
      p.rect(0, 0, 36, 4, tone(c, -0.3));
      p.rect(18, 4, 1, 60, OUTLINE);
      p.rect(14, 30, 1, 6, 0xd0b060);
      p.rect(22, 30, 1, 6, 0xd0b060);
      p.rect(3, 8, 12, 50, tone(c, 0.08));
      p.rect(21, 8, 12, 50, tone(c, 0.08));
      if (f === 1) {
        p.rect(19, 4, 16, 60, 0x0a0a0c);
        p.rect(21, 10, 12, 1, 0x5a5a5a);
        p.rect(22, 11, 4, 18, 0x3a4a6a);
        p.rect(27, 11, 4, 14, 0x8a3a3a);
      }
    },
  },
  /** 神明桌（高 1.6m 含神龕 → 50×56），紅色神明燈 */
  shrine: {
    w: 52,
    h: 56,
    draw: (p) => {
      const red = 0x7a2a1a;
      p.box(0, 26, 52, 5, red);
      p.box(3, 31, 46, 25, 0x5a1e12);
      p.rect(8, 36, 36, 1, 0xd0a030);
      p.rect(8, 46, 36, 1, 0xd0a030);
      p.box(14, 4, 24, 23, 0x5a1e12);
      p.rect(17, 7, 18, 18, 0xd0a030);
      p.rect(19, 9, 14, 14, 0x9a2a1a);
      p.circle(26, 15, 3, 0xd0a030);
      for (const x of [4, 44]) {
        p.rect(x, 12, 4, 14, 0xe03020);
        p.rect(x + 1, 14, 2, 4, 0xff8060);
      }
      p.rect(24, 22, 4, 4, 0x8a6a30);
      p.rect(25, 19, 1, 4, 0xc0b090);
    },
  },
  /** 電視櫃（1m 高 → 30×34） */
  tv: {
    w: 34,
    h: 36,
    draw: (p) => {
      p.box(2, 0, 30, 20, 0x2a2a2e);
      p.rect(4, 2, 26, 15, 0x14181c);
      p.line(6, 14, 14, 5, 0x2a3440);
      p.box(0, 20, 34, 16, 0x5a3e28);
      p.rect(3, 26, 28, 1, 0x3a2a1c);
    },
  },
  /** 紙箱堆（1m → 34×34） */
  boxes: {
    w: 40,
    h: 36,
    draw: (p) => {
      const b = (x: number, y: number, w: number, h: number) => {
        p.box(x, y, w, h, 0xa8804a);
        p.rect(x + Math.floor(w / 2) - 1, y + 1, 3, h - 2, 0xd8c890);
      };
      b(0, 18, 20, 18);
      b(19, 20, 21, 16);
      b(8, 2, 18, 17);
    },
  },
  /** 棧板＋整箱物資（1.2m → 42×42） */
  pallet: {
    w: 42,
    h: 44,
    draw: (p) => {
      p.box(0, 38, 42, 6, 0x9a7a4a);
      for (const x of [4, 19, 34]) p.rect(x, 40, 4, 4, 0x2a2018);
      const c = 0x4a5a32;
      p.box(2, 4, 38, 35, c);
      for (let y = 10; y < 38; y += 8) p.rect(3, y, 36, 1, tone(c, -0.3));
      p.rect(2, 3, 38, 3, 0x2a2a2a);
      p.rect(10, 16, 22, 8, 0xd8c890);
      p.rect(12, 18, 18, 1, 0x3a3a3a);
    },
  },
  /** 堆高機（2.8m 長、2.1m 高 → 96×72） */
  forklift: {
    w: 96,
    h: 74,
    draw: (p) => {
      const y = 0xd8a020;
      // 車身
      p.box(30, 34, 62, 26, y);
      p.box(70, 22, 22, 14, tone(y, -0.1));
      // 護頂架
      p.rect(34, 2, 3, 34, 0x2a2a2a);
      p.rect(80, 2, 3, 22, 0x2a2a2a);
      p.rect(34, 0, 50, 3, 0x2a2a2a);
      // 座椅與方向盤
      p.box(56, 22, 12, 12, 0x2a2a2a);
      p.line(42, 34, 46, 22, 0x2a2a2a);
      // 門架與貨叉
      p.rect(18, 0, 4, 66, 0x3a3a3a);
      p.rect(24, 0, 4, 66, 0x3a3a3a);
      p.rect(2, 64, 26, 3, 0x5a5a5a);
      p.rect(2, 50, 26, 3, 0x5a5a5a);
      for (const wx of [42, 80]) wheel(p, wx, 62, 11, false);
    },
  },
  /** 軍用帳篷（4m × 2.2m → 136×76） */
  tent: {
    w: 136,
    h: 78,
    draw: (p) => {
      const c = 0x5a6a3a;
      for (let j = 0; j < 72; j++) {
        const hw = Math.floor(14 + j * 0.75);
        p.rect(68 - hw, 6 + j, hw * 2, 1, j % 12 === 0 ? tone(c, -0.15) : c);
      }
      p.line(68, 5, 14, 77, OUTLINE);
      p.line(68, 5, 122, 77, OUTLINE);
      p.rect(54, 6, 28, 2, tone(c, 0.2));
      // 門簾捲起
      p.rect(52, 34, 32, 44, 0x1a1e12);
      p.box(50, 30, 36, 6, tone(c, 0.1));
      p.rect(66, 0, 4, 7, 0x3a3a3a);
      // 營繩
      p.line(14, 77, 2, 77, 0xb8b0a0);
    },
  },
  /** 營火（50cm → 20×16） */
  campfire: {
    w: 22,
    h: 18,
    draw: (p) => {
      p.rect(1, 14, 20, 4, 0x3a2a1a);
      for (const x of [2, 18]) p.circle(x, 15, 2, 0x5a5a5a);
      p.line(3, 15, 18, 11, 0x5a3e28);
      p.line(3, 11, 18, 15, 0x5a3e28);
      p.ellipse(11, 8, 5, 7, 0xe86020);
      p.ellipse(11, 10, 3, 4, 0xf8d060);
      p.px(11, 1, 0xe86020);
    },
  },
  /** 蓋著防水布的物資（1.5m × 0.8m → 52×28） */
  tarp: {
    w: 54,
    h: 30,
    draw: (p) => {
      for (let j = 0; j < 27; j++) {
        const hw = Math.min(26, 10 + j * 2);
        p.rect(27 - hw, 2 + j, hw * 2, 1, j % 6 === 0 ? 0x2a4a6a : 0x34587a);
      }
      p.line(4, 28, 18, 5, 0x2a4a6a);
      p.line(34, 4, 48, 28, 0x2a4a6a);
      p.rect(0, 28, 54, 2, OUTLINE);
      p.box(40, 20, 10, 8, 0x4a5a32);
    },
  },
  /** 絆線＋生鏽手榴彈（走廊寬 1.8m → 62px） */
  tripwire: {
    w: 62,
    h: 10,
    draw: (p) => {
      p.rect(0, 2, 2, 8, 0x5a5a5a);
      p.rect(60, 2, 2, 8, 0x5a5a5a);
      p.line(2, 5, 59, 5, 0xc0c0b0, 0.8);
      p.ellipse(55, 7, 3, 3, 0x4a5a2a);
      p.rect(55, 3, 2, 2, 0x8a8a7a);
    },
  },
  /** 樓板塌陷的破洞（2m → 70×18） */
  hole: {
    w: 76,
    h: 18,
    draw: (p) => {
      p.ellipse(38, 9, 36, 8, 0x05060a);
      p.ellipse(38, 8, 32, 6, 0x000000);
      p.rect(8, 6, 60, 3, 0x6d4c33);
      p.rect(14, 11, 46, 2, 0x5a3e28);
      p.rect(2, 4, 8, 3, 0x4a3a2a);
    },
  },
  /** 拘留室鐵欄（2.4m 高 → 60×82） */
  cellbars: {
    w: 60,
    h: 82,
    draw: (p) => {
      p.rect(0, 0, 60, 82, 0x14161a);
      p.box(6, 56, 26, 8, 0x4a4a4a);
      for (let x = 1; x < 60; x += 6) p.rect(x, 0, 2, 82, 0x5a6068);
      p.rect(0, 0, 60, 4, 0x3a4048);
      p.rect(0, 40, 60, 3, 0x3a4048);
      p.rect(0, 78, 60, 4, 0x3a4048);
    },
  },
  /** 瞭望塔（6m → 50×204） */
  watchtower: {
    w: 56,
    h: 204,
    draw: (p) => {
      p.rect(8, 60, 4, 144, 0x4a3e2e);
      p.rect(44, 60, 4, 144, 0x4a3e2e);
      for (let y = 70; y < 200; y += 36) {
        p.line(10, y, 46, y + 32, 0x3a2e22);
        p.line(46, y, 10, y + 32, 0x3a2e22);
      }
      p.box(0, 30, 56, 32, 0x5a6a3a);
      p.rect(3, 34, 50, 10, 0x14181c);
      for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) p.box(2 + i * 13 + r * 6, 50 - r * 6, 14, 7, 0x8d7a54);
      p.rect(0, 20, 56, 4, OUTLINE);
      p.rect(2, 23, 2, 8, 0x3a3a3a);
      p.rect(52, 23, 2, 8, 0x3a3a3a);
      p.box(34, 10, 14, 10, 0x3a3f46);
      p.rect(37, 13, 8, 4, 0xfff0b0);
    },
  },
  /** 消防栓（75cm → 16×26） */
  hydrant: {
    w: 16,
    h: 26,
    draw: (p) => {
      p.box(3, 5, 10, 19, 0xc83020);
      p.rect(0, 10, 16, 5, 0xc83020);
      p.rect(0, 10, 16, 1, OUTLINE);
      p.box(4, 0, 8, 6, 0xa82418);
      p.rect(1, 23, 14, 3, 0x6a1a12);
    },
  },
  /** 用家具堵住的門（2.2m → 66×78） */
  barricadedoor: {
    w: 70,
    h: 80,
    draw: (p) => {
      p.box(12, 0, 46, 80, 0x3a3430);
      p.rect(15, 3, 40, 77, 0x5a4a3a);
      // 沙發、櫃子、床墊堆在門口
      p.box(2, 44, 60, 20, 0x6a4a30);
      p.box(0, 58, 32, 22, 0x5a3e28);
      p.box(36, 30, 30, 50, 0x4a3424);
      p.rect(40, 36, 22, 1, 0x2a1a10);
      p.rect(40, 50, 22, 1, 0x2a1a10);
      p.line(14, 10, 58, 36, 0x8d6e4a);
      p.line(14, 11, 58, 37, 0x5a4030);
      p.line(14, 12, 58, 38, 0x8d6e4a);
    },
  },
  /** 半開的鐵捲門（3m 寬 × 2.5m → 102×86，牆上） */
  shutter: {
    w: 104,
    h: 88,
    draw: (p) => {
      p.box(0, 0, 104, 88, 0x3a3f46);
      p.rect(0, 0, 104, 10, 0x2a2e34);
      p.rect(4, 10, 96, 78, 0x07080a);
      for (let y = 10; y < 50; y += 4) p.rect(4, y, 96, 3, y % 8 === 2 ? 0x7a8088 : 0x6a7078);
      p.rect(4, 50, 96, 3, 0x4a5058);
      p.box(12, 66, 22, 22, 0xa8804a);
      p.box(38, 70, 24, 18, 0x4a5a32);
      p.box(70, 62, 20, 26, 0xa8804a);
    },
  },
  /** 碎石瓦礫（1m → 34×12） */
  debris: {
    w: 36,
    h: 12,
    draw: (p) => {
      p.rect(2, 7, 12, 5, 0x5a5650);
      p.rect(12, 4, 10, 8, 0x6a665e);
      p.rect(22, 8, 12, 4, 0x4a4640);
      p.line(4, 6, 18, 1, 0x7a3e22);
      p.rect(26, 5, 4, 3, 0x8a867e);
    },
  },
  /** 路邊廣告看板（立在 4m 高的柱子上 → 120×170） */
  billboard: {
    w: 120,
    h: 170,
    draw: (p) => {
      p.rect(28, 60, 5, 110, 0x3a3f46);
      p.rect(87, 60, 5, 110, 0x3a3f46);
      p.box(0, 0, 120, 62, 0x2a3036);
      p.rect(3, 3, 114, 56, 0xd8c8a0);
      p.rect(3, 3, 114, 18, 0xc83a2a);
      p.rect(10, 28, 54, 5, 0x2a2a2a);
      p.rect(10, 38, 36, 3, 0x5a5a5a);
      p.circle(92, 40, 12, 0x3a7ac8);
      p.dither(3, 3, 114, 56, 0x2a2420, 0.18);
    },
  },
  /** 籃球架（籃框 3.05m、籃板頂 3.9m → 60×134） */
  hoop: {
    w: 60,
    h: 134,
    draw: (p) => {
      p.box(2, 20, 6, 114, 0x3a6a9a);
      p.rect(0, 126, 14, 8, 0x2a2a2a);
      p.rect(6, 24, 22, 4, 0x3a6a9a);
      p.box(24, 0, 34, 30, 0xe8e8e0);
      p.rect(34, 12, 14, 12, OUTLINE);
      p.rect(35, 13, 12, 10, 0xe8e8e0);
      p.rect(32, 28, 18, 2, 0xe86020);
      for (let x = 33; x < 50; x += 3) p.line(x, 30, x + 1, 40, 0xd0d0d0);
    },
  },
  /** 旗桿（6m → 40×204） */
  flagpole: {
    w: 40,
    h: 204,
    draw: (p) => {
      p.rect(3, 0, 3, 204, 0x9aa0a6);
      p.rect(0, 196, 10, 8, 0x5a5a5a);
      p.rect(6, 6, 32, 22, 0x8a2a22);
      p.dither(6, 6, 32, 22, 0x3a1a12, 0.3);
      p.rect(28, 20, 10, 8, 0x14161a);
    },
  },
  /** 布告欄（1.2 × 0.9m → 42×32，牆上） */
  noticeboard: {
    w: 42,
    h: 32,
    draw: (p) => {
      p.box(0, 0, 42, 32, 0x7a5636);
      p.rect(2, 2, 38, 28, 0xa88a5a);
      for (const [x, y, c] of [[4, 4, 0xe8e0d0], [16, 3, 0xe8e0d0], [28, 5, 0xf0e070], [6, 17, 0xe8e0d0], [20, 16, 0xd8c8a0]] as const) {
        p.rect(x, y, 10, 11, c);
        p.rect(x + 3, y + 2, 4, 4, 0x5a5a5a);
        p.px(x + 5, y, 0xc83020);
      }
    },
  },
  /** 軍用無線電（40cm → 16×18） */
  radio: {
    w: 18,
    h: 24,
    draw: (p) => {
      p.box(0, 10, 18, 14, 0x4a5232);
      p.rect(2, 13, 8, 6, 0x1a1e12);
      p.rect(3, 15, 3, 1, 0x80ff80);
      p.circle(13, 16, 2, OUTLINE);
      p.rect(15, 0, 1, 11, 0x2a2a2a);
    },
  },
  /** 牆上的紅十字標誌（60cm → 22） */
  redcross: {
    w: 22,
    h: 22,
    draw: (p) => {
      p.box(0, 0, 22, 22, 0xe8e8e0);
      p.rect(8, 3, 6, 16, 0xc82828);
      p.rect(3, 8, 16, 6, 0xc82828);
    },
  },
  /** 傷者（靠牆坐著、腿伸直，約 1m 高 → 46×36） */
  wounded: {
    w: 46,
    h: 36,
    draw: (p) => {
      // 頭
      p.box(4, 0, 11, 12, 0xc89a78);
      p.rect(4, 0, 11, 4, 0x2a2018);
      p.rect(7, 6, 2, 1, OUTLINE);
      // 上身靠牆
      p.box(1, 11, 18, 17, 0x5a6a8a);
      p.rect(15, 16, 6, 4, 0xc89a78);
      // 伸直的腿
      p.box(14, 26, 30, 8, 0x3a4a5a);
      p.box(40, 22, 6, 12, 0x2a2a2a);
      // 綁著止血帶的傷口
      p.rect(26, 26, 7, 6, 0x8a1a12);
      p.rect(25, 25, 2, 8, 0xd8d0c0);
      p.ellipse(30, 35, 12, 1, 0x5a0a08, 0.7);
    },
  },
  /** 戴防毒面具的拾荒者（175cm → 30×60，大背包） */
  trader: {
    w: 34,
    h: 60,
    draw: (p) => {
      // 背包
      p.box(0, 14, 13, 28, 0x6a5a3a);
      p.rect(1, 8, 10, 7, 0x5a4a30);
      p.rect(3, 4, 6, 4, 0x3a6ac8);
      // 身體
      p.box(8, 16, 18, 26, 0x4a4434);
      p.rect(9, 28, 16, 2, 0x2a2a1a);
      // 頭與防毒面具
      p.box(11, 2, 13, 15, 0x3a3a3a);
      p.circle(15, 9, 2, 0x8a9a8a);
      p.circle(20, 9, 2, 0x8a9a8a);
      p.box(15, 12, 6, 5, 0x2a2a2a);
      // 舉起的雙手
      p.rect(25, 4, 4, 16, 0x4a4434);
      p.rect(25, 1, 4, 4, 0x8a7a5a);
      p.rect(4, 4, 4, 14, 0x4a4434);
      p.rect(4, 1, 4, 4, 0x8a7a5a);
      // 腿
      p.box(9, 42, 7, 18, 0x2a2a2a);
      p.box(18, 42, 7, 18, 0x2a2a2a);
    },
  },
  /** 屍體（1.7m 長 → 58×12） */
  corpse: {
    w: 60,
    h: 12,
    draw: (p) => {
      p.ellipse(30, 10, 28, 2, 0x3a0a08, 0.8);
      p.box(12, 3, 28, 7, 0x4a4a3a);
      p.box(40, 2, 9, 8, 0x8a9070);
      p.box(0, 5, 14, 5, 0x3a3a4a);
      p.rect(22, 0, 4, 4, 0x8a9070);
    },
  },
};

/** 道具貼圖 key */
export function propKey(id: string): string {
  return `prop_${id}`;
}

export function createPropTextures(scene: Phaser.Scene): void {
  for (const [id, art] of Object.entries(PROPS)) {
    frameSheet(scene, propKey(id), art.w, art.h, art.frames ?? 1, art.draw);
  }
}

export function propSize(id: string): { w: number; h: number } {
  const a = PROPS[id];
  return a ? { w: a.w, h: a.h } : { w: 16, h: 16 };
}
