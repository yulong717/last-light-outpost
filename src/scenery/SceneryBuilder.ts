import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GROUND_Y, LANE_BOTTOM, LANE_TOP, depthForY } from '../config';
import { OUTLINE, Painter, canvasTexture, mix, tone } from '../art/Painter';
import { LAMP_HEAD, PROPS, propKey } from '../art/PropArt';
import {
  PROP_KIND,
  type FacadeStyle,
  type FarStyle,
  type FloorStyle,
  type InteractKind,
  type InteriorStyle,
  type LocationTheme,
  type Piece,
  type PropWeights,
  type Setting,
} from '../data/scenery';
import { pixelText } from '../utils/text';

/**
 * 場景生成：依地點主題畫出天空、遠景、中景、主建築（或室內牆面）、地板，
 * 再把場景佈置（事件寫到的東西）與隨機道具擺到地面帶上。
 *
 * 背景層全部畫成 Canvas 貼圖（一層一張），不是幾百個方塊物件，捲動很便宜。
 * 室外有 3 層視差：遠景 0.2、中景 0.5、建築 1.0；天空固定。
 */

export interface PlacedProp {
  id: string;
  x: number;
  y: number;
  kind: InteractKind | null;
  flip: boolean;
  frame: number;
  role?: Piece['role'];
  /** 貼牆的道具（不擋路、繪製在角色後面） */
  wall: boolean;
  scale: number;
}

export interface SceneryOptions {
  theme: LocationTheme;
  setting: Setting;
  facade?: FacadeStyle;
  interior?: InteriorStyle;
  mood?: 'normal' | 'dim' | 'dark';
  worldW: number;
  seed: string;
  /** 事件指定的擺件 */
  pieces?: Piece[];
  /** 隨機裝飾的數量倍率（0 = 不放） */
  decor?: number;
  /** 隨機互動道具的數量 */
  extras?: number;
  /** 比例座標（0..1）對應的世界 x 範圍；預設整個世界 */
  span?: [number, number];
  /** 這些 x 範圍不要放隨機道具（出生點、出口、據點建築） */
  keepClear?: [number, number][];
  /** 室內是否自動在天花板掛燈 */
  ceilingLights?: boolean;
}

export interface SceneryResult {
  setting: Setting;
  props: PlacedProp[];
  /** 室內燈光暗度 0..1（PropSystem 斷電時會再加深） */
  darkness: number;
  /** 室內燈光顏色 */
  light: number;
}

const WALL_Y = GROUND_Y + 1;

export function laneY(lane: Piece['lane'], rnd: Phaser.Math.RandomDataGenerator): number {
  if (typeof lane === 'number') return lane;
  switch (lane) {
    case 'wall':
      return WALL_Y;
    case 'front':
      return LANE_BOTTOM - rnd.between(2, 10);
    case 'mid':
      return Math.round((LANE_TOP + LANE_BOTTOM) / 2) + rnd.between(-10, 10);
    case 'back':
    default:
      return LANE_TOP + rnd.between(2, 12);
  }
}

/** 道具是不是貼牆的（門、窗、貨架、置物櫃…） */
const WALL_PROPS = new Set(['door', 'glasswin', 'shelf', 'fridge', 'locker', 'gunlocker', 'filecab', 'fusebox', 'wardrobe', 'shrine', 'tv', 'cellbars', 'noticeboard', 'redcross', 'shutter', 'lamppost', 'watchtower', 'billboard', 'hoop', 'flagpole', 'barricadedoor']);

export function buildScenery(scene: Phaser.Scene, o: SceneryOptions): SceneryResult {
  const rnd = new Phaser.Math.RandomDataGenerator([o.seed]);
  const t = o.theme;
  const W = o.worldW;
  const uid = `${o.seed}-${Math.floor(Math.random() * 1e9)}`;
  const signs: Sign[] = [];
  let darkness = 0;
  if (o.setting === 'ext') {
    drawSky(scene, t, uid);
    drawFar(scene, t.far, t, W, uid, rnd);
    drawMid(scene, t, W, uid, rnd);
    drawFacade(scene, o.facade ?? t.facade, t, W, uid, rnd, signs);
    // 頂樓：腳下是水泥樓板，不是操場
    drawGround(scene, o.facade === 'rooftop' ? 'concrete' : t.floorExt, t, W, uid, rnd, o.facade ?? t.facade);
    darkness = o.mood === 'dark' ? 0.4 : o.mood === 'dim' ? 0.2 : 0.08;
  } else {
    drawInterior(scene, o.interior ?? t.interior, t, W, uid, rnd, signs);
    drawFloor(scene, t.floorInt, t, W, uid, rnd);
    darkness = o.mood === 'dark' ? 0.5 : o.mood === 'dim' ? 0.32 : 0.18;
  }
  for (const s of signs) {
    pixelText(scene, s.x, s.y, s.text, s.size ?? 9, s.color).setOrigin(0.5).setDepth(-64).setStroke('#000000', 2);
  }

  // ── 擺件 ──
  const span = o.span ?? [0, W];
  const props: PlacedProp[] = [];
  const toX = (x: number) => (x <= 1 ? span[0] + (span[1] - span[0]) * x : x);
  for (const pc of o.pieces ?? []) {
    const wall = pc.lane === 'wall' || (pc.lane === undefined && WALL_PROPS.has(pc.prop));
    props.push({
      id: pc.prop,
      x: Math.round(toX(pc.x)),
      y: laneY(wall ? 'wall' : pc.lane, rnd),
      kind: pc.kind === undefined ? PROP_KIND[pc.prop] ?? null : pc.kind,
      flip: !!pc.flip,
      frame: pc.frame ?? 0,
      role: pc.role,
      wall,
      scale: pc.scale ?? 1,
    });
  }
  const taken = (x: number, w: number, y: number, wall: boolean) =>
    props.some((p) => p.wall === wall && Math.abs(p.x - x) < (w + PROPS[p.id].w) / 2 + 6 && (wall || Math.abs(p.y - y) < 22)) ||
    (o.keepClear ?? []).some(([a, b]) => x + w / 2 > a && x - w / 2 < b);

  const scatter = (weights: PropWeights, n: number, laneFor: (id: string) => Piece['lane'], interactive: boolean) => {
    const ids = Object.keys(weights);
    if (!ids.length) return;
    for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
      const id = weighted(rnd, ids, (k) => weights[k]);
      if (!id || !PROPS[id]) continue;
      const wall = WALL_PROPS.has(id);
      const lane = wall ? 'wall' : laneFor(id);
      const x = rnd.between(Math.max(span[0], 40), Math.min(span[1], W - 40));
      const y = laneY(lane, rnd);
      if (taken(x, PROPS[id].w, y, wall)) continue;
      const kind = interactive ? PROP_KIND[id] ?? null : null;
      props.push({ id, x, y, kind, flip: rnd.frac() < 0.5, frame: 0, wall, scale: 1 });
      i++;
    }
  };
  const density = (span[1] - span[0]) / 640;
  const ext = o.setting === 'ext';
  // 室內貼牆道具（貨架、置物櫃、門）
  if (!ext && o.decor !== 0) scatter(t.wallInt, Math.round(6 * density), () => 'wall', true);
  // 隨機互動道具（油桶、車、木箱）
  if (o.extras) scatter(ext ? t.extrasExt : t.extrasInt, Math.round(o.extras), (id) => (id.startsWith('car') || id === 'truck' || id === 'ambulance' || id === 'policecar' ? (rnd.frac() < 0.5 ? 'back' : 'front') : rnd.pick(['back', 'mid', 'front'])), true);
  // 純裝飾
  const decorN = Math.round((o.decor ?? 1) * 7 * density);
  if (decorN > 0) scatter(ext ? t.decorExt : t.decorInt, decorN, () => (rnd.frac() < 0.6 ? 'back' : rnd.pick(['mid', 'front'])), false);

  // 室內天花板燈：每 130px 一盞（可以射掉）
  if (!ext && o.ceilingLights !== false) {
    for (let x = span[0] + 90; x < span[1] - 20; x += 210 + rnd.between(-20, 20)) {
      props.push({ id: 'tubelight', x, y: Math.max(4, ceilingY(o.interior ?? t.interior)), kind: 'light', flip: false, frame: 0, wall: true, scale: 1 });
    }
  }
  return { setting: o.setting, props, darkness, light: t.light };
}

