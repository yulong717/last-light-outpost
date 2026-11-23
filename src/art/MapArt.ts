import Phaser from 'phaser';
import { canvasTexture, frameSheet, mix, OUTLINE, tone, type Painter } from './Painter';

/**
 * 城市地圖的像素畫：俯視的街區（屋頂、冷氣、水塔）、公園、停車場、河、
 * 道路網格與車道線、右上越來越濃的霧。另外畫每個區域的小圖示（學校、醫院、警局…）。
 */

const ROAD = 0x2a2d33;
const ROAD_LINE = 0x6a6450;
const WALK = 0x3a3d44;
const ROOFS = [0x3a3532, 0x30343a, 0x403a34, 0x363a40, 0x2e322e, 0x44403a];

export function ensureCityMap(scene: Phaser.Scene, w: number, h: number): string {
  const key = 'city_map';
  if (scene.textures.exists(key)) return key;
  canvasTexture(scene, key, w, h, (p) => {
    p.rect(0, 0, w, h, ROAD);
    // 街區格子：34×30，路寬 8
    const BW = 34;
    const BH = 30;
    for (let by = 2; by < h; by += BH) {
      for (let bx = 2; bx < w; bx += BW) {
        const bw = BW - 8;
        const bh = BH - 8;
        p.rect(bx, by, bw, bh, WALK);
        p.rect(bx, by, bw, 1, tone(WALK, 0.15));
        const r = p.rnd.frac();
        if (r < 0.12) park(p, bx + 1, by + 1, bw - 2, bh - 2);
        else if (r < 0.2) parking(p, bx + 1, by + 1, bw - 2, bh - 2);
        else roofs(p, bx + 1, by + 1, bw - 2, bh - 2);
      }
    }
    // 車道虛線
    for (let y = 2 + BH - 4; y < h; y += BH) for (let x = 0; x < w; x += 6) p.rect(x, y, 3, 1, ROAD_LINE, 0.6);
    for (let x = 2 + BW - 4; x < w; x += BW) for (let y = 0; y < h; y += 6) p.rect(x, y, 1, 3, ROAD_LINE, 0.6);
    // 斜穿過城市的河（含橋）
    river(p, w, h);
    // 零星的廢車與火光
    for (let i = 0; i < 14; i++) {
      const x = p.rnd.between(4, w - 8);
      const y = p.rnd.between(4, h - 6);
      p.rect(x, y, 5, 3, OUTLINE);
      p.rect(x + 1, y + 1, 3, 1, p.rnd.pick([0x8a3a2a, 0x3a5a8a, 0xb0b0b0, 0x5a6a3a]));
    }
    for (let i = 0; i < 5; i++) {
      const x = p.rnd.between(w * 0.4, w - 10);
      const y = p.rnd.between(10, h * 0.6);
      p.circle(x, y, 5, 0xff7a3a, 0.08);
      p.circle(x, y, 2, 0xff9a4a, 0.5);
      p.px(x, y, 0xffe0a0);
    }
    // 霧：右上越遠越濃（抖色）
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = (x / w) * 0.6 + (1 - y / h) * 0.4;
        if (d < 0.45) continue;
        const a = (d - 0.45) * 0.55;
        if ((x + y) % 2 === 0 && p.rnd.frac() < a * 1.6) p.px(x, y, 0x9aa3b0, 0.18);
      }
  });
  return key;
}

function roofs(p: Painter, x: number, y: number, w: number, h: number): void {
  // 一塊街區切成 1～3 棟
  const split = p.rnd.between(1, 3);
  const vertical = p.rnd.frac() < 0.5;
  for (let i = 0; i < split; i++) {
    const bx = vertical ? x + Math.floor((w / split) * i) : x;
    const by = vertical ? y : y + Math.floor((h / split) * i);
    const bw = vertical ? Math.floor(w / split) - 1 : w;
    const bh = vertical ? h : Math.floor(h / split) - 1;
    if (bw < 4 || bh < 4) continue;
    const c = p.rnd.pick(ROOFS);
    // 陰影投在右下
    p.rect(bx + 2, by + 2, bw, bh, 0x101216, 0.6);
    p.rect(bx, by, bw, bh, OUTLINE);
    p.rect(bx + 1, by + 1, bw - 2, bh - 2, c);
    p.rect(bx + 1, by + 1, bw - 2, 1, tone(c, 0.25));
    p.rect(bx + 1, by + 1, 1, bh - 2, tone(c, 0.15));
    // 屋頂上的東西：冷氣、水塔、天窗
    const n = p.rnd.between(0, 2);
    for (let k = 0; k < n; k++) {
      const ox = bx + p.rnd.between(2, Math.max(2, bw - 5));
      const oy = by + p.rnd.between(2, Math.max(2, bh - 5));
      if (p.rnd.frac() < 0.5) {
        p.rect(ox, oy, 3, 3, tone(c, 0.35));
        p.px(ox + 1, oy + 1, tone(c, -0.3));
      } else {
        p.circle(ox + 1, oy + 1, 1, 0x8a9098);
      }
    }
    if (p.rnd.frac() < 0.06) p.rect(bx + 2, by + 2, 2, 2, 0xd8b060);
  }
}

