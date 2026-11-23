import Phaser from 'phaser';
import { canvasTexture, mix, OUTLINE, tone, type Painter } from './Painter';

/**
 * 關卡插圖：序章、章節開場、結局卡上方的橫幅像素畫（400×120，邏輯像素）。
 * 全部用 Painter 程式畫：夜空漸層＋抖色、遠景天際線、該區域的地標、貼地霧、霧屍剪影。
 * 每個區域一張（key = illus_<zone>），第一次用到時才畫。
 */

export const ILLUS_W = 400;
export const ILLUS_H = 120;

export type IllustrationId =
  | 'school'
  | 'downtown'
  | 'nightmarket'
  | 'homes'
  | 'market'
  | 'hospital'
  | 'police'
  | 'checkpoint'
  | 'gas'
  | 'outpost';

const WIN = 0xd8b060;
const WIN_DIM = 0x8a6a34;
/** 地標畫在 400×120 的座標系裡，地面在 y=104 */
const LANDMARK_GY = 104;
// 目前這張圖的尺寸（共用圖層依它畫；地標用 Painter 的 ox/oy 平移置中）
let W = ILLUS_W;
let H = ILLUS_H;
let GY = LANDMARK_GY;

interface Mood {
  skyTop: number;
  skyBottom: number;
  far: number;
  mid: number;
  fog: number;
  accent: number;
  moon?: { x: number; y: number; r: number };
}

const MOODS: Record<IllustrationId, Mood> = {
  school: { skyTop: 0x0a0d1c, skyBottom: 0x2c2440, far: 0x1a1a2c, mid: 0x26263a, fog: 0x8c86a8, accent: 0x5a8ae0, moon: { x: 330, y: 26, r: 11 } },
  downtown: { skyTop: 0x0c0a12, skyBottom: 0x3a1e1a, far: 0x1c1418, mid: 0x2a2024, fog: 0xa07860, accent: 0xff7a3a },
  nightmarket: { skyTop: 0x100a18, skyBottom: 0x3a1a34, far: 0x1e1422, mid: 0x2c1e30, fog: 0xa07898, accent: 0xe04a5a, moon: { x: 70, y: 22, r: 8 } },
  homes: { skyTop: 0x080c16, skyBottom: 0x1e2a3a, far: 0x141c26, mid: 0x1e2834, fog: 0x7a90a0, accent: 0xd8b060, moon: { x: 300, y: 20, r: 9 } },
  market: { skyTop: 0x0a0c14, skyBottom: 0x26302a, far: 0x161c1a, mid: 0x222a26, fog: 0x88a090, accent: 0x6ac07a },
  hospital: { skyTop: 0x081016, skyBottom: 0x1e3436, far: 0x121e22, mid: 0x1c2a2e, fog: 0x88aaa8, accent: 0xe04040, moon: { x: 60, y: 24, r: 10 } },
  police: { skyTop: 0x080a18, skyBottom: 0x1c2242, far: 0x141830, mid: 0x1e2440, fog: 0x8090c0, accent: 0x4a7aff },
  checkpoint: { skyTop: 0x0a0c0c, skyBottom: 0x30301e, far: 0x1a1c14, mid: 0x26281c, fog: 0xa0a080, accent: 0x9ab04a },
  gas: { skyTop: 0x0c0a10, skyBottom: 0x382a1a, far: 0x1c1812, mid: 0x2a241a, fog: 0xa89070, accent: 0xf0a030, moon: { x: 340, y: 22, r: 9 } },
  outpost: { skyTop: 0x0c0c18, skyBottom: 0x40302a, far: 0x1a1820, mid: 0x262230, fog: 0xc0a080, accent: 0xf5d76e },
};

/** 區域 id → 插圖（沒有專屬圖的區域退回據點） */
export function illustrationFor(zone: string | undefined): IllustrationId {
  return zone && zone in MOODS ? (zone as IllustrationId) : 'outpost';
}

export function ensureIllustration(scene: Phaser.Scene, id: IllustrationId): string {
  const key = `illus_${id}`;
  if (scene.textures.exists(key)) return key;
  paint(scene, key, id, ILLUS_W, ILLUS_H, LANDMARK_GY);
  return key;
}

/**
 * 主選單的整張背景：畫成 320×180、顯示時放大 2 倍（像素粗一點，和章節插圖同一套畫法）。
 * 據點的燈還亮著，霧裡的屍群往這邊走。
 */