/** 只當背景用：把擺件全部畫成靜態圖片（事件卡背景） */
export function placeStaticProps(scene: Phaser.Scene, res: SceneryResult): void {
  for (const p of res.props) {
    const img = scene.add.image(p.x, p.y, propKey(p.id), p.frame).setFlipX(p.flip).setScale(p.scale);
    img.setOrigin(0.5, p.id === 'tubelight' ? 0 : 1);
    img.setDepth(p.wall ? 5 + p.x / 10000 : depthForY(p.y));
    if (p.id === 'tubelight' || p.id === 'lamppost') addLightGlow(scene, p, res.light);
  }
}

/** 燈的光暈與地上的光圈；回傳兩個物件好讓互動系統控制開關 */
export function addLightGlow(scene: Phaser.Scene, p: PlacedProp, color: number): Phaser.GameObjects.GameObject[] {
  const tube = p.id === 'tubelight';
  const hx = p.x + (tube ? 0 : p.flip ? -LAMP_HEAD.dx : LAMP_HEAD.dx);
  const hy = tube ? p.y + 8 : p.y + LAMP_HEAD.dy;
  const cone = scene.add.image(hx, hy, coneKey(scene, tube ? 70 : 90, (tube ? LANE_TOP + 30 : p.y + 20) - hy, color)).setOrigin(0.5, 0);
  cone.setBlendMode(Phaser.BlendModes.ADD).setDepth(42).setAlpha(tube ? 0.55 : 0.6);
  const pool = scene.add.ellipse(hx, tube ? LANE_TOP + 40 : p.y + 6, tube ? 110 : 120, tube ? 40 : 30, color, 0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
  return [cone, pool];
}

/** 由上往下打的光錐（抖色漸層） */
function coneKey(scene: Phaser.Scene, w: number, h: number, color: number): string {
  const key = `cone_${w}_${Math.round(h)}_${color}`;
  if (scene.textures.exists(key)) return key;
  canvasTexture(scene, key, w, Math.max(4, h), (p) => {
    const H = Math.max(4, h);
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const hw = 3 + (w / 2 - 3) * t;
      const a = 0.22 * (1 - t) + 0.03;
      for (let x = Math.round(w / 2 - hw); x < w / 2 + hw; x++) {
        if ((x + y) % 2 === 0 || t < 0.3) p.px(x, y, color, a);
      }
    }
  });
  return key;
}

function weighted(rnd: Phaser.Math.RandomDataGenerator, ids: string[], w: (k: string) => number): string | undefined {
  let total = 0;
  for (const id of ids) total += Math.max(0, w(id));
  if (total <= 0) return undefined;
  let r = rnd.frac() * total;
  for (const id of ids) {
    r -= Math.max(0, w(id));
    if (r < 0) return id;
  }
  return ids[ids.length - 1];
}

interface Sign {
  x: number;
  y: number;
  text: string;
  color: string;
  size?: number;
}

// ───────────────────── 室外 ─────────────────────

function layer(scene: Phaser.Scene, key: string, w: number, h: number, y: number, sf: number, depth: number, draw: (p: Painter) => void): void {
  canvasTexture(scene, key, w, h, draw);
  scene.add.image(0, y, key).setOrigin(0).setScrollFactor(sf, 1).setDepth(depth);
}

function drawSky(scene: Phaser.Scene, t: LocationTheme, uid: string): void {
  layer(scene, `sky-${uid}`, GAME_WIDTH, GROUND_Y, 0, 0, -100, (p) => {
    p.gradient(0, 0, GAME_WIDTH, GROUND_Y, t.sky[0], t.sky[1], 8);
    // 月亮被霧遮住一半
    p.circle(500, 40, 13, tone(t.sky[1], 0.35), 0.5);
    p.circle(500, 40, 10, tone(t.sky[1], 0.55), 0.6);
    // 雲層：抖色長條
    for (let i = 0; i < 6; i++) {
      const y = 20 + i * 22 + p.rnd.between(-6, 6);
      const x = p.rnd.between(-60, GAME_WIDTH - 100);
      p.dither(x, y, p.rnd.between(120, 260), p.rnd.between(3, 7), tone(t.sky[0], -0.3), 0.35);
    }
    // 地平線霧
    p.dither(0, GROUND_Y - 40, GAME_WIDTH, 40, tone(t.sky[1], 0.15), 0.3);
  });
}

function drawFar(scene: Phaser.Scene, style: FarStyle, t: LocationTheme, W: number, uid: string, rnd: Phaser.Math.RandomDataGenerator): void {
  const fw = Math.ceil(GAME_WIDTH + (W - GAME_WIDTH) * 0.2) + 20;
  const col = mix(t.sky[1], 0x0c0e14, 0.55);
  layer(scene, `far-${uid}`, fw, GROUND_Y, 0, 0.2, -90, (p) => {
    if (style === 'hills') {
      for (let x = 0; x < fw; x++) {
        const h = 34 + Math.sin(x * 0.013 + 1) * 14 + Math.sin(x * 0.041) * 6;
        p.rect(x, GROUND_Y - h, 1, h, col);
      }
      // 高壓電塔
      for (let x = 60; x < fw; x += 180 + rnd.between(0, 60)) {
        const top = GROUND_Y - 110;
        p.line(x, GROUND_Y - 30, x + 8, top, tone(col, -0.2));
        p.line(x + 16, GROUND_Y - 30, x + 8, top, tone(col, -0.2));
        p.rect(x - 4, top + 14, 24, 1, tone(col, -0.2));
        p.rect(x - 2, top + 26, 20, 1, tone(col, -0.2));
        p.wire(x + 8, top + 14, x + 188, top + 14, 10, tone(col, -0.1), 0.6);
      }
    } else {
      // 城市天際線：高低不一的大樓，零星亮燈
      for (let x = -10; x < fw; ) {
        const w = rnd.between(18, 44);
        const h = rnd.between(style === 'industrial' ? 30 : 50, style === 'industrial' ? 80 : 130);
        p.rect(x, GROUND_Y - h, w, h, tone(col, rnd.frac() * 0.06));
        if (rnd.frac() < 0.3) p.rect(x + Math.floor(w / 2), GROUND_Y - h - 10, 1, 10, col);
        for (let wy = GROUND_Y - h + 5; wy < GROUND_Y - 6; wy += 6) {
          for (let wx = x + 3; wx < x + w - 3; wx += 5) {
            if (rnd.frac() < 0.035) p.rect(wx, wy, 2, 2, 0xd8b060, 0.7);
          }
        }
        x += w + rnd.between(-4, 6);
      }
    }
  });
}

function drawMid(scene: Phaser.Scene, t: LocationTheme, W: number, uid: string, rnd: Phaser.Math.RandomDataGenerator): void {
  const mw = Math.ceil(GAME_WIDTH + (W - GAME_WIDTH) * 0.5) + 20;
  const col = mix(t.sky[1], 0x0c0e14, 0.72);
  layer(scene, `mid-${uid}`, mw, GROUND_Y, 0, 0.5, -80, (p) => {
    let last = -1;
    for (let x = 20; x < mw; x += rnd.between(90, 150)) {
      // 枯樹或電線桿
      if (rnd.frac() < 0.5) {
        p.rect(x, GROUND_Y - 90, 3, 90, col);
        p.rect(x - 8, GROUND_Y - 84, 19, 2, col);
        if (last >= 0) {
          p.wire(last, GROUND_Y - 83, x, GROUND_Y - 83, 8, tone(col, 0.05), 0.8);
          p.wire(last, GROUND_Y - 78, x, GROUND_Y - 78, 9, tone(col, 0.05), 0.6);
        }
        last = x;
      } else {
        const h = rnd.between(40, 70);
        p.rect(x, GROUND_Y - h, 3, h, col);
        for (let i = 0; i < 6; i++) p.line(x + 1, GROUND_Y - h + 10 + i * 4, x + 1 + rnd.between(-16, 16), GROUND_Y - h - rnd.between(0, 14) + i * 3, col);
      }
    }
    // 低矮建築剪影
    for (let x = 0; x < mw; x += rnd.between(60, 140)) {
      const h = rnd.between(24, 50);
      const w = rnd.between(40, 80);
      p.rect(x, GROUND_Y - h, w, h, tone(col, 0.04));
      p.rect(x - 2, GROUND_Y - h, w + 4, 2, tone(col, -0.2));
    }
    p.dither(0, GROUND_Y - 30, mw, 30, tone(t.sky[1], 0.05), 0.22);
  });
}

