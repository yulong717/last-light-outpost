import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GROUND_Y, LANE_BOTTOM, LANE_TOP, depthForY } from '../config';
import { OUTLINE, Painter, canvasTexture, mix, tone } from '../art/Painter';
import { PROPS, propKey } from '../art/PropArt';
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
const WALL_PROPS = new Set(['door', 'glasswin', 'shelf', 'fridge', 'locker', 'gunlocker', 'filecab', 'fusebox', 'wardrobe', 'shrine', 'tv', 'cellbars', 'noticeboard', 'redcross', 'shutter', 'lamppost', 'watchtower', 'billboard', 'hoop', 'flagpole', 'powerpole', 'barricadedoor']);

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
    drawGround(scene, t.floorExt, t, W, uid, rnd, o.facade ?? t.facade);
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
    for (let x = span[0] + 70; x < span[1] - 20; x += 130 + rnd.between(-20, 20)) {
      props.push({ id: 'tubelight', x, y: 30, kind: 'light', flip: false, frame: 0, wall: true, scale: 1 });
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
  const hx = p.x + (tube ? 0 : (p.flip ? -6 : 6));
  const hy = tube ? p.y + 6 : p.y - 76;
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
      case 'street':
      default:
        facadeStreet(p, W, t, rnd, signs);
    }
  });
}

const B = GROUND_Y;

/** 一排店面：鐵捲門、招牌、樓上窗戶，偶爾是倒塌的空地 */
function facadeStreet(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const names = ['五金行', '小吃', '藥局', '當舖', '網咖', '早餐', '機車行', '眼鏡'];
  const signCols = [0xc83a2a, 0x2a6ac8, 0x3a9a50, 0xd8a020, 0x8a3ac0];
  rnd.shuffle(names);
  let shop = 0;
  for (let x = 0; x < W; ) {
    const w = rnd.between(70, 120);
    if (rnd.frac() < 0.15) {
      // 倒塌的空地：瓦礫堆
      for (let i = 0; i < 18; i++) p.rect(x + rnd.between(0, w - 8), B - rnd.between(2, 18), rnd.between(4, 10), rnd.between(2, 6), tone(t.wall, rnd.frac() * 0.2 - 0.1));
      p.rect(x + 6, B - 40, 3, 40, tone(t.wall, -0.2));
      p.line(x + 8, B - 40, x + 26, B - 60, 0x5a3a22);
      x += w;
      continue;
    }
    const floors = rnd.between(2, 3);
    const h = 30 + floors * 30;
    const wall = tone(t.wall, rnd.frac() * 0.25 - 0.1);
    p.box(x, B - h, w, h, wall, { light: 0.1 });
    // 屋頂水塔與鐵皮加蓋
    if (rnd.frac() < 0.5) {
      p.box(x + 8, B - h - 10, 16, 10, 0x8a8e94);
      p.rect(x + 10, B - h - 2, 2, 2, OUTLINE);
    }
    // 樓上窗
    for (let f = 1; f < floors + 1; f++) {
      const wy = B - 30 - f * 30 + 6;
      for (let wx = x + 8; wx < x + w - 18; wx += 22) p.window(wx, wy, 14, 16, { lit: rnd.frac() < 0.06, broken: rnd.frac() < 0.25, bars: rnd.frac() < 0.3 });
      // 冷氣室外機
      if (rnd.frac() < 0.5) p.box(x + w - 18, wy + 10, 12, 8, 0xb0b4b8);
    }
    // 一樓：招牌、鐵捲門（可能半開）
    const sc = signCols[rnd.between(0, signCols.length - 1)];
    p.box(x + 4, B - 44, w - 8, 12, sc);
    signs.push({ x: x + w / 2, y: B - 38, text: names[shop++ % names.length], color: '#f4ecd8', size: 8 });
    const open = rnd.frac();
    p.rect(x + 6, B - 30, w - 12, 30, OUTLINE);
    const shutterBottom = open < 0.3 ? B - 14 : open < 0.5 ? B - 22 : B;
    for (let y = B - 29; y < shutterBottom; y += 3) p.rect(x + 7, y, w - 14, 2, y % 6 === 0 ? 0x7a8088 : 0x6a7078);
    if (shutterBottom < B) p.rect(x + 7, shutterBottom, w - 14, B - shutterBottom, 0x07080a);
    // 塗鴉
    if (rnd.frac() < 0.35) p.dither(x + 10, B - 26, rnd.between(14, 30), 8, rnd.pick([0xc83a2a, 0x3a9ae0, 0xe8e040]), 0.4, 0.7);
    x += w + rnd.between(0, 4);
  }
  sidewalkTrim(p, W);
}

