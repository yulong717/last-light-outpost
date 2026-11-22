import Phaser from 'phaser';
import { OUTLINE, Painter, frameSheet, tone } from './Painter';

/**
 * 場景道具的像素圖（全部程式畫）。貼圖 key 是 `prop_<id>`，原點放在底部中央（腳底）。
 * 有多個影格的：0 完好／開著燈，1 損壞／熄燈，2 之後見各別說明。
 * 新增道具：在 PROPS 加一筆，場景資料（src/data/scenery.ts）就能用 id 擺放。
 */

interface PropArt {
  w: number;
  h: number;
  frames?: number;
  draw: (p: Painter, f: number) => void;
}

const WOOD = 0x7a5636;

/** 一輛轎車（側面），body 是車身色；f=1 燒毀 */
function car(p: Painter, f: number, body: number, w = 64, h = 28, opt: { police?: boolean; taxi?: boolean } = {}): void {
  const burnt = f === 1;
  const c = burnt ? 0x2c2622 : body;
  // 車身下半
  p.box(1, h - 15, w - 2, 10, c);
  // 車頂與車窗
  p.rect(13, h - 25, w - 30, 1, OUTLINE);
  p.rect(10, h - 24, w - 24, 10, OUTLINE);
  p.rect(11, h - 24, w - 26, 9, tone(c, 0.05));
  const glass = burnt ? 0x0c0c0c : 0x2c3e4c;
  p.rect(14, h - 22, 15, 7, glass);
  p.rect(31, h - 22, w - 48, 7, glass);
  if (!burnt) {
    p.line(15, h - 16, 20, h - 21, tone(glass, 0.35));
    p.line(33, h - 16, 37, h - 20, tone(glass, 0.35));
  }
  p.rect(30, h - 23, 1, 9, OUTLINE);
  // 車門線、門把、車燈
  p.rect(30, h - 14, 1, 8, tone(c, -0.35));
  p.rect(25, h - 12, 3, 1, tone(c, 0.4));
  p.rect(36, h - 12, 3, 1, tone(c, 0.4));
  p.rect(w - 4, h - 13, 2, 3, burnt ? 0x3a2a20 : 0xf2e6a0);
  p.rect(2, h - 13, 2, 3, burnt ? 0x3a2a20 : 0xb02a20);
  p.rect(2, h - 7, w - 4, 1, tone(c, -0.45));
  // 輪胎
  for (const wx of [13, w - 14]) {
    p.circle(wx, h - 5, 5, OUTLINE);
    p.circle(wx, h - 5, 4, burnt ? 0x1a1816 : 0x222222);
    p.circle(wx, h - 5, 2, burnt ? 0x3a3430 : 0x8a8e94);
  }
  if (opt.police && !burnt) {
    p.rect(30, h - 28, 8, 3, OUTLINE);
    p.rect(31, h - 27, 3, 2, 0xd03030);
    p.rect(34, h - 27, 3, 2, 0x3060e0);
    p.rect(3, h - 11, w - 6, 2, 0xf0f0f0);
    p.rect(40, h - 13, 10, 1, 0x2a4a9a);
  }
  if (opt.taxi && !burnt) p.rect(30, h - 27, 6, 2, 0xf0d040);
  if (burnt) {
    // 焦黑與鏽斑
    p.dither(4, h - 14, w - 8, 8, 0x5a3a24, 0.25);
    p.dither(12, h - 24, w - 26, 9, 0x000000, 0.3);
  }
}