function drawFacade(
  scene: Phaser.Scene,
  style: FacadeStyle,
  t: LocationTheme,
  W: number,
  uid: string,
  rnd: Phaser.Math.RandomDataGenerator,
  signs: Sign[],
): void {
  layer(scene, `fac-${uid}`, W, GROUND_Y + 2, 0, 1, -70, (p) => {
    switch (style) {
      case 'gas':
        facadeGas(p, W, t, rnd, signs);
        break;
      case 'market':
        facadeMarket(p, W, t, rnd, signs);
        break;
      case 'homes':
        facadeHomes(p, W, t, rnd, signs);
        break;
      case 'hospital':
        facadeHospital(p, W, t, rnd, signs);
        break;
      case 'police':
        facadePolice(p, W, t, rnd, signs);
        break;
      case 'military':
        facadeMilitary(p, W, t, rnd);
        break;
      case 'school':
        facadeSchool(p, W, t, rnd, signs);
        break;
      case 'parking':
        facadeParking(p, W, t, rnd, signs);
        break;
      case 'rooftop':
        facadeRooftop(p, W, rnd, signs);
        break;
      case 'alley':
        facadeAlley(p, W, rnd, signs);
        break;
      case 'islandshop':
        facadeIslandShop(p, W, t, rnd, signs);
        break;
      case 'street':
      default:
        facadeStreet(p, W, t, rnd, signs);
    }
  });
}

const B = GROUND_Y;
/** 比例尺：1 公尺 ≈ 34px（角色 60px = 175cm）。一層樓約 3.2m ≈ 108px，畫面裡只看得到一樓和二樓的下半 */
const M = 34;
const FLOOR_H = Math.round(3.2 * M);

/** 鐵捲門：x,y 是左上，openTo 是捲到哪（0 = 全關，1 = 全開） */
function shutter(p: Painter, x: number, y: number, w: number, h: number, openTo: number): void {
  p.rect(x - 2, y - 8, w + 4, 8, 0x3a3f46);
  p.rect(x - 2, y - 8, w + 4, 1, 0x5a6068);
  p.rect(x, y, w, h, 0x07080a);
  const bottom = y + Math.round(h * (1 - openTo));
  for (let yy = y; yy < bottom; yy += 4) p.rect(x, yy, w, 3, yy % 8 === y % 8 ? 0x7a8088 : 0x6a7078);
  if (bottom < y + h) p.rect(x, bottom, w, 2, 0x4a5058);
  p.rect(x - 3, y, 3, h, 0x2a2e34);
  p.rect(x + w, y, 3, h, 0x2a2e34);
}

/** 冷氣室外機（80×55cm → 28×19） */
function acUnit(p: Painter, x: number, y: number): void {
  p.box(x, y, 28, 19, 0xb8bcc0);
  p.circle(x + 10, y + 9, 6, 0x6a7076);
  for (let i = 0; i < 3; i++) p.rect(x + 19, y + 4 + i * 4, 6, 1, 0x7a8086);
  p.rect(x + 2, y + 19, 2, 3, 0x5a5e64);
  p.rect(x + 24, y + 19, 2, 3, 0x5a5e64);
}

/** 二樓窗（1.2 × 1.4m → 41×48） */
function upperWindows(p: Painter, x: number, w: number, top: number, rnd: Phaser.Math.RandomDataGenerator, bars = false): void {
  const n = Math.max(1, Math.floor((w - 20) / 60));
  const gap = (w - n * 41) / (n + 1);
  for (let i = 0; i < n; i++) {
    const wx = Math.round(x + gap + i * (41 + gap));
    p.window(wx, top, 41, 48, { lit: rnd.frac() < 0.07, broken: rnd.frac() < 0.25, bars: bars || rnd.frac() < 0.35, blinds: rnd.frac() < 0.2 });
    if (rnd.frac() < 0.4) acUnit(p, wx + 6, top + 52);
  }
}

/** 一排店面：一樓鐵捲門＋招牌，上面是二樓窗戶；偶爾是倒塌的空地 */
function facadeStreet(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const names = ['五金行', '小吃', '藥局', '當舖', '網咖', '早餐', '機車行', '眼鏡', '自助餐', '理髮'];
  rnd.shuffle(names);
  let shop = 0;
  const signCols = [0xc83a2a, 0x2a6ac8, 0x3a9a50, 0xd8a020, 0x8a3ac0];
  for (let x = 0; x < W; ) {
    const w = rnd.between(4, 6) * M;
    if (rnd.frac() < 0.12) {
      // 倒塌的空地：瓦礫堆、露出的鋼筋
      for (let i = 0; i < 30; i++) p.rect(x + rnd.between(0, w - 16), B - rnd.between(4, 40), rnd.between(8, 22), rnd.between(4, 12), tone(t.wall, rnd.frac() * 0.2 - 0.1));
      for (let i = 0; i < 4; i++) p.line(x + 20 + i * 30, B - 30, x + 26 + i * 30, B - 90 - i * 10, 0x5a3a22);
      x += w;
      continue;
    }
    const wall = tone(t.wall, rnd.frac() * 0.25 - 0.1);
    p.box(x, 0, w, B, wall, { light: 0.08 });
    // 樓層分隔
    p.rect(x + 1, B - FLOOR_H - 4, w - 2, 4, tone(wall, -0.3));
    upperWindows(p, x, w, B - FLOOR_H - 72, rnd);
    // 招牌（70cm 高）
    const sc = signCols[rnd.between(0, signCols.length - 1)];
    p.box(x + 6, B - FLOOR_H + 4, w - 12, 24, sc);
    p.rect(x + 8, B - FLOOR_H + 6, w - 16, 1, tone(sc, 0.4));
    signs.push({ x: x + w / 2, y: B - FLOOR_H + 16, text: names[shop++ % names.length], color: '#f4ecd8', size: 11 });
    // 一樓：2.6m 高的鐵捲門
    const open = rnd.frac();
    shutter(p, x + 10, B - 88, w - 20, 88, open < 0.25 ? 0.35 : open < 0.4 ? 0.15 : 0);
    // 塗鴉
    if (rnd.frac() < 0.4) p.dither(x + 20, B - 60, rnd.between(30, 60), 16, rnd.pick([0xc83a2a, 0x3a9ae0, 0xe8e040]), 0.4, 0.7);
    x += w;
  }
  sidewalkTrim(p, W);
}

/** 透天厝：一樓騎樓與鐵捲門、二樓陽台鐵窗、冷氣機、直立招牌 */
function facadeHomes(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const tiles = [0xa89a88, 0x8a7a6a, 0xb8b0a0, 0x7a8a8a, 0x9a8070];
  for (let x = 0; x < W; ) {
    const w = Math.round(rnd.between(42, 50) * M / 10);
    const c = tiles[rnd.between(0, tiles.length - 1)];
    p.box(x, 0, w, B, c, { light: 0.06 });
    for (let y = 2; y < B - FLOOR_H; y += 5) p.rect(x + 1, y, w - 2, 1, tone(c, -0.08));
    // 二樓：凸出的陽台＋整片鐵窗
    const by = B - FLOOR_H - 4;
    p.rect(x + 2, by - 76, w - 4, 76, tone(c, -0.35));
    p.window(x + 8, by - 70, w - 16, 54, { lit: rnd.frac() < 0.08, glass: 0x1c2630 });
    for (let i = x + 6; i < x + w - 6; i += 5) p.rect(i, by - 72, 1, 70, 0x2a2a2a);
    p.rect(x + 4, by - 72, w - 8, 2, 0x2a2a2a);
    p.rect(x + 4, by - 40, w - 8, 1, 0x2a2a2a);
    p.box(x, by - 4, w, 8, tone(c, -0.2));
    if (rnd.frac() < 0.35) for (let i = 0; i < 4; i++) p.rect(x + 16 + i * 22, by - 60, 12, 18, rnd.pick([0xc83a2a, 0xe8e8e0, 0x3a6ac8]));
    if (rnd.frac() < 0.6) acUnit(p, x + w - 36, by - 100);
    // 一樓騎樓：前面兩根柱子，裡面暗暗的鐵捲門
    p.rect(x, B - FLOOR_H + 4, w, FLOOR_H - 4, tone(c, -0.55));
    const open = rnd.frac() < 0.25 ? 0.3 : 0;
    shutter(p, x + 18, B - 84, w - 36, 84, open);
    p.box(x, B - FLOOR_H + 4, 12, FLOOR_H - 4, tone(c, 0.05));
    p.box(x + w - 12, B - FLOOR_H + 4, 12, FLOOR_H - 4, tone(c, 0.05));
    // 直立招牌
    if (rnd.frac() < 0.35) {
      const sc = rnd.pick([0xc83a2a, 0x2a6ac8, 0x3a9a50]);
      p.box(x + w - 22, by - 150, 18, 90, sc);
      signs.push({ x: x + w - 13, y: by - 105, text: rnd.pick(['診所', '補習', '小吃', '茶']), color: '#ffffff', size: 9 });
    }
    x += w;
  }
  sidewalkTrim(p, W);
}