/** 透天厝：窄長四樓、陽台鐵窗、屋頂水塔、一樓鐵捲門與機車 */
function facadeHomes(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  const tiles = [0xa89a88, 0x8a7a6a, 0xb8b0a0, 0x7a8a8a, 0x9a8070];
  for (let x = 0; x < W; ) {
    const w = rnd.between(44, 56);
    const floors = rnd.between(3, 4);
    const h = floors * 28 + 4;
    const c = tiles[rnd.between(0, tiles.length - 1)];
    p.box(x, B - h, w, h, c, { light: 0.1 });
    // 磁磚橫紋
    for (let y = B - h + 4; y < B; y += 4) p.rect(x + 1, y, w - 2, 1, tone(c, -0.08));
    // 頂樓水塔＋鐵皮屋
    p.box(x + w - 20, B - h - 12, 14, 12, rnd.pick([0x3a6ac8, 0xd8d0c0, 0x5a8a5a]));
    if (rnd.frac() < 0.5) p.box(x + 2, B - h - 8, 22, 8, 0x6a7078);
    for (let f = 1; f < floors; f++) {
      const fy = B - 28 - f * 28;
      // 陽台＋鐵窗
      p.rect(x + 3, fy + 22, w - 6, 3, tone(c, -0.3));
      p.window(x + 7, fy + 4, w - 14, 16, { lit: rnd.frac() < 0.08, broken: rnd.frac() < 0.2, bars: true, frame: 0x3a3a3a });
      for (let i = x + 4; i < x + w - 4; i += 3) p.rect(i, fy + 16, 1, 7, 0x2a2a2a);
      // 曬衣服
      if (rnd.frac() < 0.25) for (let i = 0; i < 3; i++) p.rect(x + 10 + i * 8, fy + 8, 5, 7, rnd.pick([0xc83a2a, 0xe8e8e0, 0x3a6ac8]));
      if (rnd.frac() < 0.4) p.box(x + w - 14, fy + 12, 10, 7, 0xb0b4b8);
    }
    // 一樓鐵捲門
    p.rect(x + 4, B - 26, w - 8, 26, OUTLINE);
    const half = rnd.frac() < 0.25;
    for (let y = B - 25; y < (half ? B - 10 : B); y += 3) p.rect(x + 5, y, w - 10, 2, 0x7a8088);
    if (half) p.rect(x + 5, B - 10, w - 10, 10, 0x07080a);
    // 直立招牌
    if (rnd.frac() < 0.3) {
      p.box(x + w - 8, B - h + 10, 8, 30, rnd.pick([0xc83a2a, 0x2a6ac8]));
    }
    x += w;
  }
  // 巷口的紅綠燈
  for (let x = 200; x < W; x += 420) {
    p.rect(x, B - 70, 2, 70, 0x3a3f46);
    p.box(x - 4, B - 78, 10, 10, 0x2a2a2a);
    p.rect(x - 2, B - 76, 3, 2, 0xd03020);
  }
  void signs;
  sidewalkTrim(p, W);
}