export const PROPS: Record<string, PropArt> = {
  // ── 可互動 ──
  /** 紅色油桶：0 完好、1 凹陷漏油 */
  barrel: {
    w: 14,
    h: 20,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 1, 14, 19, 0xa8281e);
      p.rect(1, 1, 12, 2, 0xc94434);
      p.rect(0, 6, 14, 1, OUTLINE);
      p.rect(0, 13, 14, 1, OUTLINE);
      p.rect(2, 3, 2, 15, tone(0xa8281e, 0.25));
      p.rect(10, 3, 2, 15, tone(0xa8281e, -0.3));
      // 易燃標誌
      p.rect(5, 8, 4, 4, 0xf0c030);
      p.px(6, 9, OUTLINE);
      p.px(7, 10, OUTLINE);
      p.rect(9, 0, 3, 1, 0x3a3a3a);
      if (f === 1) {
        p.rect(0, 9, 3, 3, 0x6a1a12);
        p.rect(3, 18, 4, 2, 0x2a2018);
      }
    },
  },
  gascan: {
    w: 10,
    h: 11,
    draw: (p) => {
      p.box(0, 2, 10, 9, 0xc03020);
      p.rect(6, 0, 3, 3, OUTLINE);
      p.rect(7, 1, 1, 1, 0x707070);
      p.rect(1, 0, 4, 2, OUTLINE);
      p.rect(2, 5, 6, 3, tone(0xc03020, -0.25));
    },
  },
  /** 木箱：0 完好、1 被打爛 */
  crate: {
    w: 18,
    h: 16,
    frames: 2,
    draw: (p, f) => {
      if (f === 1) {
        p.rect(0, 12, 6, 4, WOOD);
        p.rect(7, 13, 8, 3, tone(WOOD, -0.2));
        p.rect(4, 10, 3, 2, tone(WOOD, 0.2));
        p.rect(13, 11, 5, 2, WOOD);
        return;
      }
      p.box(0, 0, 18, 16, WOOD);
      p.rect(1, 5, 16, 1, tone(WOOD, -0.35));
      p.rect(1, 10, 16, 1, tone(WOOD, -0.35));
      p.line(2, 14, 15, 2, tone(WOOD, 0.25));
      p.line(2, 13, 15, 1, tone(WOOD, -0.3));
      p.px(2, 2, 0x3a3a3a);
      p.px(15, 2, 0x3a3a3a);
      p.px(2, 13, 0x3a3a3a);
      p.px(15, 13, 0x3a3a3a);
    },
  },
  /** 軍用彈藥箱：0 完好、1 打開 */
  ammobox: {
    w: 20,
    h: 12,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 2, 20, 10, 0x4a5a32);
      p.rect(2, 6, 16, 1, tone(0x4a5a32, -0.3));
      p.rect(4, 8, 7, 2, 0xd8c890);
      p.rect(8, 0, 4, 3, OUTLINE);
      if (f === 1) {
        p.rect(1, 1, 18, 2, 0x1a1a14);
        p.rect(3, 1, 2, 1, 0xd8a840);
        p.rect(7, 1, 2, 1, 0xd8a840);
      }
    },
  },
  /** 路燈：0 亮、1 被打壞 */
  lamppost: {
    w: 22,
    h: 86,
    frames: 2,
    draw: (p, f) => {
      p.box(9, 8, 4, 78, 0x3a3f46);
      p.rect(7, 80, 8, 6, 0x2a2e34);
      p.rect(11, 6, 10, 3, 0x3a3f46);
      p.rect(14, 8, 8, 3, OUTLINE);
      p.rect(15, 9, 6, 2, f === 0 ? 0xfff0b0 : 0x303030);
      if (f === 1) p.px(17, 11, 0x9a9a9a);
    },
  },
  /** 天花板日光燈（從上往下掛） */
  tubelight: {
    w: 34,
    h: 8,
    frames: 2,
    draw: (p, f) => {
      p.rect(6, 0, 1, 4, 0x2a2a2a);
      p.rect(27, 0, 1, 4, 0x2a2a2a);
      p.box(0, 3, 34, 5, 0x8a8e94);
      p.rect(2, 5, 30, 2, f === 0 ? 0xf6fbff : 0x40444a);
    },
  },
  /** 電箱：0 通電（綠燈）、1 斷電（紅燈） */
  fusebox: {
    w: 14,
    h: 18,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 14, 18, 0x6a7078);
      p.rect(2, 3, 10, 9, 0x4a5058);
      for (let i = 0; i < 4; i++) p.rect(3 + i * 2, 5, 1, 4, f === 0 ? 0xd0d0d0 : 0x707070);
      p.rect(3, 13, 2, 2, f === 0 ? 0x50e060 : 0x502020);
      p.rect(9, 13, 2, 2, f === 1 ? 0xe04040 : 0x403030);
      p.rect(5, 0, 4, 1, 0xf0c030);
    },
  },
  /** 室內門：0 關著、1 被撞開（裡面黑的）、2 用木板封住 */
  door: {
    w: 26,
    h: 48,
    frames: 3,
    draw: (p, f) => {
      p.box(0, 0, 26, 48, 0x3a3430);
      if (f === 1) {
        p.rect(3, 3, 20, 45, 0x07080a);
        p.rect(3, 3, 5, 45, 0x5a4a3a);
        p.rect(4, 4, 3, 43, 0x6d5a46);
        return;
      }
      p.rect(3, 3, 20, 45, 0x6d5a46);
      p.rect(5, 6, 16, 16, tone(0x6d5a46, -0.15));
      p.rect(5, 26, 16, 18, tone(0x6d5a46, -0.15));
      p.rect(7, 8, 12, 9, 0x2a3440);
      p.rect(19, 27, 2, 2, 0xd0b060);
      if (f === 2) {
        p.box(-1, 12, 28, 5, 0x8d6e4a);
        p.box(-1, 30, 28, 5, 0x8d6e4a);
        p.line(1, 40, 24, 22, 0x5a4030);
        p.line(1, 41, 24, 23, 0x8d6e4a);
        for (const [x, y] of [[2, 14], [22, 14], [2, 32], [22, 32]]) p.px(x, y, 0xc0c0c0);
      }
    },
  },
  /** 玻璃窗（嵌在牆上）：0 完好、1 被打破 */
  glasswin: {
    w: 28,
    h: 24,
    frames: 2,
    draw: (p, f) => p.window(1, 1, 26, 21, { frame: 0x4a4e56, glass: 0x24323e, broken: f === 1 }),
  },

  // ── 車輛 ──
  car_red: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0x9a2c26) },
  car_blue: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0x2c4c8a) },
  car_white: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0xb8bcc0) },
  car_green: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0x3c5a3a) },
  car_taxi: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0xd8a820, 64, 28, { taxi: true }) },
  policecar: { w: 64, h: 28, frames: 2, draw: (p, f) => car(p, f, 0x22283a, 64, 28, { police: true }) },
  ambulance: {
    w: 70,
    h: 38,
    frames: 2,
    draw: (p, f) => {
      const c = f === 1 ? 0x2c2622 : 0xe4e4e0;
      p.box(1, 4, 50, 28, c);
      p.box(50, 14, 19, 18, c);
      p.rect(52, 16, 12, 7, 0x2c3e4c);
      if (f === 0) {
        p.rect(18, 12, 12, 4, 0xc82828);
        p.rect(22, 8, 4, 12, 0xc82828);
        p.rect(2, 22, 66, 2, 0xc82828);
        p.rect(20, 1, 10, 3, OUTLINE);
        p.rect(21, 2, 4, 2, 0xe03030);
        p.rect(25, 2, 4, 2, 0x3050e0);
      }
      for (const wx of [14, 58]) {
        p.circle(wx, 33, 5, OUTLINE);
        p.circle(wx, 33, 3, 0x8a8e94);
      }
    },
  },
  bus: {
    w: 140,
    h: 50,
    frames: 2,
    draw: (p, f) => {
      const c = f === 1 ? 0x2c2622 : 0x3a7a5a;
      p.box(1, 2, 138, 40, c);
      p.rect(2, 30, 136, 3, tone(c, 0.3));
      for (let x = 8; x < 124; x += 18) p.window(x, 8, 15, 14, { glass: 0x1e2a32, broken: f === 1 || x % 36 === 8 });
      p.rect(126, 8, 10, 22, 0x1e2a32);
      p.rect(127, 9, 1, 20, 0x3a4a56);
      p.rect(130, 34, 6, 3, 0xf2e6a0);
      for (const wx of [24, 112]) {
        p.circle(wx, 43, 7, OUTLINE);
        p.circle(wx, 43, 5, 0x222222);
        p.circle(wx, 43, 2, 0x8a8e94);
      }
      p.rect(4, 2, 132, 1, tone(c, 0.4));
    },
  },
  truck: {
    w: 92,
    h: 46,
    frames: 2,
    draw: (p, f) => {
      const c = f === 1 ? 0x2c2622 : 0x4a5232;
      // 車斗帆布
      p.box(1, 2, 62, 34, tone(c, -0.1));
      for (let x = 10; x < 60; x += 12) p.rect(x, 3, 1, 32, tone(c, -0.35));
      p.rect(2, 3, 60, 2, tone(c, 0.15));
      // 車頭
      p.box(62, 12, 28, 26, c);
      p.rect(72, 15, 14, 9, 0x24303a);
      p.rect(64, 30, 25, 2, tone(c, -0.3));
      p.rect(8, 22, 10, 6, 0xe8e8e0);
      p.rect(12, 23, 2, 4, 0x4a5232);
      p.rect(10, 24, 6, 2, 0x4a5232);
      for (const wx of [14, 36, 78]) {
        p.circle(wx, 39, 6, OUTLINE);
        p.circle(wx, 39, 4, 0x1e1e1e);
        p.circle(wx, 39, 2, 0x5a5e54);
      }
    },
  },
  scooter: {
    w: 26,
    h: 18,
    frames: 2,
    draw: (p, f) => {
      const c = f === 1 ? 0x2a2420 : 0xd8d0c0;
      p.circle(5, 13, 4, OUTLINE);
      p.circle(5, 13, 2, 0x6a6a6a);
      p.circle(21, 13, 4, OUTLINE);
      p.circle(21, 13, 2, 0x6a6a6a);
      p.box(3, 7, 15, 6, c);
      p.box(4, 4, 11, 4, 0x2a2a2a);
      p.rect(18, 2, 2, 10, 0x3a3a3a);
      p.rect(16, 1, 6, 2, 0x3a3a3a);
      p.rect(21, 5, 3, 2, 0xf2e6a0);
    },
  },

  // ── 掩體 ──
  jersey: {
    w: 40,
    h: 16,
    draw: (p) => {
      p.box(0, 4, 40, 12, 0x9a968c);
      p.rect(3, 1, 34, 4, OUTLINE);
      p.rect(4, 2, 32, 3, 0xb0aca2);
      for (let x = 2; x < 38; x += 6) p.rect(x, 10, 3, 2, x % 12 === 2 ? 0xd8b030 : 0x2a2a2a);
    },
  },
  sandbags: {
    w: 40,
    h: 20,
    draw: (p) => {
      const bag = (x: number, y: number, w: number) => p.box(x, y, w, 7, 0x8d7a54, { light: 0.2 });
      bag(0, 13, 14);
      bag(13, 13, 14);
      bag(26, 13, 14);
      bag(5, 7, 14);
      bag(18, 7, 14);
      bag(11, 1, 14);
    },
  },
  tires: {
    w: 18,
    h: 16,
    draw: (p) => {
      for (let i = 0; i < 3; i++) {
        p.box(1, 11 - i * 5, 16, 6, 0x262626, { light: 0.15 });
        p.rect(6, 12 - i * 5, 6, 3, 0x111111);
      }
    },
  },
  dumpster: {
    w: 40,
    h: 26,
    draw: (p) => {
      p.box(0, 6, 40, 18, 0x2f5a3a);
      p.rect(0, 2, 40, 5, OUTLINE);
      p.rect(1, 3, 38, 3, 0x3c6c48);
      for (let x = 6; x < 36; x += 8) p.rect(x, 9, 1, 13, tone(0x2f5a3a, -0.3));
      p.rect(4, 24, 3, 2, OUTLINE);
      p.rect(33, 24, 3, 2, OUTLINE);
      p.rect(8, 0, 6, 3, 0x3a3a3a);
    },
  },
  trashbags: {
    w: 22,
    h: 12,
    draw: (p) => {
      p.ellipse(7, 7, 6, 4, 0x1a1c20);
      p.ellipse(15, 8, 6, 3, 0x22252a);
      p.ellipse(11, 4, 5, 3, 0x2a2d33);
      p.px(10, 1, 0x50545a);
      p.px(5, 4, 0x40444a);
    },
  },
  cone: {
    w: 8,
    h: 11,
    draw: (p) => {
      p.rect(0, 9, 8, 2, OUTLINE);
      p.rect(2, 1, 4, 9, 0xe86020);
      p.rect(3, 0, 2, 1, 0xe86020);
      p.rect(2, 4, 4, 2, 0xf0f0f0);
    },
  },
  pump: {
    w: 16,
    h: 34,
    frames: 2,
    draw: (p, f) => {
      p.box(1, 4, 14, 30, f === 1 ? 0x2a2420 : 0xd8d4c8);
      p.rect(3, 7, 10, 7, OUTLINE);
      p.rect(4, 8, 8, 5, f === 1 ? 0x101010 : 0x304a30);
      if (f === 0) {
        p.rect(5, 9, 6, 1, 0x80ff80);
        p.rect(5, 11, 4, 1, 0x80ff80);
      }
      p.rect(2, 0, 12, 5, 0xc83020);
      p.rect(14, 16, 2, 10, OUTLINE);
      p.rect(12, 17, 2, 2, 0x2a2a2a);
      p.rect(3, 18, 10, 2, 0xc83020);
    },
  },
  counter: {
    w: 46,
    h: 22,
    draw: (p) => {
      p.box(0, 4, 46, 18, 0x6a6e72);
      p.rect(0, 2, 46, 3, OUTLINE);
      p.rect(1, 3, 44, 1, 0x9aa0a6);
      p.rect(4, 8, 38, 1, tone(0x6a6e72, -0.3));
      p.box(28, -1 + 0, 14, 4, 0x2a2a2e);
      p.rect(32, 0, 6, 2, 0x50e060);
    },
  },
  desk: {
    w: 40,
    h: 26,
    draw: (p) => {
      p.box(0, 10, 40, 5, 0x6a4a30);
      p.rect(2, 15, 3, 11, 0x3a2a1c);
      p.box(28, 14, 11, 12, 0x5a3e28);
      p.rect(30, 18, 7, 1, 0x2a1a10);
      p.box(6, 0, 16, 11, 0x2a2a2e);
      p.rect(8, 2, 12, 6, 0x1c2a3a);
      p.rect(12, 10, 4, 1, OUTLINE);
      p.rect(24, 8, 8, 2, 0xd8d8d0);
    },
  },
  filecab: {
    w: 16,
    h: 30,
    draw: (p) => {
      p.box(0, 0, 16, 30, 0x6a727a);
      for (let y = 3; y < 28; y += 7) {
        p.rect(2, y, 12, 6, tone(0x6a727a, -0.12));
        p.rect(6, y + 2, 4, 1, 0xc0c0c0);
      }
    },
  },
  locker: {
    w: 16,
    h: 40,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 16, 40, 0x4a5a6a);
      p.rect(8, 1, 1, 38, OUTLINE);
      for (const x of [2, 10]) for (let y = 4; y < 12; y += 2) p.rect(x, y, 4, 1, 0x26303a);
      p.rect(6, 20, 1, 3, 0xc0c0c0);
      p.rect(10, 20, 1, 3, 0xc0c0c0);
      if (f === 1) {
        p.rect(9, 1, 6, 38, 0x0c0e10);
        p.rect(10, 10, 4, 1, 0x5a5a5a);
      }
    },
  },
  /** 槍械櫃：0 鎖著（看得到裡面的槍）、1 撬開 */
  gunlocker: {
    w: 22,
    h: 42,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 22, 42, 0x3a4048);
      p.rect(2, 3, 18, 36, 0x14181c);
      for (let i = 0; i < 3; i++) {
        p.rect(4 + i * 6, 6, 2, 28, 0x2a2a2a);
        p.rect(4 + i * 6, 26, 3, 8, 0x5a3e28);
      }
      for (let y = 3; y < 39; y += 4) p.rect(2, y, 18, 1, f === 1 ? 0x14181c : 0x5a6068);
      if (f === 0) {
        p.rect(9, 20, 4, 4, 0xd0a030);
        p.rect(10, 18, 2, 2, 0x9a9a9a);
      } else p.rect(18, 3, 4, 36, 0x3a4048);
    },
  },
  shelf: {
    w: 44,
    h: 50,
    draw: (p) => {
      p.box(0, 0, 44, 50, 0x8a8e94);
      const colors = [0xc83a2a, 0x2a7ac8, 0xe8c040, 0x3aa050, 0xe8e0d0, 0x9a4ac0, 0xe07a30];
      for (let row = 0; row < 4; row++) {
        const y = 3 + row * 12;
        p.rect(2, y + 9, 40, 2, 0x5a5e64);
        for (let x = 3; x < 41; ) {
          const w = 3 + Math.floor(p.rnd.frac() * 4);
          const h = 4 + Math.floor(p.rnd.frac() * 5);
          if (p.rnd.frac() < 0.25) {
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
  /** 倒在地上的貨架（障礙物） */
  shelf_low: {
    w: 46,
    h: 18,
    draw: (p) => {
      p.box(0, 6, 46, 12, 0x7a7e84);
      p.rect(2, 9, 42, 1, 0x4a4e54);
      p.rect(4, 2, 5, 5, 0xc83a2a);
      p.rect(12, 3, 4, 4, 0xe8c040);
      p.rect(30, 1, 6, 6, 0x2a7ac8);
      p.rect(38, 4, 3, 3, 0x3aa050);
    },
  },
  cart: {
    w: 20,
    h: 16,
    draw: (p) => {
      p.rect(2, 2, 16, 1, 0x9aa0a6);
      p.rect(2, 9, 16, 1, 0x9aa0a6);
      for (let x = 2; x < 19; x += 3) p.rect(x, 2, 1, 8, 0x7a8086);
      p.rect(0, 0, 3, 1, 0x9aa0a6);
      p.rect(4, 10, 12, 1, 0x6a7076);
      p.circle(5, 14, 1, OUTLINE);
      p.circle(15, 14, 1, OUTLINE);
    },
  },
  fridge: {
    w: 26,
    h: 46,
    draw: (p) => {
      p.box(0, 0, 26, 46, 0xd8dce0);
      p.rect(3, 4, 20, 34, 0x9ad0e0);
      for (let y = 6; y < 36; y += 8) {
        p.rect(3, y + 6, 20, 1, 0x6a8a9a);
        for (let x = 4; x < 22; x += 3) p.rect(x, y + 1, 2, 5, [0xc83a2a, 0x3aa050, 0xe8c040, 0x2a7ac8][(x + y) % 4]);
      }
      p.rect(3, 4, 2, 34, 0xe0f4ff);
      p.rect(2, 1, 22, 2, 0x2a7ac8);
    },
  },
  bed: {
    w: 40,
    h: 20,
    draw: (p) => {
      p.box(0, 6, 40, 6, 0xd8dce0);
      p.rect(1, 4, 38, 3, 0xa8c8d8);
      p.box(1, 1, 10, 5, 0xf0f0f0);
      p.rect(0, 0, 2, 20, 0x9aa0a6);
      p.rect(38, 4, 2, 16, 0x9aa0a6);
      p.rect(4, 12, 1, 7, 0x7a8086);
      p.rect(34, 12, 1, 7, 0x7a8086);
      p.circle(4, 19, 1, OUTLINE);
      p.circle(34, 19, 1, OUTLINE);
      p.rect(18, 5, 8, 2, 0x8a2a22);
    },
  },
  ivstand: {
    w: 12,
    h: 36,
    draw: (p) => {
      p.rect(5, 2, 1, 32, 0x9aa0a6);
      p.rect(1, 2, 10, 1, 0x9aa0a6);
      p.box(6, 3, 5, 8, 0xd0e8f0, { outline: 0x6a8090 });
      p.rect(8, 11, 1, 10, 0xb0c0c8);
      p.rect(1, 34, 10, 1, 0x6a7076);
      p.px(1, 35, OUTLINE);
      p.px(10, 35, OUTLINE);
    },
  },
  wheelchair: {
    w: 18,
    h: 18,
    draw: (p) => {
      p.circle(7, 12, 5, OUTLINE);
      p.circle(7, 12, 4, 0x6a7076);
      p.circle(7, 12, 2, OUTLINE);
      p.rect(4, 6, 10, 2, 0x2a3a5a);
      p.rect(3, 0, 2, 8, 0x9aa0a6);
      p.rect(12, 8, 2, 6, 0x9aa0a6);
      p.circle(15, 15, 2, OUTLINE);
    },
  },
  bench: {
    w: 34,
    h: 14,
    draw: (p) => {
      p.box(0, 0, 34, 4, 0x6a4a30);
      p.box(0, 5, 34, 4, 0x7a5636);
      p.rect(3, 9, 2, 5, 0x2a2a2a);
      p.rect(29, 9, 2, 5, 0x2a2a2a);
    },
  },
  plant: {
    w: 14,
    h: 22,
    draw: (p) => {
      p.box(3, 14, 8, 8, 0x8a4a2a);
      for (let i = 0; i < 14; i++) {
        const x = 2 + Math.floor(p.rnd.frac() * 10);
        const y = 2 + Math.floor(p.rnd.frac() * 12);
        p.rect(x, y, 2, 2, p.rnd.frac() < 0.5 ? 0x2a5a2a : 0x3a7a3a);
      }
      p.rect(6, 6, 1, 8, 0x3a4a2a);
    },
  },
  sofa: {
    w: 40,
    h: 20,
    draw: (p) => {
      p.box(2, 2, 36, 10, 0x6a3a3a);
      p.box(0, 9, 40, 9, 0x7a4444);
      p.box(0, 6, 6, 12, 0x6a3a3a);
      p.box(34, 6, 6, 12, 0x6a3a3a);
      p.rect(2, 18, 2, 2, OUTLINE);
      p.rect(36, 18, 2, 2, OUTLINE);
      p.rect(12, 4, 3, 2, 0x3a1a1a);
    },
  },
  wardrobe: {
    w: 26,
    h: 44,
    frames: 2,
    draw: (p, f) => {
      p.box(0, 0, 26, 44, 0x5a3e28);
      p.rect(13, 2, 1, 40, OUTLINE);
      p.rect(10, 20, 1, 4, 0xd0b060);
      p.rect(16, 20, 1, 4, 0xd0b060);
      if (f === 1) {
        p.rect(14, 2, 10, 40, 0x0a0a0c);
        p.rect(16, 6, 6, 10, 0x3a4a6a);
      }
    },
  },
  /** 神明桌：紅色神明燈會微微發亮 */
  shrine: {
    w: 36,
    h: 30,
    draw: (p) => {
      p.box(0, 14, 36, 4, 0x7a2a1a);
      p.box(2, 18, 32, 12, 0x5a1e12);
      p.rect(6, 21, 24, 1, 0xd0a030);
      p.box(10, 4, 16, 11, 0x5a1e12);
      p.rect(13, 6, 10, 8, 0xd0a030);
      p.rect(15, 7, 6, 6, 0x9a2a1a);
      p.rect(3, 8, 3, 6, 0xe03020);
      p.rect(30, 8, 3, 6, 0xe03020);
      p.rect(4, 9, 1, 3, 0xff8060);
      p.rect(31, 9, 1, 3, 0xff8060);
      p.rect(17, 12, 2, 2, 0x8a6a30);
    },
  },
  tv: {
    w: 22,
    h: 22,
    draw: (p) => {
      p.box(0, 0, 22, 15, 0x2a2a2e);
      p.rect(2, 2, 18, 11, 0x14181c);
      p.line(4, 10, 9, 4, 0x2a3440);
      p.box(2, 15, 18, 7, 0x5a3e28);
    },
  },
  /** 堆起來的紙箱 */
  boxes: {
    w: 32,
    h: 30,
    draw: (p) => {
      const b = (x: number, y: number, w: number, h: number) => {
        p.box(x, y, w, h, 0xa8804a);
        p.rect(x + Math.floor(w / 2) - 1, y + 1, 2, h - 2, 0xd8c890);
      };
      b(0, 14, 16, 16);
      b(15, 16, 17, 14);
      b(6, 0, 15, 15);
    },
  },
  pallet: {
    w: 36,
    h: 30,
    draw: (p) => {
      p.box(0, 25, 36, 5, 0x9a7a4a);
      p.rect(4, 27, 4, 3, 0x2a2018);
      p.rect(16, 27, 4, 3, 0x2a2018);
      p.rect(28, 27, 4, 3, 0x2a2018);
      p.box(2, 3, 32, 23, 0x4a5a32);
      for (let y = 8; y < 25; y += 6) p.rect(3, y, 30, 1, tone(0x4a5a32, -0.3));
      p.rect(2, 2, 32, 3, 0x2a2a2a);
      p.rect(10, 12, 16, 6, 0xd8c890);
    },
  },
  forklift: {
    w: 40,
    h: 34,
    draw: (p) => {
      p.box(10, 12, 26, 16, 0xd8a020);
      p.rect(12, 2, 2, 12, 0x2a2a2a);
      p.rect(32, 2, 2, 12, 0x2a2a2a);
      p.rect(12, 2, 22, 2, 0x2a2a2a);
      p.rect(2, 0, 3, 30, 0x3a3a3a);
      p.rect(0, 28, 12, 2, 0x5a5a5a);
      for (const wx of [15, 31]) {
        p.circle(wx, 29, 4, OUTLINE);
        p.circle(wx, 29, 2, 0x4a4a4a);
      }
    },
  },
  tent: {
    w: 60,
    h: 34,
    draw: (p) => {
      const c = 0x5a6a3a;
      for (let j = 0; j < 30; j++) {
        const hw = Math.floor(6 + j * 0.85);
        p.rect(30 - hw, 4 + j, hw * 2, 1, j % 6 === 0 ? tone(c, -0.15) : c);
      }
      p.line(30, 3, 5, 33, OUTLINE);
      p.line(30, 3, 55, 33, OUTLINE);
      p.rect(24, 18, 12, 16, 0x1a1e12);
      p.rect(29, 0, 2, 5, 0x3a3a3a);
    },
  },
  campfire: {
    w: 18,
    h: 14,
    draw: (p) => {
      p.rect(1, 11, 16, 3, 0x3a2a1a);
      p.line(2, 12, 15, 9, 0x5a3e28);
      p.line(2, 9, 15, 12, 0x5a3e28);
      p.ellipse(9, 6, 4, 5, 0xe86020);
      p.ellipse(9, 7, 2, 3, 0xf8d060);
      p.px(9, 1, 0xe86020);
    },
  },
  /** 蓋著防水布的物資 */
  tarp: {
    w: 40,
    h: 20,
    draw: (p) => {
      for (let j = 0; j < 18; j++) {
        const hw = Math.min(19, 8 + j * 2);
        p.rect(20 - hw, 2 + j, hw * 2, 1, j % 5 === 0 ? 0x2a4a6a : 0x34587a);
      }
      p.line(2, 19, 12, 4, 0x2a4a6a);
      p.rect(0, 18, 40, 2, OUTLINE);
      p.rect(30, 14, 6, 4, 0x4a5a32);
    },
  },
  /** 拉繩＋生鏽手榴彈（絆線） */
  tripwire: {
    w: 60,
    h: 8,
    draw: (p) => {
      p.rect(0, 2, 2, 6, 0x5a5a5a);
      p.rect(58, 2, 2, 6, 0x5a5a5a);
      p.line(2, 4, 57, 4, 0xc0c0b0, 0.8);
      p.ellipse(54, 6, 2, 2, 0x4a5a2a);
    },
  },
  /** 地板的破洞（樓板塌陷） */
  hole: {
    w: 70,
    h: 18,
    draw: (p) => {
      p.ellipse(35, 9, 33, 8, 0x05060a);
      p.ellipse(35, 8, 29, 6, 0x000000);
      p.rect(8, 6, 54, 2, 0x6d4c33);
      p.rect(14, 11, 40, 2, 0x5a3e28);
      p.rect(2, 4, 6, 3, 0x4a3a2a);
    },
  },
  cellbars: {
    w: 50,
    h: 60,
    draw: (p) => {
      p.rect(0, 0, 50, 60, 0x14161a);
      p.rect(4, 40, 18, 6, 0x4a4a4a);
      for (let x = 1; x < 50; x += 5) p.rect(x, 0, 2, 60, 0x5a6068);
      p.rect(0, 0, 50, 3, 0x3a4048);
      p.rect(0, 30, 50, 2, 0x3a4048);
      p.rect(0, 57, 50, 3, 0x3a4048);
    },
  },
  watchtower: {
    w: 40,
    h: 100,
    draw: (p) => {
      p.rect(6, 30, 3, 70, 0x4a3e2e);
      p.rect(31, 30, 3, 70, 0x4a3e2e);
      p.line(8, 40, 32, 96, 0x3a2e22);
      p.line(32, 40, 8, 96, 0x3a2e22);
      p.box(0, 16, 40, 16, 0x5a6a3a);
      p.rect(3, 19, 34, 5, 0x14181c);
      p.rect(0, 8, 40, 3, OUTLINE);
      p.rect(2, 10, 1, 7, 0x3a3a3a);
      p.rect(37, 10, 1, 7, 0x3a3a3a);
      p.box(24, 2, 10, 7, 0x3a3f46);
      p.rect(26, 4, 6, 3, 0xfff0b0);
    },
  },
  hydrant: {
    w: 10,
    h: 14,
    draw: (p) => {
      p.box(2, 3, 6, 11, 0xc83020);
      p.rect(0, 6, 10, 3, 0xc83020);
      p.rect(3, 0, 4, 3, 0xa82418);
    },
  },
  /** 擋住門的家具（避難所） */
  barricadedoor: {
    w: 50,
    h: 56,
    draw: (p) => {
      p.box(8, 0, 34, 56, 0x3a3430);
      p.rect(11, 3, 28, 53, 0x5a4a3a);
      p.box(4, 30, 42, 14, 0x6a4a30);
      p.box(0, 42, 22, 14, 0x5a3e28);
      p.box(26, 22, 20, 34, 0x4a3424);
      p.line(10, 8, 40, 26, 0x8d6e4a);
      p.line(10, 9, 40, 27, 0x5a4030);
      p.rect(28, 26, 16, 1, 0x2a1a10);
    },
  },
  /** 半開的鐵捲門（牆上） */
  shutter: {
    w: 54,
    h: 50,
    draw: (p) => {
      p.box(0, 0, 54, 50, 0x3a3f46);
      p.rect(3, 4, 48, 46, 0x07080a);
      for (let y = 4; y < 30; y += 3) p.rect(3, y, 48, 2, y % 6 === 4 ? 0x7a8088 : 0x6a7078);
      p.rect(3, 30, 48, 2, 0x4a5058);
      p.box(8, 38, 12, 12, 0xa8804a);
      p.box(30, 40, 14, 10, 0x4a5a32);
    },
  },
  debris: {
    w: 30,
    h: 10,
    draw: (p) => {
      p.rect(2, 6, 10, 4, 0x5a5650);
      p.rect(10, 4, 8, 6, 0x6a665e);
      p.rect(18, 7, 10, 3, 0x4a4640);
      p.line(4, 5, 14, 1, 0x7a3e22);
      p.rect(22, 5, 3, 2, 0x8a867e);
    },
  },
  billboard: {
    w: 70,
    h: 64,
    draw: (p) => {
      p.rect(16, 30, 3, 34, 0x3a3f46);
      p.rect(51, 30, 3, 34, 0x3a3f46);
      p.box(0, 0, 70, 32, 0x2a3036);
      p.rect(3, 3, 64, 26, 0xd8c8a0);
      p.rect(3, 3, 64, 10, 0xc83a2a);
      p.rect(8, 17, 30, 3, 0x2a2a2a);
      p.rect(8, 22, 20, 2, 0x5a5a5a);
      p.circle(54, 21, 6, 0x3a7ac8);
      p.dither(3, 3, 64, 26, 0x2a2420, 0.18);
    },
  },
  /** 籃球架（校園） */
  hoop: {
    w: 30,
    h: 70,
    draw: (p) => {
      p.rect(3, 10, 3, 60, 0x3a6a9a);
      p.rect(0, 66, 10, 4, 0x2a2a2a);
      p.rect(5, 12, 10, 2, 0x3a6a9a);
      p.box(12, 0, 18, 14, 0xe8e8e0);
      p.rect(17, 5, 8, 6, OUTLINE);
      p.rect(18, 6, 6, 4, 0xe8e8e0);
      p.rect(16, 14, 10, 1, 0xe86020);
      for (let x = 17; x < 26; x += 2) p.rect(x, 15, 1, 5, 0xd0d0d0);
    },
  },
  flagpole: {
    w: 24,
    h: 90,
    draw: (p) => {
      p.rect(2, 0, 2, 90, 0x9aa0a6);
      p.rect(0, 86, 8, 4, 0x5a5a5a);
      p.rect(4, 4, 18, 12, 0x8a2a22);
      p.dither(4, 4, 18, 12, 0x3a1a12, 0.3);
      p.rect(18, 12, 4, 4, 0x14161a);
    },
  },
  powerpole: {
    w: 26,
    h: 110,
    draw: (p) => {
      p.rect(11, 0, 4, 110, 0x4a3e30);
      p.rect(0, 8, 26, 3, 0x3a3026);
      p.rect(3, 22, 20, 2, 0x3a3026);
      p.px(1, 7, 0xd0d0c0);
      p.px(24, 7, 0xd0d0c0);
      p.box(15, 28, 8, 10, 0x6a7078);
    },
  },
  /** 告示板（警察局通緝令） */
  noticeboard: {
    w: 36,
    h: 26,
    draw: (p) => {
      p.box(0, 0, 36, 26, 0x7a5636);
      p.rect(2, 2, 32, 22, 0xa88a5a);
      for (const [x, y, c] of [[4, 4, 0xe8e0d0], [14, 3, 0xe8e0d0], [24, 5, 0xf0e070], [6, 14, 0xe8e0d0], [18, 13, 0xd8c8a0]] as const) {
        p.rect(x, y, 9, 9, c);
        p.rect(x + 3, y + 2, 3, 3, 0x5a5a5a);
        p.px(x + 4, y, 0xc83020);
      }
    },
  },
  radio: {
    w: 24,
    h: 22,
    draw: (p) => {
      p.box(0, 8, 24, 14, 0x4a5232);
      p.rect(3, 11, 10, 6, 0x1a1e12);
      p.rect(4, 13, 3, 1, 0x80ff80);
      p.circle(18, 14, 3, OUTLINE);
      p.rect(20, 0, 1, 9, 0x2a2a2a);
    },
  },
  /** 牆上的紅十字標誌 */
  redcross: {
    w: 24,
    h: 24,
    draw: (p) => {
      p.box(0, 0, 24, 24, 0xe8e8e0);
      p.rect(9, 3, 6, 18, 0xc82828);
      p.rect(3, 9, 18, 6, 0xc82828);
    },
  },
  /** 傷者（靠牆坐著） */
  wounded: {
    w: 26,
    h: 26,
    draw: (p) => {
      p.box(2, 2, 10, 10, 0xc89a78);
      p.rect(2, 1, 10, 4, 0x2a2018);
      p.box(1, 11, 14, 11, 0x5a6a8a);
      p.box(12, 18, 14, 6, 0x3a4a5a);
      p.rect(17, 19, 5, 4, 0x8a1a12);
      p.rect(4, 6, 2, 1, OUTLINE);
      p.ellipse(18, 25, 7, 1, 0x5a0a08, 0.7);
    },
  },
  /** 戴防毒面具的拾荒者 */
  trader: {
    w: 26,
    h: 48,
    draw: (p) => {
      p.box(4, 14, 18, 22, 0x4a4434);
      p.box(0, 12, 10, 24, 0x6a5a3a);
      p.rect(1, 6, 7, 8, 0x5a4a30);
      p.box(8, 2, 11, 12, 0x3a3a3a);
      p.circle(12, 9, 2, 0x8a9a8a);
      p.circle(16, 9, 2, 0x8a9a8a);
      p.box(12, 11, 5, 4, 0x2a2a2a);
      p.box(6, 36, 6, 12, 0x2a2a2a);
      p.box(14, 36, 6, 12, 0x2a2a2a);
      p.rect(20, 18, 4, 10, 0x4a4434);
    },
  },
  /** 霧屍骸／屍體（地上） */
  corpse: {
    w: 30,
    h: 8,
    draw: (p) => {
      p.ellipse(15, 6, 14, 2, 0x3a0a08, 0.8);
      p.box(4, 2, 18, 5, 0x4a4a3a);
      p.box(21, 1, 6, 6, 0x8a9070);
      p.rect(0, 4, 5, 2, 0x8a9070);
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