/** 加油站：5m 高的雨棚、便利商店、修車間、價目牌 */
function facadeGas(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  for (let x0 = 0; x0 < W; x0 += 760) {
    // 便利商店（3.6m 高）
    const sx = x0 + 330;
    const sw = 220;
    p.box(sx, B - 124, sw, 124, 0xd8d4c8);
    p.rect(sx + 1, B - 124, sw - 2, 22, 0x2a8a4a);
    p.rect(sx + 1, B - 104, sw - 2, 4, 0xe8a020);
    signs.push({ x: sx + sw / 2, y: B - 113, text: '便利商店', color: '#ffffff', size: 11 });
    for (let wx = sx + 10; wx < sx + sw - 50; wx += 52) p.window(wx, B - 92, 46, 76, { glass: 0x1a2a2a, lit: wx === sx + 62, broken: rnd.frac() < 0.4 });
    p.rect(sx + sw - 46, B - 80, 36, 80, OUTLINE);
    p.rect(sx + sw - 45, B - 79, 34, 79, 0x1a2830);
    // 修車間（兩個 3m 寬的車位）
    const gx = x0 + 570;
    p.box(gx, B - 140, 230, 140, 0x8a8478);
    p.rect(gx + 1, B - 140, 228, 10, 0x4a4a4a);
    signs.push({ x: gx + 115, y: B - 122, text: '修車保養', color: '#3a3a3a', size: 10 });
    for (const dx of [10, 120]) shutter(p, gx + dx, B - 102, 100, 102, rnd.frac() < 0.5 ? 0.55 : 0);
    // 雨棚（底部離地 5m）
    const cx = x0 + 20;
    const cw = 290;
    for (const px of [cx + 40, cx + cw - 56]) p.box(px, B - 170, 16, 170, 0xd8d4c8, { light: 0.1 });
    p.box(cx, B - 204, cw, 36, 0xe8e4d8);
    p.rect(cx + 1, B - 190, cw - 2, 10, 0xc83020);
    p.rect(cx + 2, B - 169, cw - 4, 2, 0xfff4c0);
    signs.push({ x: cx + cw / 2, y: B - 196, text: '加油站', color: '#c83020', size: 10 });
    // 價目牌（立柱）
    const px = x0 + 300;
    p.rect(px + 8, 10, 6, B - 10, 0x3a3f46);
    p.box(px - 6, 0, 34, 60, 0x1a1a1a);
    p.rect(px - 4, 2, 30, 10, 0xc83020);
    for (let i = 0; i < 4; i++) p.rect(px - 3, 16 + i * 10, 28, 8, 0x3a1a0a);
    for (let i = 0; i < 4; i++) p.rect(px - 1, 18 + i * 10, rnd.between(12, 24), 4, 0xe86020);
  }
  sidewalkTrim(p, W);
}

/** 超市：4.5m 高的立面、整片玻璃窗裡看得到貨架、綠色招牌 */
function facadeMarket(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, 0, W, B, 0xa8a49a, { outline: null });
  for (let x0 = 0; x0 < W; x0 += 640) {
    const w = Math.min(600, W - x0 - 20);
    if (w < 140) break;
    p.box(x0 + 10, B - 154, w, 154, 0xc8c4b8);
    p.rect(x0 + 11, B - 154, w - 2, 34, 0x2a8a4a);
    p.rect(x0 + 11, B - 122, w - 2, 3, 0xf0d040);
    signs.push({ x: x0 + 10 + w / 2, y: B - 137, text: '全聯社區超市', color: '#ffffff', size: 14 });
    const doorX = x0 + 10 + Math.round(w / 2) - 34;
    for (let wx = x0 + 20; wx < x0 + w - 60; wx += 66) {
      if (wx + 60 > doorX && wx < doorX + 68) continue;
      p.window(wx, B - 112, 60, 96, { glass: 0x1a2830, broken: rnd.frac() < 0.3 });
      for (let sy = B - 100; sy < B - 22; sy += 16) {
        p.rect(wx + 3, sy, 54, 2, 0x4a5058);
        for (let k = wx + 4; k < wx + 56; k += 5) if (rnd.frac() < 0.55) p.rect(k, sy - 7, 4, 7, rnd.pick([0x8a2a22, 0x2a5a8a, 0x8a7a2a]), 0.6);
      }
      if (rnd.frac() < 0.4) p.rect(wx + 8, B - 70, 16, 22, 0xf0e070);
    }
    // 自動門（2m 寬、2.2m 高）
    p.rect(doorX, B - 76, 68, 76, OUTLINE);
    p.rect(doorX + 1, B - 75, 33, 75, 0x1a2830);
    p.rect(doorX + 34, B - 75, 33, 75, 0x0a1014);
    p.rect(doorX, B - 82, 68, 6, 0x6a6e72);
  }
  sidewalkTrim(p, W);
}

/** 停車場：遠處的商場側牆＋2m 高的鐵絲網圍籬 */
function facadeParking(p: Painter, W: number, t: LocationTheme, _rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, B - 150, W, 120, tone(t.wall, -0.1), { outline: null });
  for (let x = 40; x < W; x += 220) {
    p.rect(x, B - 130, 110, 60, tone(t.wall, -0.25));
    p.rect(x + 3, B - 127, 104, 3, tone(t.wall, 0.1));
  }
  for (let x = 160; x < W; x += 440) {
    p.box(x, B - 140, 40, 40, 0x2a5aa8);
    signs.push({ x: x + 20, y: B - 120, text: 'P', color: '#ffffff', size: 20 });
  }
  // 鐵絲網圍籬（2m）
  const top = B - 68;
  for (let x = 0; x < W; x += 3) for (let y = top; y < B; y += 6) p.px(x, y + (x % 6 === 0 ? 0 : 3), 0x6a7078, 0.6);
  for (let x = 0; x < W; x += 80) p.rect(x, top - 2, 3, 70, 0x5a6068);
  p.rect(0, top - 2, W, 2, 0x7a8088);
  sidewalkTrim(p, W);
}

/** 醫院：白色大樓、急診雨棚與自動門、紅十字 */
function facadeHospital(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, 0, W, B, 0xc8ccc8, { outline: null });
  const fl = Math.round(3.6 * M);
  p.rect(0, B - fl - 6, W, 6, 0xa8aca8);
  for (let x = 14; x < W - 50; x += 72) p.window(x, B - fl - 60, 52, 46, { glass: 0x2a3a48, lit: rnd.frac() < 0.05, broken: rnd.frac() < 0.15, blinds: rnd.frac() < 0.4 });
  // 一樓：牆面窗
  for (let x = 14; x < W - 50; x += 72) p.window(x, B - 96, 52, 56, { glass: 0x2a3a48, broken: rnd.frac() < 0.2 });
  for (let x0 = 60; x0 < W; x0 += 520) {
    // 急診入口：雨棚（離地 3m）、2.4m 高的自動門
    p.rect(x0 - 10, B - 112, 240, 110, 0xb8bcb8);
    p.box(x0 - 20, B - 124, 260, 22, 0xe8e8e0);
    p.rect(x0 - 19, B - 112, 258, 6, 0xc82828);
    signs.push({ x: x0 + 110, y: B - 117, text: '急診 EMERGENCY', color: '#c82828', size: 10 });
    for (const px of [x0 - 12, x0 + 226]) p.box(px, B - 102, 8, 102, 0xd0d0c8);
    p.rect(x0 + 50, B - 82, 120, 82, OUTLINE);
    p.rect(x0 + 51, B - 81, 59, 81, 0x1a2830);
    p.rect(x0 + 111, B - 81, 58, 81, 0x1a2830);
    p.line(x0 + 54, B - 6, x0 + 90, B - 76, 0x3a4a58);
    p.rect(x0 + 80, B - 46, 6, 7, 0x6a1a12);
    p.rect(x0 + 140, B - 32, 7, 6, 0x6a1a12);
    // 紅十字（在二樓牆上）
    p.box(x0 + 300, B - fl - 64, 50, 50, 0xf0f0f0);
    p.rect(x0 + 319, B - fl - 58, 12, 38, 0xc82828);
    p.rect(x0 + 306, B - fl - 45, 38, 12, 0xc82828);
  }
  signs.push({ x: Math.min(W - 120, 420), y: B - fl - 20, text: '市立醫院', color: '#2a4a6a', size: 12 });
  sidewalkTrim(p, W);
}