export function ensureMenuBackdrop(scene: Phaser.Scene): string {
  const key = 'illus_menu';
  if (!scene.textures.exists(key)) paint(scene, key, 'outpost', 320, 180, 150, { hordes: 8, skylineTop: 112, landmarkX: -14, moon: { x: 262, y: 30, r: 12 } });
  return key;
}

function paint(
  scene: Phaser.Scene,
  key: string,
  id: IllustrationId,
  w: number,
  h: number,
  gy: number,
  o: { hordes?: number; skylineTop?: number; landmarkX?: number; moon?: Mood['moon'] } = {},
): void {
  const m = o.moon ? { ...MOODS[id], moon: o.moon } : MOODS[id];
  W = w;
  H = h;
  GY = gy;
  canvasTexture(scene, key, w, h, (p) => {
    sky(p, m);
    if (o.skylineTop !== undefined) skyline(p, tone(m.far, -0.2), o.skylineTop - 40, 60, 110, 0.02);
    skyline(p, m.far, GY - 42, 30, 58, 0.03);
    // 地標固定畫在 400 寬的座標系：平移到畫面中間偏左、貼齊地面
    p.ox = o.landmarkX ?? Math.round((w - ILLUS_W) / 2);
    p.oy = GY - LANDMARK_GY;
    LANDMARK[id](p, m);
    p.ox = 0;
    p.oy = 0;
    ground(p, m);
    fog(p, m);
    hordes(p, id, o.hordes);
    vignette(p);
  });
  W = ILLUS_W;
  H = ILLUS_H;
  GY = LANDMARK_GY;
}

// ── 共用圖層 ─────────────────────────────────────

function sky(p: Painter, m: Mood): void {
  p.gradient(0, 0, W, GY, m.skyTop, m.skyBottom, 8);
  for (let i = 0; i < 46; i++) {
    const x = p.rnd.between(0, W - 1);
    const y = p.rnd.between(0, 50);
    p.px(x, y, 0xffffff, p.rnd.realInRange(0.15, 0.6));
  }
  if (m.moon) {
    const { x, y, r } = m.moon;
    p.circle(x, y, r + 6, mix(m.skyTop, 0xe8e0c0, 0.08));
    p.circle(x, y, r + 3, mix(m.skyTop, 0xe8e0c0, 0.16));
    p.circle(x, y, r, 0xe8e0c8);
    p.circle(x + 3, y - 2, Math.max(2, r - 3), 0xd0c8b0);
    p.px(x - 3, y + 2, 0xb8b098);
    p.px(x - 4, y + 3, 0xb8b098);
    p.px(x + 2, y + 4, 0xc0b8a0);
  }
}

/** 遠景天際線：隨機高樓、水塔、天線，零星亮窗 */
function skyline(p: Painter, color: number, baseY: number, minH: number, maxH: number, litChance: number): void {
  let x = -4;
  while (x < W) {
    const w = p.rnd.between(14, 34);
    const h = p.rnd.between(minH, maxH);
    const top = baseY + 40 - h;
    p.rect(x, top, w, GY - top, color);
    p.rect(x, top, w, 1, tone(color, 0.12));
    if (p.rnd.frac() < 0.3) p.rect(x + 3, top - 6, 6, 6, color);
    if (p.rnd.frac() < 0.25) p.line(x + w - 4, top, x + w - 4, top - 10, color);
    for (let wy = top + 4; wy < GY - 6; wy += 5)
      for (let wx = x + 2; wx < x + w - 2; wx += 4) if (p.rnd.frac() < litChance) p.rect(wx, wy, 2, 2, WIN_DIM, 0.8);
    x += w + p.rnd.between(-2, 3);
  }
}

function ground(p: Painter, m: Mood): void {
  const road = mix(m.mid, 0x4a4a50, 0.5);
  p.gradient(0, GY, W, H - GY, tone(road, 0.05), tone(road, -0.35), 4);
  p.rect(0, GY, W, 2, tone(road, 0.3));
  p.rect(0, GY + 2, W, 1, tone(road, -0.4));
  // 路面裂縫、碎石、反光水窪
  for (let i = 0; i < 60; i++) p.px(p.rnd.between(0, W), p.rnd.between(GY + 4, H - 1), tone(road, p.rnd.frac() < 0.5 ? -0.3 : 0.15));
  for (let i = 0; i < 4; i++) p.ellipse(p.rnd.between(20, W - 20), p.rnd.between(GY + 8, H - 4), p.rnd.between(6, 14), 1, mix(road, m.fog, 0.4), 0.6);
  for (let x = 8; x < W; x += 34) p.rect(x, GY + 10, 14, 1, mix(road, 0xc8b060, 0.45));
}