/** 加油站：大雨棚＋加油機、便利商店、修車間、價目牌 */
function facadeGas(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  for (let x0 = 0; x0 < W; x0 += 560) {
    // 便利商店
    const sx = x0 + 300;
    p.box(sx, B - 64, 150, 64, 0xd8d4c8);
    p.rect(sx + 1, B - 64, 148, 10, 0x2a8a4a);
    p.rect(sx + 1, B - 56, 148, 2, 0xe8a020);
    signs.push({ x: sx + 75, y: B - 59, text: '便利商店', color: '#ffffff', size: 8 });
    for (let wx = sx + 8; wx < sx + 140; wx += 34) p.window(wx, B - 46, 28, 34, { glass: 0x1a2a2a, lit: wx === sx + 42, broken: rnd.frac() < 0.4 });
    // 修車間
    const gx = x0 + 460;
    p.box(gx, B - 76, 96, 76, 0x8a8478);
    p.rect(gx + 1, B - 76, 94, 6, 0x4a4a4a);
    for (const dx of [6, 52]) {
      p.rect(gx + dx, B - 60, 40, 60, OUTLINE);
      const open = rnd.frac() < 0.5;
      for (let y = B - 59; y < (open ? B - 30 : B); y += 3) p.rect(gx + dx + 1, y, 38, 2, 0x9aa0a6);
      if (open) {
        p.rect(gx + dx + 1, B - 30, 38, 30, 0x0a0a0c);
        p.rect(gx + dx + 6, B - 12, 28, 6, 0x2a2a2a);
      }
    }
    signs.push({ x: gx + 48, y: B - 66, text: '修車', color: '#e8d8a0', size: 8 });
    // 雨棚
    const cx = x0 + 30;
    p.rect(cx + 20, B - 76, 4, 76, 0xd8d4c8);
    p.rect(cx + 200, B - 76, 4, 76, 0xd8d4c8);
    p.box(cx, B - 96, 240, 18, 0xe8e4d8);
    p.rect(cx + 1, B - 86, 238, 5, 0xc83020);
    p.rect(cx + 2, B - 79, 236, 1, 0xfff4c0);
    signs.push({ x: cx + 120, y: B - 91, text: '加油站', color: '#c83020', size: 8 });
    // 價目牌
    const px = x0 + 270;
    p.rect(px + 8, B - 120, 4, 120, 0x3a3f46);
    p.box(px, B - 140, 22, 30, 0x1a1a1a);
    p.rect(px + 2, B - 138, 18, 6, 0xc83020);
    for (let i = 0; i < 3; i++) p.rect(px + 3, B - 128 + i * 6, 16, 4, 0x3a1a0a);
    for (let i = 0; i < 3; i++) p.rect(px + 4, B - 127 + i * 6, rnd.between(6, 14), 2, 0xe86020);
  }
  sidewalkTrim(p, W);
}

/** 超市：長條立面、大玻璃窗裡看得到貨架、綠色招牌 */
function facadeMarket(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  for (let x0 = 0; x0 < W; x0 += 600) {
    const w = Math.min(560, W - x0 - 20);
    if (w < 100) break;
    p.box(x0 + 10, B - 88, w, 88, 0xc8c4b8);
    p.rect(x0 + 11, B - 88, w - 2, 18, 0x2a8a4a);
    p.rect(x0 + 11, B - 72, w - 2, 2, 0xf0d040);
    signs.push({ x: x0 + 10 + w / 2, y: B - 79, text: '全聯社區超市', color: '#ffffff', size: 10 });
    for (let wx = x0 + 20; wx < x0 + w - 30; wx += 46) {
      if (Math.abs(wx - (x0 + w / 2)) < 30) {
        // 自動門
        p.rect(wx, B - 54, 40, 54, OUTLINE);
        p.rect(wx + 1, B - 53, 19, 53, 0x1a2830);
        p.rect(wx + 21, B - 53, 18, 53, 0x1a2830);
        p.rect(wx + 26, B - 53, 18, 53, 0x0a1014);
        continue;
      }
      p.window(wx, B - 60, 40, 46, { glass: 0x1a2830, broken: rnd.frac() < 0.3 });
      // 窗裡的貨架
      for (let sy = B - 50; sy < B - 18; sy += 9) {
        p.rect(wx + 3, sy, 34, 1, 0x4a5058);
        for (let k = wx + 4; k < wx + 36; k += 4) if (rnd.frac() < 0.5) p.rect(k, sy - 4, 3, 4, rnd.pick([0x8a2a22, 0x2a5a8a, 0x8a7a2a]), 0.6);
      }
      // 特價海報
      if (rnd.frac() < 0.4) p.rect(wx + 6, B - 40, 10, 14, 0xf0e070);
    }
  }
  sidewalkTrim(p, W);
}