/** 警察局：藍色腰帶、窗加鐵條、台階入口、旗桿 */
function facadePolice(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, 0, W, B, 0x8a909a, { outline: null });
  const fl = FLOOR_H;
  p.rect(0, B - fl - 2, W, 26, 0x2a4a9a);
  p.rect(0, B - fl + 24, W, 3, 0xf0f0f0);
  for (let x0 = 0; x0 < W; x0 += 520) {
    signs.push({ x: x0 + 260, y: B - fl + 11, text: '警察局 POLICE', color: '#ffffff', size: 12 });
    for (let wx = x0 + 20; wx < x0 + 500; wx += 64) {
      p.window(wx, B - fl - 72, 41, 56, { bars: true, blinds: true, lit: rnd.frac() < 0.06 });
      if (Math.abs(wx - (x0 + 240)) > 50) p.window(wx, B - 74, 41, 50, { bars: true, broken: rnd.frac() < 0.3 });
    }
    // 入口：雙開門 2.4m、台階
    const ex = x0 + 222;
    p.rect(ex - 6, B - 92, 80, 4, 0x6a7078);
    p.rect(ex, B - 82, 68, 78, OUTLINE);
    p.rect(ex + 1, B - 81, 33, 77, 0x14181c);
    p.rect(ex + 35, B - 81, 32, 77, 0x14181c);
    p.rect(ex - 10, B - 4, 88, 4, 0xa8aca8);
    p.rect(ex + 32, B - 88, 4, 4, 0xff3030);
  }
  sidewalkTrim(p, W);
}

/** 軍方檢查站：3.6m 高的水泥 T 牆、蛇籠鐵絲網、探照燈、沙包工事 */
function facadeMilitary(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator): void {
  const h = Math.round(3.6 * M);
  for (let x = 0; x < W; x += 52) {
    p.box(x, B - h, 50, h, 0x8a8678, { light: 0.12 });
    p.rect(x + 6, B - h + 10, 38, 2, 0x6a665a);
    p.rect(x + 22, B - h - 4, 6, 6, 0x5a564a);
    if (rnd.frac() < 0.2) p.rect(x + 10, B - h + 30, 28, 12, 0xd8c890);
    if (rnd.frac() < 0.3) p.dither(x + 2, B - h + 2, 46, 40, 0x2a2420, 0.25);
  }
  // 蛇籠鐵絲網
  for (let x = 0; x < W; x += 12) {
    p.circle(x + 6, B - h - 8, 6, 0x8a9098, 0.7);
    p.circle(x + 6, B - h - 8, 5, mix(t.sky[1], 0x000000, 0.5), 1);
  }
  // 探照燈塔
  for (let x = 200; x < W; x += 480) {
    p.rect(x, 0, 5, B - h, 0x3a3f46);
    p.box(x - 10, 6, 24, 16, 0x2a2e34);
    p.rect(x - 7, 10, 18, 8, 0xfff0b0);
  }
  // 沙包工事（1m 高）
  for (let x = 80; x < W; x += 340) {
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6 - r; i++) sandbagAt(p, x + i * 22 + r * 11, B - 9 - r * 8);
  }
  sidewalkTrim(p, W, 0x5a5444);
}

function sandbagAt(p: Painter, x: number, y: number): void {
  p.box(x, y, 23, 9, 0x8d7a54, { light: 0.2 });
}

/** 國小：走廊式校舍（一樓走廊、教室門窗、二樓欄杆）、前面 1.8m 的圍牆 */
function facadeSchool(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const fl = Math.round(3.6 * M);
  p.box(0, 0, W, B, 0xd8c8a0, { outline: null });
  // 一樓走廊（暗）＋教室
  p.rect(0, B - fl + 10, W, fl - 10, 0x8a7a5a);
  for (let x = 20; x < W - 120; x += 240) {
    p.rect(x, B - 74, 34, 72, 0x3a5a7a);
    p.rect(x + 3, B - 70, 28, 22, 0x2a3a48);
    p.window(x + 50, B - 96, 150, 50, { glass: 0x2a3a48, broken: rnd.frac() < 0.2 });
    signs.push({ x: x + 17, y: B - 84, text: `${rnd.between(1, 6)}年${rnd.between(1, 5)}班`, color: '#2a2a2a', size: 7 });
  }
  // 走廊柱子
  for (let x = 0; x < W; x += 120) p.box(x, B - fl + 10, 14, fl - 10, 0xd8c8a0, { light: 0.1 });
  // 二樓：欄杆＋教室窗
  p.rect(0, B - fl, W, 12, 0xb8a880);
  for (let x = 0; x < W; x += 5) p.rect(x, B - fl - 34, 1, 34, 0x6a7a8a);
  p.rect(0, B - fl - 34, W, 2, 0x6a7a8a);
  for (let x = 30; x < W - 160; x += 240) p.window(x + 50, B - fl - 80, 150, 40, { glass: 0x2a3a48, broken: rnd.frac() < 0.2 });
  signs.push({ x: Math.min(W - 120, 520), y: B - fl - 60, text: '光明國小', color: '#8a2a22', size: 14 });
  // 圍牆（1.8m）與鐵欄
  const wallH = Math.round(1.2 * M);
  for (let x = 0; x < W; x += 102) {
    p.box(x, B - wallH, 102, wallH, 0xc8b898, { light: 0.1 });
    p.rect(x + 1, B - wallH, 100, 4, 0x9a2a22);
    p.box(x + 44, B - wallH - 22, 14, wallH + 22, 0xb8a880);
  }
  for (let x = 0; x < W; x += 6) p.rect(x, B - wallH - 20, 2, 20, 0x3a4a5a);
  p.rect(0, B - wallH - 20, W, 2, 0x3a4a5a);
  sidewalkTrim(p, W);
}

/**
 * 頂樓：沒有建築立面，看出去是天空和遠方的城市。
 * 前景是女兒牆＋1.2m 鐵欄杆、水塔、冷氣主機，最右邊是樓梯間的小屋。
 */
function facadeRooftop(p: Painter, W: number, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const wallH = Math.round(0.6 * M);
  const railH = Math.round(1.1 * M);
  // 水塔（架高的圓桶）
  for (let x = 180; x < W - 300; x += 520) {
    const tx = x + rnd.between(-40, 40);
    p.rect(tx + 6, B - 150, 4, 110, 0x3a3e44);
    p.rect(tx + 70, B - 150, 4, 110, 0x3a3e44);
    p.rect(tx + 6, B - 100, 68, 3, 0x3a3e44);
    p.box(tx, B - 210, 80, 62, 0x8a9aa8, { light: 0.2 });
    for (let k = 0; k < 4; k++) p.rect(tx, B - 200 + k * 14, 80, 2, 0x6a7a88);
    p.rect(tx + 34, B - 220, 12, 10, 0x6a7a88);
  }
  // 冷氣主機
  for (let x = 420; x < W - 260; x += 380) {
    p.box(x, B - 44, 52, 30, 0xb8bcc0);
    p.circle(x + 18, B - 29, 10, 0x6a7076);
    p.circle(x + 18, B - 29, 3, 0x3a3e44);
  }
  // 女兒牆＋欄杆
  p.box(0, B - wallH, W, wallH, 0x9a968a, { light: 0.1 });
  p.rect(0, B - wallH, W, 3, 0xb8b4a8);
  for (let x = 0; x < W; x += 6) p.rect(x, B - wallH - railH, 2, railH, 0x4a5058);
  p.rect(0, B - wallH - railH, W, 3, 0x5a6068);
  p.rect(0, B - wallH - railH / 2, W, 2, 0x4a5058);
  // 樓梯間（右邊的小屋，門開著，裡面是黑的）
  // 門的中心對準關卡出口（世界寬 − 34）
  const hx = W - 150;
  const hh = Math.round(3 * M);
  p.box(hx, B - hh, 150, hh, 0xc8c0a8, { light: 0.12 });
  p.rect(hx, B - hh, 150, 6, 0x8a8470);
  p.rect(hx + 96, B - 76, 40, 76, 0x07080a);
  p.rect(hx + 96, B - 76, 40, 2, 0x3a3a34);
  p.box(hx + 20, B - 92, 34, 14, 0x2e6b3a);
  signs.push({ x: hx + 37, y: B - 85, text: '樓梯', color: '#ffffff', size: 7 });
  sidewalkTrim(p, W);
}