function park(p: Painter, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, 0x1e3420);
  p.dither(x, y, w, h, 0x2a4428, 0.3);
  for (let i = 0; i < 5; i++) {
    const tx = x + p.rnd.between(3, w - 4);
    const ty = y + p.rnd.between(3, h - 4);
    p.circle(tx + 1, ty + 1, 2, 0x0e1a10);
    p.circle(tx, ty, 2, 0x34582e);
    p.px(tx - 1, ty - 1, 0x4a7a3e);
  }
}

function parking(p: Painter, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, 0x34373e);
  for (let i = x + 2; i < x + w - 2; i += 4) {
    p.rect(i, y + 1, 1, 5, 0x8a8a80);
    p.rect(i, y + h - 6, 1, 5, 0x8a8a80);
    if (p.rnd.frac() < 0.4) p.rect(i + 1, y + 2, 3, 4, p.rnd.pick([0x8a3a2a, 0x3a5a8a, 0xb0b0b0]));
  }
}

function river(p: Painter, w: number, h: number): void {
  const water = 0x16283a;
  for (let y = 0; y < h; y++) {
    const cx = Math.round(w * 0.78 - y * 0.35 + Math.sin(y * 0.05) * 8);
    const half = 9;
    p.rect(cx - half - 2, y, 2, 1, 0x4a4a3a);
    p.rect(cx + half, y, 2, 1, 0x4a4a3a);
    p.rect(cx - half, y, half * 2, 1, water);
    if (y % 3 === 0) p.rect(cx - half + ((y * 7) % (half * 2 - 3)), y, 3, 1, mix(water, 0x6a8aa8, 0.4));
  }
  // 兩座橋
  for (const by of [Math.round(h * 0.3), Math.round(h * 0.72)]) {
    const cx = Math.round(w * 0.78 - by * 0.35 + Math.sin(by * 0.05) * 8);
    p.rect(cx - 13, by - 3, 26, 7, OUTLINE);
    p.rect(cx - 12, by - 2, 24, 5, 0x5a5a5e);
    p.rect(cx - 12, by - 2, 24, 1, 0x7a7a7e);
  }
}

// ── 區域圖示（12×12）────────────────────────────

const ICONS: Record<string, string[]> = {
  school: ['....1111....', '....1331....', '...111111...', '..12222221..', '.1222222221.', '.1232332321.', '.1222222221.', '.1232332321.', '.1222112221.', '.1222112221.', '.1111111111.', '............'],
  downtown: ['.....11.....', '....1221....', '....1231..11', '.11.1221.121', '1221123112 1', '1231122112 1', '1221123112 1', '1231122112 1', '1221123112 1', '122112211221', '111111111111', '............'],
  nightmarket: ['.1........1.', '1r1..1..1r1.', '.1..1r1..1..', '....1r1.....', '.....1......', '111111111111', '1rwrwrwrwrw1', '111111111111', '.1........1.', '.1..2222..1.', '.1..2222..1.', '111111111111'],
  gas: ['111111111...', '1wwwwwww1...', '111111111...', '.1rrrr1.....', '.1r22r1.11..', '.1r22r1..1..', '.1rrrr1..1..', '.1rrrr1..1..', '.1rrrr1.11..', '.1rrrr1.....', '11111111....', '............'],
  market: ['............', '.11.........', '..1.........', '..111111111.', '..1g1g1g1g1.', '..111111111.', '..1g1g1g1g1.', '..11111111..', '...1.....1..', '..111111111.', '..1.1...1.1.', '...1.....1..'],
  homes: ['.....11.....', '....1221....', '...122221...', '..12222221..', '.1222222221.', '..1w21w221..', '..1221w221..', '..12222221..', '..1w2112w1..', '..12211221..', '..11111111..', '............'],
  hospital: ['.1111111111.', '.1wwwwwwww1.', '.1www11www1.', '.1www1r1ww1.', '.1w11rr111w1', '.1w1rrrrr1w1', '.1w11rr111w1', '.1www1r1ww1.', '.1www11www1.', '.1wwwwwwww1.', '.1111111111.', '............'],
  police: ['.....11.....', '....1ww1....', '..11wwww11..', '.1wwbbbbww1.', '.1wbbwwbbw1.', '.1wbwwwwbw1.', '.1wbbwwbbw1.', '..1wbbbbw1..', '...1wwww1...', '....1ww1....', '.....11.....', '............'],
  checkpoint: ['1.1.1.1.1.1.', '111111111111', '1.1.1.1.1.1.', '............', '..111..111..', '.1ggg11ggg1.', '.1ggggggggg1', '.11111111111', '.1g1ggg1gg1.', '.11111111111', '............', '............'],
};

export const ZONE_ICON_KEY = 'zone_icons';
export const ZONE_ICON_IDS = Object.keys(ICONS);

export function ensureZoneIcons(scene: Phaser.Scene): void {
  frameSheet(scene, ZONE_ICON_KEY, 12, 12, ZONE_ICON_IDS.length, (p, f) => {
    const rows = ICONS[ZONE_ICON_IDS[f]];
    const pal: Record<string, number> = { '1': OUTLINE, '2': 0xd8d4c8, '3': 0x5a8ae0, w: 0xf4f4f0, r: 0xe04040, g: 0x6ac07a, b: 0x3a5ac0 };
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = pal[row[x]];
        if (c !== undefined) p.px(x, y, c);
      }
    });
  });
}

export function zoneIconFrame(id: string): number {
  const i = ZONE_ICON_IDS.indexOf(id);
  return i < 0 ? -1 : i;
}