/** 停車場：遠處的圍籬與商場側牆 */
function facadeParking(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, B - 70, W, 50, tone(t.wall, -0.1), { outline: null });
  for (let x = 30; x < W; x += 160) {
    p.rect(x, B - 62, 60, 30, tone(t.wall, -0.25));
    p.rect(x + 2, B - 60, 56, 2, tone(t.wall, 0.1));
  }
  for (let x = 120; x < W; x += 320) {
    p.box(x, B - 66, 26, 20, 0x2a5aa8);
    signs.push({ x: x + 13, y: B - 56, text: 'P', color: '#ffffff', size: 12 });
  }
  // 鐵絲網圍籬
  for (let x = 0; x < W; x += 2) {
    for (let y = B - 26; y < B; y += 4) p.px(x, y + (x % 4 === 0 ? 0 : 2), 0x6a7078, 0.6);
  }
  for (let x = 0; x < W; x += 40) p.rect(x, B - 28, 2, 28, 0x5a6068);
  p.rect(0, B - 28, W, 1, 0x7a8088);
  void rnd;
  sidewalkTrim(p, W);
}

/** 醫院：白色高樓、格子窗、紅十字、急診入口 */
function facadeHospital(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, 10, W, B - 10, 0xc8ccc8, { outline: null });
  for (let y = 18; y < B - 50; y += 22) {
    p.rect(0, y + 16, W, 2, 0xa8aca8);
    for (let x = 8; x < W - 20; x += 26) p.window(x, y, 18, 14, { glass: 0x2a3a48, lit: rnd.frac() < 0.04, broken: rnd.frac() < 0.15, blinds: rnd.frac() < 0.3 });
  }
  for (let x0 = 40; x0 < W; x0 += 420) {
    // 紅十字
    p.box(x0 + 150, 26, 30, 30, 0xf0f0f0);
    p.rect(x0 + 161, 30, 8, 22, 0xc82828);
    p.rect(x0 + 154, 37, 22, 8, 0xc82828);
    // 急診雨棚
    p.box(x0, B - 54, 140, 12, 0xe8e8e0);
    p.rect(x0 + 1, B - 46, 138, 3, 0xc82828);
    signs.push({ x: x0 + 70, y: B - 49, text: '急診 EMERGENCY', color: '#c82828', size: 7 });
    p.rect(x0 + 6, B - 42, 3, 42, 0xb8b8b0);
    p.rect(x0 + 131, B - 42, 3, 42, 0xb8b8b0);
    p.rect(x0 + 30, B - 40, 80, 40, OUTLINE);
    p.rect(x0 + 31, B - 39, 38, 39, 0x1a2830);
    p.rect(x0 + 71, B - 39, 38, 39, 0x1a2830);
    p.line(x0 + 33, B - 4, x0 + 60, B - 36, 0x3a4a58);
    // 血手印
    p.rect(x0 + 50, B - 24, 4, 5, 0x6a1a12);
    p.rect(x0 + 86, B - 18, 5, 4, 0x6a1a12);
  }
  signs.push({ x: Math.min(W - 120, 300), y: 14, text: '市立醫院', color: '#2a4a6a', size: 9 });
  sidewalkTrim(p, W);
}

/** 警察局：藍灰色兩層樓、藍色腰帶、窗加鐵條、旗桿 */
function facadePolice(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  for (let x0 = 0; x0 < W; x0 += 460) {
    const w = Math.min(420, W - x0);
    p.box(x0, B - 110, w, 110, 0x8a909a);
    p.rect(x0 + 1, B - 64, w - 2, 10, 0x2a4a9a);
    p.rect(x0 + 1, B - 54, w - 2, 2, 0xf0f0f0);
    signs.push({ x: x0 + w / 2, y: B - 59, text: '警察局 POLICE', color: '#ffffff', size: 8 });
    for (let wx = x0 + 10; wx < x0 + w - 24; wx += 30) {
      p.window(wx, B - 100, 20, 26, { bars: true, blinds: true, lit: rnd.frac() < 0.06 });
      if (Math.abs(wx - (x0 + w / 2)) > 30) p.window(wx, B - 44, 20, 26, { bars: true, broken: rnd.frac() < 0.3 });
    }
    // 入口與台階
    const ex = x0 + w / 2 - 20;
    p.rect(ex, B - 48, 40, 48, OUTLINE);
    p.rect(ex + 1, B - 47, 38, 47, 0x14181c);
    p.rect(ex - 6, B - 4, 52, 4, 0xa8aca8);
    p.rect(ex + 20, B - 50, 1, 2, 0xff3030);
    // 旗桿
    p.rect(x0 + 14, B - 150, 2, 150, 0x9aa0a6);
    p.rect(x0 + 16, B - 148, 20, 12, 0x8a2a22);
    p.dither(x0 + 16, B - 148, 20, 12, 0x2a1a1a, 0.4);
  }
  sidewalkTrim(p, W);
}