/**
 * 後巷：兩側高牆夾出來的窄巷。磚牆、鐵窗、冷氣主機、排水管、掛在頭上的電線，
 * 據點那一頭（左邊）是拉下一半的鐵捲門。
 */
function facadeAlley(p: Painter, W: number, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  // 磚牆（整片蓋滿，看不到天空的下半）
  p.rect(0, 30, W, B - 30, 0x4a3a34);
  for (let y = 34; y < B; y += 8) {
    const off = (y / 8) % 2 ? 0 : 12;
    p.rect(0, y, W, 1, 0x3a2c28);
    for (let x = off; x < W; x += 24) p.rect(x, y, 1, 8, 0x3a2c28);
  }
  for (let x = 0; x < W; x += 37) p.dither(x, 40 + ((x * 13) % 120), 20 + (x % 30), 10, 0x2a201c, 0.3);
  // 二、三樓的鐵窗與冷氣
  for (let x = rnd.between(30, 90); x < W - 60; x += rnd.between(150, 230)) {
    const top = rnd.between(48, 70);
    p.window(x, top, 40, 44, { bars: true, glass: 0x1e252e, lit: rnd.frac() < 0.08, broken: rnd.frac() < 0.3 });
    if (rnd.frac() < 0.6) acUnit(p, x + 6, top + 48);
  }
  // 排水管
  for (let x = rnd.between(80, 160); x < W; x += rnd.between(220, 340)) {
    p.rect(x, 30, 5, B - 30, 0x5a5e64);
    p.rect(x - 1, B - 10, 7, 10, 0x4a4e54);
  }
  // 頭上的電線
  for (let k = 0; k < 3; k++) {
    const y0 = 34 + k * 9;
    for (let x = 0; x < W; x += 2) p.rect(x, y0 + Math.round(Math.sin(x / 90 + k) * 4), 2, 1, 0x101114);
  }
  // 後門與鐵捲門
  for (let x = rnd.between(300, 420); x < W - 80; x += rnd.between(260, 380)) {
    if (rnd.frac() < 0.5) shutter(p, x, B - 70, 64, 68, rnd.frac() * 0.3);
    else {
      p.box(x, B - 72, 34, 72, 0x3a4048);
      p.rect(x + 26, B - 38, 3, 3, 0xc8b070);
    }
  }
  signs.push({ x: Math.min(W - 80, 700), y: 46, text: '禁止停車', color: '#e8e0d0', size: 8 });
  sidewalkTrim(p, W);
}

/**
 * 孤島小店：空曠路口正中間孤零零一間 24 小時便利商店，兩側是拆光的空地與倒掉的圍籬，
 * 看得出霧屍可以從左右兩邊同時過來。店裡的燈還亮著。
 */
function facadeIslandShop(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const cx = Math.round(W / 2);
  // 兩側：空地上的瓦礫、倒塌的工地圍籬、孤立的電線桿
  for (let x = 0; x < W; x += rnd.between(18, 40)) {
    if (Math.abs(x - cx) < 150) continue;
    p.rect(x, B - rnd.between(3, 14), rnd.between(8, 26), rnd.between(3, 10), tone(t.wall, rnd.frac() * 0.2 - 0.25));
  }
  for (const side of [-1, 1]) {
    // 工地圍籬：一段立著、一段倒了
    const x0 = side < 0 ? 40 : cx + 190;
    const x1 = side < 0 ? cx - 190 : W - 40;
    for (let x = x0; x < x1; x += 46) {
      const down = rnd.frac() < 0.35;
      if (down) p.rect(x, B - 8, 44, 6, 0x6a7078);
      else {
        p.rect(x, B - 52, 44, 50, 0x8a9096);
        p.rect(x, B - 52, 44, 3, 0xb8bcc0);
        for (let k = 0; k < 44; k += 6) p.rect(x + k, B - 49, 1, 47, 0x6a7078);
        if (rnd.frac() < 0.4) p.dither(x + 4, B - 40, 30, 14, rnd.pick([0xc83a2a, 0x3a9ae0, 0xe8e040]), 0.35, 0.6);
      }
      p.rect(x, B - 56, 2, 56, 0x4a4e54);
    }
    // 電線桿
    const px = cx + side * 260;
    p.rect(px, 24, 5, B - 24, 0x5a4a3a);
    p.rect(px - 14, 40, 33, 3, 0x4a3a2a);
  }
  for (let k = 0; k < 2; k++) p.wire(cx - 258, 42 + k * 6, cx + 262, 42 + k * 6, 10, 0x101114);
  // ── 便利商店（7m 寬 × 一層樓高，平頂） ──
  const w = 7 * M;
  const x = cx - Math.round(w / 2);
  const top = B - FLOOR_H - 18;
  p.box(x - 4, top - 6, w + 8, 8, 0xd8dcd8);
  p.box(x, top, w, B - top, 0xe6e2d6, { light: 0.06 });
  // 招牌色帶（綠橘兩條）
  p.rect(x, top + 4, w, 6, 0x2a9a6a);
  p.rect(x, top + 10, w, 5, 0xe0782a);
  p.rect(x, top + 15, w, 3, 0xc83a2a);
  signs.push({ x: cx, y: top + 26, text: '孤島小店　24H', color: '#2a4a3a', size: 10 });
  // 大片玻璃窗：裡面的貨架和燈
  const gy = top + 36;
  const gh = B - gy - 8;
  p.rect(x + 8, gy, w - 16, gh, 0x1a2a30);
  p.rect(x + 8, gy, w - 16, gh, 0xf0e8a0, 0.22);
  for (let k = 0; k < 3; k++) {
    const sy = gy + 12 + k * 18;
    p.rect(x + 14, sy, w - 28, 2, 0x5a6a70);
    for (let i = x + 16; i < x + w - 18; i += rnd.between(4, 7)) p.rect(i, sy - rnd.between(4, 9), 3, 4, rnd.pick([0xc83a2a, 0x3a9ae0, 0xe8e040, 0x9ad17a, 0xe0e0e0]), 0.8);
  }
  // 窗框與玻璃反光、木板釘起來的破窗
  for (let i = x + 8; i <= x + w - 8; i += Math.round((w - 16) / 4)) p.rect(i - 1, gy, 2, gh, 0x9aa0a4);
  p.rect(x + 8, gy, w - 16, 2, 0x9aa0a4);
  for (let k = 0; k < 4; k++) p.line(x + 20 + k * 52, gy + 4, x + 32 + k * 52, gy + 20, 0xffffff, 0.25);
  for (const bx of [x + 14, x + w - 62]) {
    p.rect(bx, gy + 20, 48, 6, 0x8a6a44);
    p.rect(bx + 4, gy + 34, 44, 6, 0x7a5a3a);
  }
  // 自動門（中間）
  p.rect(cx - 18, gy + 6, 36, gh - 6, 0x22343a);
  p.rect(cx - 1, gy + 6, 2, gh - 6, 0x9aa0a4);
  p.rect(cx - 18, B - 10, 36, 2, 0x5a6064);
  // 外面的冰櫃與招牌燈箱
  p.box(x - 30, B - 34, 22, 34, 0x3a8ac8);
  p.rect(x - 28, B - 30, 18, 12, 0xd8f0ff, 0.7);
  p.box(x + w + 8, B - 26, 26, 26, 0xc83a2a);
  p.rect(x + w + 10, B - 22, 22, 8, 0xf8e0a0, 0.8);
  sidewalkTrim(p, W);
}

/** 建築底下的人行道邊緣與路緣 */
function sidewalkTrim(p: Painter, W: number, c = 0x4a4c50): void {
  p.rect(0, B, W, 2, c);
}