function fog(p: Painter, m: Mood): void {
  for (let band = 0; band < 3; band++) {
    const y = GY - 14 + band * 7;
    for (let x = 0; x < W; x += 2) {
      const wave = Math.sin(x * 0.04 + band * 1.7) * 3 + Math.sin(x * 0.11 + band) * 1.5;
      const h = 4 + Math.round(wave);
      for (let j = 0; j < h; j++) if ((x + j) % 4 === band % 2 * 2 || p.rnd.frac() < 0.15) p.px(x + (j % 2), y + j, m.fog, 0.16 + band * 0.04);
    }
  }
}

/** 畫面四周壓暗，視線集中在中間 */
function vignette(p: Painter): void {
  for (let i = 0; i < 10; i++) {
    const a = 0.09 * (1 - i / 10);
    p.rect(i, 0, 1, H, 0x000000, a * 2);
    p.rect(W - 1 - i, 0, 1, H, 0x000000, a * 2);
    p.rect(0, i, W, 1, 0x000000, a);
    p.rect(0, H - 1 - i, W, 1, 0x000000, a * 1.5);
  }
}

// ── 霧屍剪影 ─────────────────────────────────────

const ZOMBIE_SIL: string[][] = [
  ['..##....', '.####...', '..##.###', '.######.', '.####...', '..###...', '..###...', '..#.#...', '.#..#...', '.#...#..'],
  ['...##...', '..####..', '...##...', '.######.', '#.####.#', '..####..', '..####..', '..#..#..', '..#..#..', '.##..##.'],
  ['..##....', '.####...', '.##.####', '.####...', '#####...', '.####...', '.###....', '.#.#....', '#..#....', '#...#...'],
];

function zombie(p: Painter, x: number, foot: number, kind: number, color: number, eyes = true): void {
  const rows = ZOMBIE_SIL[kind % ZOMBIE_SIL.length];
  const s = 2;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') p.rect(x + i * s, foot - (rows.length - j) * s, s, s, color);
  });
  if (eyes) p.px(x + 5, foot - rows.length * s + 2, 0xc8e05a, 0.9);
}

function hordes(p: Painter, id: IllustrationId, n?: number): void {
  const count = n ?? (id === 'outpost' ? 5 : 9);
  for (let i = 0; i < count; i++) {
    const far = i % 3 === 0;
    const x = id === 'outpost' ? Math.round(W * 0.58) + Math.round((i * W * 0.4) / count) + p.rnd.between(-6, 6) : p.rnd.between(10, W - 24);
    const foot = far ? GY + 2 : GY + p.rnd.between(6, 14);
    zombie(p, x, foot, p.rnd.between(0, 2), far ? 0x15131a : 0x060508, !far);
  }
}

// ── 小物件 ──────────────────────────────────────

function windows(p: Painter, x: number, y: number, cols: number, rows: number, w: number, h: number, gx: number, gy: number, lit: number, bars = false): void {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const on = p.rnd.frac() < lit;
      p.window(x + c * (w + gx), y + r * (h + gy), w, h, { lit: on, broken: !on && p.rnd.frac() < 0.2, bars });
    }
}

function glow(p: Painter, cx: number, cy: number, r: number, c: number, a = 0.1): void {
  for (let i = 3; i >= 1; i--) p.circle(cx, cy, Math.round((r * i) / 3), c, a);
}

function car(p: Painter, x: number, y: number, body: number, lights?: { a: number; b: number }): void {
  p.box(x + 6, y - 14, 22, 7, tone(body, -0.1));
  p.rect(x + 8, y - 12, 8, 4, 0x2a3440);
  p.rect(x + 18, y - 12, 8, 4, 0x2a3440);
  p.box(x, y - 8, 36, 7, body);
  p.circle(x + 8, y - 1, 3, OUTLINE);
  p.circle(x + 28, y - 1, 3, OUTLINE);
  p.px(x + 8, y - 1, 0x606060);
  p.px(x + 28, y - 1, 0x606060);
  if (lights) {
    p.rect(x + 12, y - 16, 5, 2, lights.a);
    p.rect(x + 17, y - 16, 5, 2, lights.b);
    glow(p, x + 14, y - 16, 14, lights.a, 0.07);
    glow(p, x + 20, y - 16, 14, lights.b, 0.07);
  }
}