/** 軍方檢查站：水泥 T 牆、鐵絲網＋蛇籠、探照燈、沙包 */
function facadeMilitary(p: Painter, W: number, t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator): void {
  for (let x = 0; x < W; x += 34) {
    const h = 56 + (x % 68 === 0 ? 4 : 0);
    p.box(x, B - h, 32, h, 0x8a8678, { light: 0.12 });
    p.rect(x + 4, B - h + 6, 24, 1, 0x6a665a);
    if (rnd.frac() < 0.2) p.rect(x + 8, B - h + 14, 14, 6, 0xd8c890);
    if (rnd.frac() < 0.25) p.dither(x + 2, B - h + 2, 28, 20, 0x2a2420, 0.25);
  }
  // 蛇籠鐵絲網
  for (let x = 0; x < W; x += 8) {
    p.circle(x + 4, B - 64, 4, 0x8a9098, 0.7);
    p.circle(x + 4, B - 64, 3, mix(t.sky[1], 0x000000, 0.5), 1);
  }
  // 探照燈塔
  for (let x = 160; x < W; x += 380) {
    p.rect(x, B - 120, 3, 64, 0x3a3f46);
    p.box(x - 6, B - 128, 14, 10, 0x2a2e34);
    p.rect(x - 4, B - 125, 10, 4, 0xfff0b0);
  }
  // 沙包工事
  for (let x = 60; x < W; x += 260) {
    for (let r = 0; r < 3; r++) for (let i = 0; i < 5 - r; i++) p.box(x + i * 13 + r * 6, B - 8 - r * 7, 14, 8, 0x8d7a54);
  }
  sidewalkTrim(p, W, 0x5a5444);
}