function drawGround(scene: Phaser.Scene, style: FloorStyle, t: LocationTheme, W: number, uid: string, rnd: Phaser.Math.RandomDataGenerator, facade: FacadeStyle): void {
  const H = GAME_HEIGHT - GROUND_Y;
  layer(scene, `gnd-${uid}`, W, H, GROUND_Y, 1, -60, (p) => {
    const base = style === 'dirt' ? 0x3a362c : style === 'court' ? 0x3a4a44 : style === 'concrete' ? 0x3a3c40 : 0x2b2e34;
    // 人行道（第一帶）
    const walkH = LANE_TOP - GROUND_Y - 6;
    const walk = style === 'dirt' ? 0x4a4436 : 0x55565a;
    p.rect(0, 0, W, walkH, walk);
    if (style !== 'dirt') for (let x = 0; x < W; x += 16) p.rect(x, 0, 1, walkH, tone(walk, -0.15));
    p.rect(0, walkH, W, 2, tone(walk, 0.15));
    p.rect(0, walkH + 2, W, 2, 0x1a1c20);
    // 地面：越近越亮
    for (let i = 0; i < 6; i++) {
      const y0 = walkH + 4 + Math.floor(((H - walkH - 4) * i) / 6);
      p.rect(0, y0, W, Math.ceil((H - walkH - 4) / 6) + 1, tone(base, i * 0.025));
    }
    const top = walkH + 4;
    if (style === 'asphalt') {
      // 道路標線
      if (facade === 'parking') {
        for (let x = 30; x < W; x += 76) {
          p.line(x, top + 6, x - 14, H - 4, 0xd8d8c8, 0.5);
        }
      } else {
        const my = top + Math.floor((H - top) * 0.55);
        for (let x = 0; x < W; x += 40) p.rect(x, my, 22, 2, 0xd8c860, 0.55);
      }
      // 人孔蓋
      for (let x = rnd.between(80, 200); x < W; x += rnd.between(260, 420)) {
        p.ellipse(x, top + rnd.between(30, 90), 10, 3, 0x1a1a1e);
        p.ellipse(x, top + 50, 8, 2, 0x3a3c40, 0);
      }
    } else if (style === 'court') {
      // 操場跑道線
      p.rect(0, top + 20, W, 1, 0xe8e8e0, 0.4);
      p.rect(0, top + 70, W, 1, 0xe8e8e0, 0.4);
      for (let x = 120; x < W; x += 420) p.ellipse(x, top + 45, 40, 12, 0xe8e8e0, 0.15);
    } else if (style === 'dirt') {
      for (let n = 0; n < W / 6; n++) p.rect(rnd.between(0, W), rnd.between(top, H - 2), rnd.between(1, 3), 1, rnd.pick([0x2a261e, 0x4a4436]));
      // 車轍
      p.rect(0, top + 30, W, 2, tone(base, -0.2));
      p.rect(0, top + 46, W, 2, tone(base, -0.2));
    }
    // 裂縫、油漬、水窪
    for (let n = 0; n < W / 22; n++) {
      const x = rnd.between(0, W);
      const y = rnd.between(top + 2, H - 2);
      p.rect(x, y, rnd.between(3, 10), 1, tone(base, -0.35), 0.8);
    }
    for (let n = 0; n < W / 160; n++) p.ellipse(rnd.between(20, W - 20), rnd.between(top + 10, H - 10), rnd.between(8, 18), rnd.between(2, 4), 0x0e1014, 0.5);
    for (let n = 0; n < W / 240; n++) {
      const x = rnd.between(20, W - 20);
      const y = rnd.between(top + 14, H - 14);
      p.ellipse(x, y, rnd.between(12, 22), 3, mix(t.sky[1], base, 0.6), 0.6);
      p.rect(x - 4, y - 1, 6, 1, tone(t.sky[1], 0.3), 0.5);
    }
  });
}

// ───────────────────── 室內 ─────────────────────

/** 室內天花板高度（腳底 y = GROUND_Y 往上幾公尺）：住家 2.8m、倉庫 6m… */
const CEIL_M: Record<InteriorStyle, number> = {
  store: 3.4,
  ward: 3,
  precinct: 3,
  house: 2.8,
  garage: 4.5,
  bunker: 2.6,
  warehouse: 5.8,
  lobby: 4.2,
  classroom: 3.2,
};

/** 這種室內的天花板 y（日光燈掛在這裡） */
export function ceilingY(style: InteriorStyle): number {
  return GROUND_Y - Math.round(CEIL_M[style] * M);
}