function sign(p: Painter, x: number, y: number, w: number, h: number, c: number): void {
  p.box(x, y, w, h, c, { light: 0.35 });
  glow(p, x + w / 2, y + h / 2, w * 0.6, c, 0.06);
  // 招牌上的「字」：幾個亮塊
  for (let i = x + 3; i < x + w - 3; i += 5) p.rect(i, y + 2, 3, h - 4, tone(c, 0.55));
}

// ── 各區域地標 ───────────────────────────────────

const LANDMARK: Record<IllustrationId, (p: Painter, m: Mood) => void> = {
  school(p) {
    const wall = 0x6a6258;
    // 三層樓長校舍＋中央鐘樓
    p.box(70, 52, 260, 52, wall);
    p.rect(70, 52, 260, 3, tone(wall, 0.2));
    for (let f = 0; f < 3; f++) p.rect(71, 68 + f * 14, 258, 2, tone(wall, -0.2));
    windows(p, 76, 57, 22, 3, 7, 8, 4.4, 6, 0.08);
    p.box(178, 30, 44, 74, tone(wall, 0.06));
    p.box(186, 18, 28, 14, tone(wall, 0.1));
    p.circle(200, 25, 5, 0xe8e0c8);
    p.circle(200, 25, 4, 0xd0c8b8);
    p.line(200, 25, 200, 22, OUTLINE);
    p.line(200, 25, 202, 26, OUTLINE);
    p.box(190, 82, 20, 22, 0x2a2420);
    // 旗桿、籃球架、圍牆
    p.rect(40, 30, 1, 74, 0x9a9a9a);
    p.rect(41, 31, 12, 7, 0x8a2a2a);
    p.rect(41, 34, 12, 1, 0x5a1a1a);
    p.rect(350, 60, 2, 44, 0x5a5a5a);
    p.box(344, 56, 16, 10, 0xd8d8d8);
    p.rect(348, 66, 8, 1, 0xd05a2a);
    for (let x = 0; x < ILLUS_W; x += 4) p.rect(x, 94, 1, 10, 0x3a3a40);
    p.rect(0, 94, ILLUS_W, 1, 0x4a4a50);
    p.rect(0, 99, ILLUS_W, 1, 0x3a3a40);
  },
  downtown(p) {
    // 大樓群（破窗、冒煙）
    const cols = [0x3a3036, 0x2e2a34, 0x40363a];
    [
      [20, 20, 50],
      [80, 8, 40],
      [126, 30, 56],
      [270, 14, 46],
      [324, 26, 60],
    ].forEach(([x, top, w], i) => {
      const c = cols[i % cols.length];
      p.box(x, top, w, LANDMARK_GY - top, c);
      windows(p, x + 4, top + 5, Math.floor((w - 6) / 7), Math.floor((LANDMARK_GY - top - 12) / 9), 4, 6, 3, 3, 0.05);
    });
    // 火光與濃煙
    glow(p, 200, 80, 60, 0xff7a3a, 0.08);
    for (let i = 0; i < 26; i++) p.circle(196 + Math.round(Math.sin(i * 0.6) * 8) + i, 70 - i * 3, 6 + (i >> 2), mix(0x2a2024, 0x5a4a48, i / 30), 0.55);
    // 翻覆的軍車（側躺）
    p.box(160, 78, 70, 22, 0x4a5230);
    p.box(150, 84, 12, 16, 0x3e4428);
    p.rect(166, 82, 56, 2, 0x5a6238);
    p.circle(176, 76, 6, OUTLINE);
    p.circle(214, 76, 6, OUTLINE);
    p.circle(176, 76, 3, 0x3a3a3a);
    p.circle(214, 76, 3, 0x3a3a3a);
    for (let i = 0; i < 12; i++) p.rect(196 + p.rnd.between(-20, 20), 96 - p.rnd.between(0, 14), 2, 3, i % 2 ? 0xffb040 : 0xff6a20);
    // 紅綠燈
    p.rect(110, 46, 2, 58, 0x3a3a3a);
    p.box(106, 40, 10, 22, 0x222222);
    p.circle(111, 45, 2, 0xff3a2a);
    glow(p, 111, 45, 8, 0xff3a2a, 0.12);
  },
  nightmarket(p, m) {
    // 後排老公寓
    p.box(0, 34, 140, 70, 0x2e2430);
    p.box(260, 28, 140, 76, 0x2a2232);
    windows(p, 6, 40, 12, 3, 6, 7, 5, 6, 0.12, true);
    windows(p, 266, 34, 12, 4, 6, 7, 5, 5, 0.1, true);
    // 招牌
    sign(p, 10, 58, 34, 10, 0xe04a5a);
    sign(p, 280, 50, 40, 12, 0x3ac0a0);
    sign(p, 330, 70, 30, 10, 0xf0b030);
    // 攤位頂棚（紅白條紋）
    for (let s = 0; s < 4; s++) {
      const x = 40 + s * 82;
      p.rect(x, 74, 66, 4, OUTLINE);
      for (let i = 0; i < 64; i += 8) p.rect(x + 1 + i, 75, 4, 6, i % 16 ? 0xe8e0d0 : 0xc0303a);
      p.rect(x + 2, 81, 1, 23, 0x3a3030);
      p.rect(x + 63, 81, 1, 23, 0x3a3030);
      p.box(x + 4, 92, 58, 12, 0x5a3a2a);
    }
    // 彩券行：紅底金字的大招牌
    p.box(146, 40, 110, 64, 0x3a2a2a);
    p.box(150, 44, 102, 16, 0xc8202a, { light: 0.3 });
    for (let i = 0; i < 6; i++) p.box(156 + i * 16, 47, 10, 10, 0xf0c040, { outline: null, light: 0.4 });
    glow(p, 200, 52, 60, 0xe04a5a, 0.06);
    p.rect(162, 66, 78, 38, 0x1a1418);
    for (let j = 68; j < 104; j += 2) p.rect(162, j, 78, 1, 0x2e2a2e);
    p.rect(186, 76, 30, 28, WIN);
    glow(p, 200, 90, 30, WIN, 0.08);
    // 燈籠串
    for (let k = 0; k < 2; k++) {
      p.wire(0, 30 + k * 8, ILLUS_W, 40 + k * 10, 10, 0x1a1418);
      for (let x = 12 + k * 14; x < ILLUS_W; x += 28) {
        const y = Math.round(30 + k * 8 + ((40 + k * 10 - (30 + k * 8)) * x) / ILLUS_W + Math.sin((x / ILLUS_W) * Math.PI) * 10);
        p.ellipse(x, y + 4, 3, 4, m.accent);
        p.rect(x - 1, y + 1, 3, 1, 0xf0c040);
        glow(p, x, y + 4, 9, m.accent, 0.07);
      }
    }
  },
  homes(p) {
    // 一排透天厝（窄、鐵窗、頂樓水塔）
    const walls = [0x8a8070, 0x6a7078, 0x7a6a5a, 0x5e6a60, 0x8a7a6a, 0x6a6470];
    let x = 10;
    walls.forEach((c, i) => {
      const w = 56 + (i % 2) * 8;
      const top = 30 + ((i * 13) % 20);
      p.box(x, top, w, LANDMARK_GY - top, c);
      p.rect(x, top + 2, w, 1, tone(c, -0.15));
      for (let f = top + 8; f < LANDMARK_GY - 26; f += 18) {
        p.window(x + 8, f, w - 16, 11, { lit: (i === 3 && f === top + 8) || p.rnd.frac() < 0.08, bars: true });
        p.rect(x + 4, f + 14, w - 8, 2, tone(c, -0.3));
      }
      // 一樓鐵捲門
      p.rect(x + 6, LANDMARK_GY - 22, w - 12, 22, 0x4a4c50);
      for (let j = LANDMARK_GY - 21; j < LANDMARK_GY; j += 2) p.rect(x + 6, j, w - 12, 1, 0x3a3c40);
      p.box(x + w - 20, top - 10, 14, 10, 0xb0b4b8);
      x += w + 2;
    });
    // 二樓亮窗裡有人在敲窗
    const lx = 10 + 3 * 68 - 2 + 8;
    glow(p, lx + 20, 52, 26, WIN, 0.08);
    p.rect(lx + 16, 47, 6, 9, 0x2a1c14);
    p.circle(lx + 19, 46, 3, 0x2a1c14);
    p.rect(lx + 22, 48, 3, 2, 0x2a1c14);
  },
  market(p) {
    // 大賣場＋停車場
    p.box(60, 40, 280, 64, 0x5a6058);
    p.box(60, 40, 280, 10, 0x2e7a4a, { light: 0.3 });
    for (let i = 0; i < 9; i++) p.rect(90 + i * 24, 42, 14, 6, i % 2 ? 0xe8e0c0 : 0xf0c040);
    glow(p, 200, 46, 80, 0x6ac07a, 0.04);
    // 鐵捲門（一扇半開）
    for (let d = 0; d < 4; d++) {
      const x = 82 + d * 64;
      const open = d === 2 ? 10 : 0;
      p.rect(x, 62, 48, 42, 0x0c0c10);
      p.rect(x, 62, 48, 42 - open, 0x6a6c70);
      for (let j = 63; j < 104 - open; j += 2) p.rect(x, j, 48, 1, 0x56585c);
      if (open) glow(p, x + 24, 100, 20, WIN, 0.1);
    }
    // 推車
    for (const cx of [30, 352]) {
      p.rect(cx, 92, 16, 1, 0x9aa0a8);
      for (let i = 0; i < 16; i += 3) p.rect(cx + i, 92, 1, 7, 0x9aa0a8);
      p.rect(cx, 99, 16, 1, 0x9aa0a8);
      p.px(cx + 2, 102, 0x9aa0a8);
      p.px(cx + 13, 102, 0x9aa0a8);
    }
  },
  hospital(p, m) {
    const wall = 0xb8bcb8;
    p.box(90, 14, 200, 90, wall);
    p.box(70, 50, 30, 54, tone(wall, -0.15));
    p.box(280, 40, 40, 64, tone(wall, -0.12));
    windows(p, 98, 22, 13, 6, 9, 7, 5.6, 4.2, 0.03, false);
    // 唯一亮著的窗
    p.window(156, 44, 9, 7, { lit: true });
    glow(p, 160, 48, 18, WIN, 0.1);
    // 紅十字招牌
    p.box(176, 2, 28, 16, 0xf0f0f0);
    p.rect(187, 5, 6, 10, m.accent);
    p.rect(182, 8, 16, 4, m.accent);
    glow(p, 190, 10, 26, m.accent, 0.08);
    // 急診入口與救護車
    p.box(150, 86, 80, 6, 0xd04040);
    p.rect(160, 92, 60, 12, 0x101418);
    p.box(250, 86, 46, 16, 0xe8e8e8);
    p.box(286, 80, 14, 22, 0xe8e8e8);
    p.rect(262, 90, 16, 3, m.accent);
    p.rect(268, 87, 4, 9, m.accent);
    p.circle(258, 102, 3, OUTLINE);
    p.circle(290, 102, 3, OUTLINE);
  },
  police(p, m) {
    const wall = 0x5a6070;
    p.box(80, 30, 240, 74, wall);
    p.box(80, 30, 240, 8, tone(wall, -0.3));
    windows(p, 88, 44, 16, 2, 9, 9, 5.5, 8, 0.04, true);
    p.box(180, 70, 40, 34, 0x30343c);
    p.rect(184, 74, 32, 30, 0x0c0e12);
    p.box(170, 62, 60, 8, 0x2a3a6a);
    for (let i = 0; i < 8; i++) p.rect(176 + i * 6, 64, 4, 4, 0xe0e4f0);
    // 旗桿
    p.rect(60, 20, 1, 84, 0x9a9a9a);
    p.rect(61, 21, 12, 8, 0x3a4aa0);
    // 警車（警示燈還在閃）
    car(p, 250, 103, 0xe8e8ec, { a: 0xff3030, b: m.accent });
    car(p, 30, 103, 0x2a2e3a, { a: m.accent, b: 0xff3030 });
  },
  checkpoint(p) {
    // 探照燈光束
    for (let i = 0; i < 70; i++) p.line(300, 40, 120 + i, 0, 0xf0f0c0, 0.012);
    // 瞭望台
    p.rect(290, 44, 2, 60, 0x4a4a3a);
    p.rect(314, 44, 2, 60, 0x4a4a3a);
    p.line(290, 60, 316, 90, 0x4a4a3a);
    p.line(316, 60, 290, 90, 0x4a4a3a);
    p.box(284, 34, 38, 12, 0x5a6038);
    p.rect(286, 30, 34, 4, 0x3a4028);
    p.circle(300, 40, 3, 0xf8f8d8);
    // 直升機剪影
    p.rect(90, 18, 30, 8, 0x12140e);
    p.rect(120, 20, 30, 2, 0x12140e);
    p.rect(148, 16, 2, 8, 0x12140e);
    p.rect(70, 15, 70, 1, 0x12140e);
    p.rect(98, 26, 1, 3, 0x12140e);
    p.rect(110, 26, 1, 3, 0x12140e);
    p.rect(94, 29, 20, 1, 0x12140e);
    // 鐵絲網、沙包、水泥護欄、軍車
    for (let x = 0; x < ILLUS_W; x += 6) p.rect(x, 70, 1, 34, 0x3a3c34);
    for (let x = 0; x < ILLUS_W; x += 3) p.px(x, 70 + ((x / 3) % 2), 0x5a5c54);
    p.rect(0, 70, ILLUS_W, 1, 0x4a4c44);
    p.box(20, 84, 90, 20, 0x4a5230);
    p.box(100, 76, 26, 28, 0x40482a);
    p.rect(26, 80, 74, 4, 0x3a4024);
    p.circle(40, 102, 5, OUTLINE);
    p.circle(92, 102, 5, OUTLINE);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 7 - r; i++) p.box(180 + i * 12 + r * 6, 96 - r * 6, 13, 7, 0x8a7a54, { light: 0.2 });
    for (let i = 0; i < 4; i++) p.box(320 + i * 20, 92, 18, 12, 0x9a9a92);
  },
  gas(p, m) {
    // 加油站頂棚、油槍、高立招牌
    p.box(80, 48, 220, 10, 0xe8e8e8);
    p.rect(81, 56, 218, 2, m.accent);
    glow(p, 190, 64, 70, 0xf0f0e0, 0.06);
    for (const x of [100, 270]) p.box(x, 58, 6, 46, 0xd0d0d0);
    for (const x of [140, 214]) {
      p.box(x, 80, 16, 24, 0xc04040);
      p.rect(x + 3, 84, 10, 5, 0x1a1a1a);
      p.rect(x + 16, 86, 2, 10, 0x2a2a2a);
    }
    p.rect(340, 20, 4, 84, 0x5a5a5a);
    p.box(326, 12, 32, 26, m.accent);
    p.rect(330, 16, 24, 8, 0xffffff);
    p.rect(330, 27, 24, 7, 0x2a2a2a);
    p.box(20, 64, 50, 40, 0x6a6058);
    p.window(28, 72, 34, 16, { lit: false, broken: true });
    // 地上的油漬與翻倒的油桶
    p.ellipse(180, 104, 26, 2, 0x0a0a0c, 0.7);
    p.box(232, 94, 14, 10, 0xc03a2a);
  },
  outpost(p, m) {
    // 據點：木板與鐵皮拼成的牆、牆上的燈、站崗的人
    for (let x = 30; x < 220; x += 10) p.box(x, 50 + ((x * 7) % 9), 11, 54, (x / 10) % 2 ? 0x6a4a30 : 0x5a5a5e);
    p.rect(30, 66, 190, 3, 0x3a2a1a);
    p.rect(30, 86, 190, 3, 0x3a2a1a);
    for (let i = 0; i < 9; i++) p.line(220 + i * 3, 104, 230 + i * 3, 86, 0x8a7a5a);
    glow(p, 120, 46, 70, m.accent, 0.06);
    glow(p, 120, 46, 30, m.accent, 0.1);
    p.rect(118, 38, 2, 12, 0x2a2a2a);
    p.box(114, 34, 10, 6, 0xf5d76e, { light: 0.4 });
    // 天線
    p.rect(60, 4, 1, 50, 0x3a3a3a);
    p.line(56, 10, 64, 10, 0x3a3a3a);
    p.line(57, 18, 63, 18, 0x3a3a3a);
    p.px(60, 3, 0xff3030);
    // 牆上的倖存者剪影
    for (const [x, h] of [
      [86, 14],
      [140, 16],
      [168, 13],
    ]) {
      const top = 50 - h;
      p.rect(x, top + 4, 6, h - 4, 0x0e0c10);
      p.circle(x + 3, top + 2, 3, 0x0e0c10);
      p.rect(x + 6, top + 6, 8, 2, 0x0e0c10);
    }
  },
};