/** 國小：三層樓走廊式校舍、欄杆、教室窗、圍牆 */
function facadeSchool(p: Painter, W: number, _t: LocationTheme, rnd: Phaser.Math.RandomDataGenerator, signs: Sign[]): void {
  p.box(0, B - 132, W, 132, 0xd8c8a0, { outline: null });
  for (let f = 0; f < 3; f++) {
    const fy = B - 132 + f * 40;
    p.rect(0, fy + 34, W, 6, 0xb8a880);
    // 走廊欄杆
    for (let x = 0; x < W; x += 4) p.rect(x, fy + 26, 1, 8, 0x6a7a8a);
    p.rect(0, fy + 26, W, 1, 0x6a7a8a);
    for (let x = 12; x < W - 30; x += 64) {
      p.rect(x, fy + 6, 14, 28, 0x3a5a7a);
      p.window(x + 20, fy + 6, 34, 18, { glass: 0x2a3a48, broken: rnd.frac() < 0.2, lit: rnd.frac() < 0.04 });
    }
  }
  // 大鐘
  const cx = Math.min(W - 60, 420);
  p.circle(cx, B - 150, 10, OUTLINE);
  p.circle(cx, B - 150, 9, 0xf0f0e8);
  p.rect(cx, B - 157, 1, 7, OUTLINE);
  p.rect(cx, B - 150, 5, 1, OUTLINE);
  p.box(cx - 30, B - 160, 60, 22, 0xd8c8a0, { outline: null });
  p.circle(cx, B - 150, 9, 0xf0f0e8);
  p.rect(cx, B - 157, 1, 7, OUTLINE);
  p.rect(cx, B - 150, 5, 1, OUTLINE);
  signs.push({ x: cx + 80, y: B - 120, text: '光明國小', color: '#8a2a22', size: 9 });
  // 前面的圍牆
  for (let x = 0; x < W; x += 50) {
    p.box(x, B - 22, 50, 22, 0xc8b898, { light: 0.1 });
    p.rect(x + 1, B - 22, 48, 3, 0x9a2a22);
    p.rect(x + 22, B - 32, 6, 32, 0xb8a880);
  }
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
    const CEIL = 28;
    // 天花板：輕鋼架或水泥樑
    p.rect(0, 0, W, CEIL, 0x14161a);
    if (style === 'warehouse' || style === 'garage' || style === 'bunker') {
      for (let x = 0; x < W; x += 60) {
        p.rect(x, 0, 4, CEIL, 0x24272c);
        p.line(x, CEIL - 2, x + 30, 2, 0x24272c);
        p.line(x + 30, 2, x + 60, CEIL - 2, 0x24272c);
      }
      p.rect(0, 6, W, 4, 0x3a3e44);
    } else {
      for (let x = 0; x < W; x += 32) p.rect(x, 0, 1, CEIL, 0x24272c);
      p.rect(0, 13, W, 1, 0x24272c);
      // 空調出風口
      for (let x = 50; x < W; x += 210) p.box(x, 8, 18, 10, 0x6a6e74);
    }
    p.rect(0, CEIL, W, 2, 0x0a0b0d);
    const top = CEIL + 2;
    switch (style) {
      case 'store':
        wallTwoTone(p, W, top, 0xd8d4c8, 0xa8a090, 0.55);
        for (let x = 40; x < W; x += 150) {
          p.rect(x + 20, top, 1, 10, 0x2a2a2a);
          p.box(x, top + 10, 42, 12, rnd.pick([0x2a8a4a, 0xc83a2a, 0x2a6ac8]));
          signs.push({ x: x + 21, y: top + 16, text: rnd.pick(['生鮮', '飲料', '零食', '日用品', '冷凍', '泡麵']), color: '#ffffff', size: 7 });
        }
        break;
      case 'ward':
        // 上白下綠磁磚、扶手、房號
        wallTwoTone(p, W, top, 0xd0d8d0, 0x5a8a78, 0.5);
        for (let x = 0; x < W; x += 6) p.rect(x, top + Math.floor((B - top) * 0.5), 1, B - top, tone(0x5a8a78, -0.12));
        for (let y = top + Math.floor((B - top) * 0.5); y < B; y += 6) p.rect(0, y, W, 1, tone(0x5a8a78, -0.12));
        p.rect(0, B - 48, W, 3, 0x9aa0a6);
        for (let x = 60; x < W; x += 140) {
          p.box(x, top + 70, 16, 8, 0x2a4a6a);
          signs.push({ x: x + 8, y: top + 74, text: `${rnd.between(2, 4)}0${rnd.between(1, 9)}`, color: '#ffffff', size: 6 });
        }
        // 拖行的血跡
        for (let x = rnd.between(0, 200); x < W; x += rnd.between(240, 400)) p.dither(x, B - 30, rnd.between(20, 40), 4, 0x5a0a08, 0.4);
        break;
      case 'precinct':
        wallTwoTone(p, W, top, 0x7a8494, 0x5a3e28, 0.62);
        for (let x = 0; x < W; x += 10) p.rect(x, top + Math.floor((B - top) * 0.62), 1, B, tone(0x5a3e28, -0.2));
        p.rect(0, top + Math.floor((B - top) * 0.62) - 2, W, 2, 0x3a2a1c);
        for (let x = 30; x < W; x += 180) p.window(x, top + 14, 34, 40, { blinds: true, glass: 0x2a3440 });
        for (let x = 120; x < W; x += 360) {
          p.box(x, top + 20, 30, 20, 0x2a4a9a);
          p.circle(x + 15, top + 30, 6, 0xd0a030);
        }
        break;
      case 'house':
        wallTwoTone(p, W, top, 0xb8a88a, 0x6a4a30, 0.75);
        // 壁紙花紋
        for (let y = top + 4; y < B - 50; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) p.px(x, y, tone(0xb8a88a, -0.15));
        for (let x = 40; x < W; x += rnd.between(140, 220)) {
          // 相框、月曆、窗簾
          const k = rnd.frac();
          if (k < 0.4) {
            p.box(x, top + 30, 16, 20, 0x5a3e28);
            p.rect(x + 3, top + 33, 10, 14, rnd.pick([0x6a8a9a, 0x8a7a6a]));
          } else if (k < 0.7) {
            p.window(x, top + 22, 36, 34, { glass: 0x2a3440 });
            p.rect(x - 4, top + 18, 10, 44, 0x8a2a32);
            p.rect(x + 30, top + 18, 10, 44, 0x8a2a32);
            p.rect(x - 6, top + 17, 50, 2, 0x5a3e28);
          } else {
            p.box(x, top + 30, 14, 18, 0xf0f0e8);
            p.rect(x + 1, top + 31, 12, 4, 0xc83020);
          }
        }
        break;
      case 'garage':
        // 鐵皮牆、工具板、油漬
        p.rect(0, top, W, B - top, 0x5a5e62);
        for (let x = 0; x < W; x += 4) p.rect(x, top, 1, B - top, x % 8 === 0 ? 0x6a6e72 : 0x4a4e52);
        for (let x = 60; x < W; x += 260) {
          p.box(x, top + 30, 50, 30, 0x8a6a4a);
          for (let i = 0; i < 6; i++) p.rect(x + 5 + i * 7, top + 36, 2, rnd.between(8, 18), rnd.pick([0xc83020, 0x9aa0a6, 0x2a2a2a]));
        }
        for (let x = 30; x < W; x += 300) {
          p.window(x + 150, top + 8, 60, 14, { glass: 0x2a3440 });
        }
        break;
      case 'bunker':
        p.rect(0, top, W, B - top, 0x6a665a);
        for (let n = 0; n < W / 30; n++) p.line(rnd.between(0, W), top + rnd.between(0, 40), rnd.between(0, W), top + rnd.between(40, 80), 0x4a463c, 0.6);
        for (let x = 0; x < W; x += 14) for (let r = 0; r < 4; r++) p.box(x + (r % 2) * 7, B - 8 - r * 7, 15, 8, 0x8d7a54);
        for (let x = 80; x < W; x += 300) {
          p.box(x, top + 20, 60, 40, 0xd8c8a0);
          p.line(x + 6, top + 30, x + 40, top + 50, 0xc83020);
          p.rect(x + 10, top + 40, 20, 1, 0x3a6a3a);
        }
        break;
      case 'warehouse':
        p.rect(0, top, W, B - top, 0x4a4e52);
        for (let x = 0; x < W; x += 5) p.rect(x, top, 1, B - top, 0x3e4246);
        // 高架貨架
        for (let x = 10; x < W; x += 120) {
          p.rect(x, top + 10, 3, B - top - 10, 0xd8a020);
          p.rect(x + 90, top + 10, 3, B - top - 10, 0xd8a020);
          for (let y = top + 30; y < B; y += 40) {
            p.rect(x, y, 93, 3, 0x2a5a9a);
            for (let k = x + 4; k < x + 86; k += 22) if (rnd.frac() < 0.7) p.box(k, y - 18, 20, 18, rnd.pick([0xa8804a, 0x9a7a4a, 0x4a5a32]));
          }
        }
        for (let x = 50; x < W; x += 240) p.window(x, top + 2, 40, 10, { glass: 0x3a4a58 });
        break;
      case 'lobby':
      default:
        wallTwoTone(p, W, top, 0xa8a49a, 0x7a766c, 0.3);
        for (let x = 0; x < W; x += 80) {
          p.box(x, top, 16, B - top, 0xc8c4b8, { light: 0.15 });
        }
        for (let x = 24; x < W; x += 160) p.window(x, top + 20, 50, 80, { glass: 0x2a3440 });
        break;
    }
    // 踢腳板
    p.rect(0, B - 4, W, 4, 0x2a2a2a);
    p.rect(0, B - 4, W, 1, 0x4a4a4a);
  });
}

function wallTwoTone(p: Painter, W: number, top: number, upper: number, lower: number, split: number): void {
  const sy = top + Math.floor((B - top) * split);
  p.rect(0, top, W, sy - top, upper);
  p.rect(0, sy, W, B - sy, lower);
  p.rect(0, sy - 1, W, 2, tone(lower, -0.3));
  // 汙漬
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