function drawInterior(
  scene: Phaser.Scene,
  style: InteriorStyle,
  _t: LocationTheme,
  W: number,
  uid: string,
  rnd: Phaser.Math.RandomDataGenerator,
  signs: Sign[],
): void {
  layer(scene, `int-${uid}`, W, GROUND_Y + 2, 0, 1, -70, (p) => {
    const top = Math.max(0, ceilingY(style));
    // 天花板：從畫面頂端到天花板線，輕鋼架格子或鋼構
    p.rect(0, 0, W, top, 0x24272d);
    if (top > 4) {
      if (style === 'garage' || style === 'bunker') {
        for (let x = 0; x < W; x += 68) p.rect(x, 0, 5, top, 0x24272c);
        p.rect(0, Math.max(0, top - 8), W, 5, 0x2a2e34);
      } else {
        for (let x = 0; x < W; x += 40) p.rect(x, 0, 1, top, 0x34383f);
        for (let y = top - 6; y > 0; y -= 14) p.rect(0, y, W, 1, 0x34383f);
        for (let x = 80; x < W; x += 260) p.box(x, Math.max(0, top - 14), 28, 12, 0x6a6e74);
      }
      p.rect(0, top - 2, W, 2, 0x0a0b0d);
    }
    const lowerH = (m: number) => B - Math.round(m * M);
    switch (style) {
      case 'store':
        wallTwoTone(p, W, top, 0xd8d4c8, 0xa8a090, lowerH(1));
        // 走道吊牌（從天花板吊下來）
        for (let x = 60; x < W; x += 220) {
          p.rect(x + 30, top, 1, 10, 0x2a2a2a);
          p.box(x, top + 10, 62, 18, rnd.pick([0x2a8a4a, 0xc83a2a, 0x2a6ac8]));
          signs.push({ x: x + 31, y: top + 19, text: rnd.pick(['生鮮', '飲料', '零食', '日用品', '冷凍', '泡麵']), color: '#ffffff', size: 9 });
        }
        break;
      case 'ward': {
        // 上白下綠磁磚（1.2m）、0.9m 扶手、房號牌
        const split = lowerH(1.2);
        wallTwoTone(p, W, top, 0xd0d8d0, 0x5a8a78, split);
        for (let x = 0; x < W; x += 8) p.rect(x, split, 1, B - split, tone(0x5a8a78, -0.12));
        for (let y = split; y < B; y += 8) p.rect(0, y, W, 1, tone(0x5a8a78, -0.12));
        p.box(0, lowerH(0.9), W, 4, 0x9aa0a6, { outline: null });
        for (let x = 70; x < W; x += 200) {
          p.box(x, lowerH(2.4), 26, 12, 0x2a4a6a);
          signs.push({ x: x + 13, y: lowerH(2.4) + 6, text: `${rnd.between(2, 4)}0${rnd.between(1, 9)}`, color: '#ffffff', size: 8 });
        }
        for (let x = rnd.between(0, 200); x < W; x += rnd.between(260, 420)) p.dither(x, B - 40, rnd.between(30, 60), 6, 0x5a0a08, 0.4);
        break;
      }
      case 'precinct': {
        const split = lowerH(1);
        wallTwoTone(p, W, top, 0x7a8494, 0x5a3e28, split);
        for (let x = 0; x < W; x += 14) p.rect(x, split, 1, B - split, tone(0x5a3e28, -0.2));
        p.rect(0, split - 3, W, 3, 0x3a2a1c);
        for (let x = 40; x < W; x += 240) p.window(x, lowerH(2.4), 48, 42, { blinds: true, glass: 0x2a3440 });
        for (let x = 150; x < W; x += 480) {
          p.box(x, lowerH(2.5), 40, 26, 0x2a4a9a);
          p.circle(x + 20, lowerH(2.5) + 13, 8, 0xd0a030);
        }
        break;
      }
      case 'house': {
        const split = lowerH(0.9);
        wallTwoTone(p, W, top, 0xb8a88a, 0x6a4a30, split);
        for (let y = top + 4; y < split - 4; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < W; x += 10) p.px(x, y, tone(0xb8a88a, -0.15));
        for (let x = 40; x < W; x += rnd.between(160, 240)) {
          const k = rnd.frac();
          if (k < 0.35) {
            // 相框
            p.box(x, lowerH(2), 22, 26, 0x5a3e28);
            p.rect(x + 3, lowerH(2) + 3, 16, 20, rnd.pick([0x6a8a9a, 0x8a7a6a]));
          } else if (k < 0.7) {
            // 窗戶＋窗簾（1.2m）
            p.window(x, lowerH(2.2), 41, 41, { glass: 0x2a3440 });
            p.rect(x - 6, lowerH(2.35), 12, 54, 0x8a2a32);
            p.rect(x + 35, lowerH(2.35), 12, 54, 0x8a2a32);
            p.rect(x - 8, lowerH(2.35) - 2, 58, 2, 0x5a3e28);
          } else {
            // 月曆
            p.box(x, lowerH(2), 18, 24, 0xf0f0e8);
            p.rect(x + 1, lowerH(2) + 1, 16, 6, 0xc83020);
          }
        }
        break;
      }
      case 'garage':
        // 鐵皮牆、工具板、高窗
        p.rect(0, top, W, B - top, 0x5a5e62);
        for (let x = 0; x < W; x += 4) p.rect(x, top, 1, B - top, x % 8 === 0 ? 0x6a6e72 : 0x4a4e52);
        for (let x = 80; x < W; x += 320) {
          p.box(x, lowerH(2), 80, 40, 0x8a6a4a);
          for (let i = 0; i < 9; i++) p.rect(x + 6 + i * 8, lowerH(2) + 6, 3, rnd.between(10, 26), rnd.pick([0xc83020, 0x9aa0a6, 0x2a2a2a]));
        }
        for (let x = 180; x < W; x += 360) p.window(x, top + 8, 90, 22, { glass: 0x2a3440 });
        break;
      case 'bunker':
        p.rect(0, top, W, B - top, 0x6a665a);
        for (let n = 0; n < W / 30; n++) p.line(rnd.between(0, W), top + rnd.between(0, 30), rnd.between(0, W), top + rnd.between(30, 60), 0x4a463c, 0.6);
        // 1m 高的沙包牆
        for (let x = 0; x < W; x += 23) for (let r = 0; r < 4; r++) sandbagAt(p, x + (r % 2) * 11, B - 9 - r * 8);
        for (let x = 100; x < W; x += 360) {
          p.box(x, top + 8, 70, 44, 0xd8c8a0);
          p.line(x + 8, top + 18, x + 50, top + 42, 0xc83020);
          p.rect(x + 12, top + 30, 26, 1, 0x3a6a3a);
        }
        break;
      case 'warehouse':
        p.rect(0, top, W, B - top, 0x4a4e52);
        for (let x = 0; x < W; x += 5) p.rect(x, top, 1, B - top, 0x3e4246);
        // 5m 高的貨架（每層 1.2m）
        for (let x = 20; x < W; x += 200) {
          const rh = Math.round(5 * M);
          p.rect(x, B - rh, 4, rh, 0xd8a020);
          p.rect(x + 150, B - rh, 4, rh, 0xd8a020);
          for (let y = B - 8; y > B - rh; y -= Math.round(1.25 * M)) {
            p.rect(x, y, 154, 4, 0x2a5a9a);
            for (let k = x + 6; k < x + 144; k += 36) if (rnd.frac() < 0.75) p.box(k, y - 32, 32, 32, rnd.pick([0xa8804a, 0x9a7a4a, 0x4a5a32]));
          }
        }
        break;
      case 'classroom': {
        // 學校走廊：上米白下綠（1m 牆裙）、每間教室一扇前門＋班級牌、門與門之間是教室的窗、公布欄
        const split = lowerH(1);
        wallTwoTone(p, W, top, 0xd8d0b8, 0x4a6a58, split);
        p.rect(0, split - 3, W, 3, 0x2a3a30);
        for (let x = 60; x < W; x += 300) {
          // 前門（0.9 × 2.1m）
          const dh = Math.round(2.1 * M);
          p.box(x, B - dh, 32, dh, 0x7a5a3a, { light: 0.1 });
          p.rect(x + 6, B - dh + 8, 20, 18, 0x2a3440);
          p.rect(x + 26, B - dh / 2, 3, 3, 0xc8b070);
          p.box(x - 6, B - dh - 20, 44, 14, 0x2e4a3a);
          signs.push({ x: x + 16, y: B - dh - 13, text: `${rnd.between(1, 3)}年${rnd.between(1, 9)}班`, color: '#f0ece0', size: 8 });
          // 教室窗（看進去是暗的）
          p.window(x + 56, lowerH(2.3), 150, 44, { glass: 0x1e252e, broken: rnd.frac() < 0.3, blinds: rnd.frac() < 0.3 });
          // 公布欄或消防栓箱
          if (rnd.frac() < 0.5) {
            p.box(x + 222, lowerH(2), 46, 30, 0x9a6a3a);
            for (let k = 0; k < 4; k++) p.rect(x + 226 + (k % 2) * 20, lowerH(2) + 4 + Math.floor(k / 2) * 13, 16, 10, rnd.pick([0xe8e4d8, 0xf0d890, 0xc8e0f0]));
          } else {
            p.box(x + 236, lowerH(1.6), 18, 26, 0xb82a22);
            p.rect(x + 240, lowerH(1.6) + 4, 10, 10, 0xe8d8c8);
          }
        }
        // 地上的血拖痕、翻倒的書包
        for (let x = rnd.between(100, 300); x < W; x += rnd.between(280, 460)) p.dither(x, B - 30, rnd.between(30, 60), 5, 0x5a0a08, 0.35);
        break;
      }
      case 'lobby':
      default: {
        wallTwoTone(p, W, top, 0xa8a49a, 0x7a766c, lowerH(0.6));
        // 柱子＋整片落地窗
        for (let x = 0; x < W; x += 160) p.box(x, top, 24, B - top, 0xc8c4b8, { light: 0.15 });
        for (let x = 44; x < W; x += 320) p.window(x, lowerH(3.2), 96, 90, { glass: 0x2a3440 });
        break;
      }
    }
    // 踢腳板
    p.rect(0, B - 4, W, 4, 0x2a2a2a);
    p.rect(0, B - 4, W, 1, 0x4a4a4a);
  });
}

function wallTwoTone(p: Painter, W: number, top: number, upper: number, lower: number, split: number): void {
  p.rect(0, top, W, split - top, upper);
  p.rect(0, split, W, B - split, lower);
  p.rect(0, split - 1, W, 2, tone(lower, -0.3));
  for (let x = 0; x < W; x += 37) p.dither(x, top + ((x * 7) % 40), 10 + (x % 20), 6, tone(upper, -0.25), 0.15);
}

function drawFloor(scene: Phaser.Scene, style: FloorStyle, _t: LocationTheme, W: number, uid: string, rnd: Phaser.Math.RandomDataGenerator): void {
  const H = GAME_HEIGHT - GROUND_Y;
  layer(scene, `flr-${uid}`, W, H, GROUND_Y, 1, -60, (p) => {
    const base = style === 'wood' ? 0x5a3e28 : style === 'checker' ? 0x8a8e94 : style === 'linoleum' ? 0x6a7a72 : style === 'tile' ? 0x4a4e58 : 0x4a4a46;
    for (let i = 0; i < 6; i++) p.rect(0, Math.floor((H * i) / 6), W, Math.ceil(H / 6) + 1, tone(base, -0.25 + i * 0.04));
    // 磁磚縫：越近越大（簡單的透視）
    let y = 0;
    let row = 0;
    let size = 8;
    while (y < H) {
      const c = tone(base, -0.32 + row * 0.01);
      p.rect(0, y, W, 1, c);
      if (style === 'wood') {
        for (let x = (row % 2) * 20; x < W; x += 40) p.rect(x, y, 1, size, c);
      } else if (style !== 'concrete') {
        for (let x = (row % 2) * (style === 'checker' ? 0 : size / 2); x < W; x += size * 1.6) {
          if (style === 'checker' && row % 2 === Math.floor(x / (size * 1.6)) % 2) p.rect(x, y + 1, size * 1.6, size - 1, tone(base, -0.18), 0.7);
          p.rect(Math.round(x), y, 1, size, c);
        }
      }
      y += size;
      size = Math.min(26, Math.round(size * 1.18));
      row++;
    }
    if (style === 'concrete') for (let n = 0; n < W / 20; n++) p.rect(rnd.between(0, W), rnd.between(0, H), rnd.between(2, 8), 1, tone(base, -0.3));
    // 散落的紙張、玻璃、血跡
    for (let n = 0; n < W / 50; n++) p.rect(rnd.between(0, W), rnd.between(8, H - 4), rnd.between(3, 6), rnd.between(2, 4), rnd.pick([0xd8d4c8, 0xb8b4a8]), 0.6);
    for (let n = 0; n < W / 200; n++) p.ellipse(rnd.between(20, W - 20), rnd.between(20, H - 10), rnd.between(8, 16), rnd.between(2, 4), 0x4a0a08, 0.55);
    // 牆角陰影
    p.dither(0, 0, W, 8, 0x000000, 0.4);
  });
}
