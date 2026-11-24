/**
 * 場景資料：每個地點長什麼樣子、有哪些道具與可互動物件，以及每個探索事件要擺出的「場景佈置」。
 * 畫法在 src/scenery/SceneryBuilder.ts，互動邏輯在 src/scenery/PropSystem.ts，道具像素圖在 src/art/PropArt.ts。
 *
 * 原則：事件文字寫到的東西，畫面上一定要看得到（「停車場」就要有車、「公車頂」就要有公車）。
 */

import type { TerrainDef } from '../scenery/Terrain';

export type Setting = 'ext' | 'int';

/** 室外的主建築立面 */
export type FacadeStyle = 'gas' | 'market' | 'homes' | 'hospital' | 'police' | 'military' | 'street' | 'school' | 'parking' | 'rooftop' | 'alley' | 'islandshop' | 'gascenter';
/** 室內的牆面風格 */
export type InteriorStyle = 'garage' | 'store' | 'house' | 'ward' | 'precinct' | 'bunker' | 'warehouse' | 'lobby' | 'classroom';
export type FarStyle = 'city' | 'hills' | 'industrial';
export type FloorStyle = 'asphalt' | 'dirt' | 'concrete' | 'court' | 'tile' | 'linoleum' | 'wood' | 'checker';

/** 可互動的道具種類 */
export type InteractKind =
  /** 打兩槍或近戰點燃 → 爆炸，會連鎖 */
  | 'barrel'
  /** 打到就響警報：吸引霧屍（潛入時按 E 敲車窗當誘餌） */
  | 'car'
  /** 打爛掉出物資 */
  | 'crate'
  /** 路燈／日光燈：射掉會變暗（潛入陰影變大） */
  | 'light'
  /** 電箱：按 E 斷電，所有燈熄滅 */
  | 'fusebox'
  /** 門：戰鬥時霧屍從門裡衝出來；按 E 用木板封住 */
  | 'door'
  /** 玻璃窗：打破有碎玻璃 */
  | 'window'
  /** 掩體：擋路，霧屍得繞過去；潛入時躲在後面不容易被看到 */
  | 'cover';

/** 道具 id → 預設互動種類（沒列的就是純裝飾） */
export const PROP_KIND: Record<string, InteractKind> = {
  barrel: 'barrel',
  gascan: 'barrel',
  pump: 'barrel',
  car_red: 'car',
  car_blue: 'car',
  car_white: 'car',
  car_green: 'car',
  car_taxi: 'car',
  policecar: 'car',
  ambulance: 'car',
  crate: 'crate',
  ammobox: 'crate',
  lamppost: 'light',
  tubelight: 'light',
  fusebox: 'fusebox',
  door: 'door',
  glasswin: 'window',
  jersey: 'cover',
  sandbags: 'cover',
  counter: 'cover',
  shelf_low: 'cover',
  dumpster: 'cover',
  bus: 'cover',
  truck: 'cover',
  desk: 'cover',
  sofa: 'cover',
  bed: 'cover',
  forklift: 'cover',
  pallet: 'cover',
  tires: 'cover',
};

/**
 * 一個擺件。x：0..1 是世界寬度的比例，>1 是絕對座標。
 * lane：wall＝貼著後牆、back／mid／front＝地面帶的遠中近，數字＝腳底 y。
 */
export interface Piece {
  prop: string;
  x: number;
  lane?: 'wall' | 'back' | 'mid' | 'front' | number;
  flip?: boolean;
  /** 覆寫預設互動種類；null = 只當裝飾 */
  kind?: InteractKind | null;
  /** 特殊用途：exit 出口、protect 保護目標、loot 大獎物資 */
  role?: 'exit' | 'protect' | 'loot';
  /** 影格（例如燒毀的車 = 1） */
  frame?: number;
  scale?: number;
}

/** 隨機擺放的道具權重 */
export type PropWeights = Record<string, number>;

export interface LocationTheme {
  id: string;
  /** 室外天空（上→下） */
  sky: [number, number];
  far: FarStyle;
  facade: FacadeStyle;
  interior: InteriorStyle;
  floorExt: FloorStyle;
  floorInt: FloorStyle;
  /** 牆／地板主色 */
  wall: number;
  floor: number;
  /** 室內燈光顏色 */
  light: number;
  /** 地面帶隨機擺放的裝飾 */
  decorExt: PropWeights;
  decorInt: PropWeights;
  /** 每場隨機加幾個可互動道具（場景佈置裡寫死的另外算） */
  extrasExt: PropWeights;
  extrasInt: PropWeights;
  /** 室內的貼牆道具 */
  wallInt: PropWeights;
}

const CARS = { car_red: 1, car_blue: 1, car_white: 1, car_green: 0.6, car_taxi: 0.5 };

export const THEMES: Record<string, LocationTheme> = {
  gas: {
    id: 'gas',
    sky: [0x2a2030, 0x8a5a48],
    far: 'hills',
    facade: 'gas',
    interior: 'garage',
    floorExt: 'asphalt',
    floorInt: 'concrete',
    wall: 0x4a4236,
    floor: 0x34302a,
    light: 0xffe0a0,
    decorExt: { tires: 2, cone: 2, trashbags: 1, debris: 1.5, gascan: 0.6 },
    decorInt: { tires: 2, boxes: 1, debris: 1, gascan: 1 },
    extrasExt: { barrel: 3, ...CARS, crate: 1 },
    extrasInt: { barrel: 2, crate: 2 },
    wallInt: { locker: 1, shelf: 1, fridge: 1.5, fusebox: 0.6 },
  },
  market: {
    id: 'market',
    sky: [0x1e2430, 0x5a6470],
    far: 'city',
    facade: 'market',
    interior: 'store',
    floorExt: 'asphalt',
    floorInt: 'checker',
    wall: 0x3c4840,
    floor: 0x2c3330,
    light: 0xe8f4ff,
    decorExt: { cart: 3, trashbags: 1, cone: 1, debris: 1 },
    decorInt: { cart: 2, boxes: 1, debris: 1 },
    extrasExt: { ...CARS, crate: 1, barrel: 0.5 },
    extrasInt: { crate: 2, shelf_low: 2, counter: 1 },
    wallInt: { shelf: 4, fridge: 2, fusebox: 0.5 },
  },
  homes: {
    id: 'homes',
    sky: [0x1c2034, 0x6a6080],
    far: 'city',
    facade: 'homes',
    interior: 'house',
    floorExt: 'asphalt',
    floorInt: 'wood',
    wall: 0x403c4a,
    floor: 0x2e2c34,
    light: 0xffd8a0,
    decorExt: { scooter: 3, trashbags: 2, plant: 2, hydrant: 0.6, debris: 1 },
    decorInt: { plant: 1, boxes: 0.6, debris: 1 },
    extrasExt: { scooter: 1, car_white: 1, car_red: 0.6, crate: 1, gascan: 0.5 },
    extrasInt: { sofa: 1, crate: 1.5 },
    wallInt: { wardrobe: 2, shrine: 1, tv: 1, plant: 1 },
  },
  hospital: {
    id: 'hospital',
    sky: [0x1a2028, 0x5a6a70],
    far: 'city',
    facade: 'hospital',
    interior: 'ward',
    floorExt: 'concrete',
    floorInt: 'linoleum',
    wall: 0x48545a,
    floor: 0x2a3034,
    light: 0xe0fff0,
    decorExt: { wheelchair: 1, debris: 1, trashbags: 1, cone: 0.6 },
    decorInt: { wheelchair: 2, ivstand: 2, debris: 0.6 },
    extrasExt: { ambulance: 1, car_white: 1, crate: 1 },
    extrasInt: { bed: 2, crate: 1, gascan: 0.3 },
    wallInt: { door: 2, filecab: 1, redcross: 0.6, fusebox: 0.5 },
  },
  police: {
    id: 'police',
    sky: [0x181c2a, 0x4a5470],
    far: 'city',
    facade: 'police',
    interior: 'precinct',
    floorExt: 'asphalt',
    floorInt: 'tile',
    wall: 0x353c4c,
    floor: 0x272b34,
    light: 0xe8f0ff,
    decorExt: { cone: 2, jersey: 1, debris: 1, trashbags: 0.6 },
    decorInt: { boxes: 1, debris: 1 },
    extrasExt: { policecar: 2, car_white: 0.6, barrel: 0.6, crate: 1 },
    extrasInt: { desk: 2, crate: 1, ammobox: 0.6 },
    wallInt: { filecab: 2, locker: 2, noticeboard: 1, door: 1, fusebox: 0.5 },
  },
  checkpoint: {
    id: 'checkpoint',
    sky: [0x22241e, 0x6a6a50],
    far: 'hills',
    facade: 'military',
    interior: 'bunker',
    floorExt: 'dirt',
    floorInt: 'concrete',
    wall: 0x44463a,
    floor: 0x2e2f28,
    light: 0xfff0c0,
    decorExt: { cone: 1, debris: 1.5, tires: 0.6, corpse: 1 },
    decorInt: { boxes: 1, radio: 1, corpse: 0.6 },
    extrasExt: { barrel: 3, ammobox: 2, jersey: 1.5, sandbags: 1.5, truck: 0.6 },
    extrasInt: { ammobox: 2, sandbags: 1, barrel: 1 },
    wallInt: { locker: 1, radio: 1, gunlocker: 0.6, fusebox: 0.5 },
  },

  // ── 守城據點 ──
  street: {
    id: 'street',
    sky: [0x161a24, 0x3a4050],
    far: 'city',
    facade: 'street',
    interior: 'store',
    floorExt: 'asphalt',
    floorInt: 'tile',
    wall: 0x3a3c44,
    floor: 0x2b2f36,
    light: 0xffe0a0,
    decorExt: { trashbags: 2, debris: 3, cone: 1, scooter: 1.5, corpse: 1 },
    decorInt: {},
    extrasExt: {},
    extrasInt: {},
    wallInt: {},
  },
  gasstation: {
    id: 'gasstation',
    sky: [0x1c1820, 0x5a3e3a],
    far: 'hills',
    facade: 'gas',
    interior: 'garage',
    floorExt: 'asphalt',
    floorInt: 'concrete',
    wall: 0x4a4236,
    floor: 0x302c28,
    light: 0xffe0a0,
    decorExt: { tires: 2, cone: 2, debris: 2, corpse: 1 },
    decorInt: {},
    extrasExt: {},
    extrasInt: {},
    wallInt: {},
  },
  school: {
    id: 'school',
    sky: [0x181c28, 0x485468],
    far: 'city',
    facade: 'school',
    interior: 'lobby',
    floorExt: 'court',
    floorInt: 'tile',
    wall: 0x4a4a44,
    floor: 0x2e3a34,
    light: 0xfff0c0,
    decorExt: { bench: 1, debris: 2, corpse: 1, trashbags: 1 },
    decorInt: {},
    extrasExt: {},
    extrasInt: {},
    wallInt: {},
  },
};

/** 探索事件的場景佈置：事件文字寫到的東西要真的擺出來 */
export interface SetDressing {
  setting: Setting;
  /** 覆寫區域的立面／室內風格（例如停車場、倉庫、大廳） */
  facade?: FacadeStyle;
  interior?: InteriorStyle;
  pieces: Piece[];
  /** 不要隨機加可互動道具（場景已經很滿） */
  noExtras?: boolean;
  /** 室內燈光：dim 比較暗、dark 只剩緊急燈 */
  mood?: 'normal' | 'dim' | 'dark';
}

export const EVENT_SETS: Record<string, SetDressing> = {
  // ── 一般事件（事件卡背景） ──
  stash: {
    setting: 'int',
    interior: 'warehouse',
    pieces: [
      { prop: 'boxes', x: 0.42, lane: 'back' },
      { prop: 'boxes', x: 0.55, lane: 'back', flip: true },
      { prop: 'crate', x: 0.5, lane: 'mid' },
      { prop: 'door', x: 0.3, lane: 'wall', frame: 1, kind: null },
    ],
  },
  locked: {
    setting: 'int',
    pieces: [
      { prop: 'locker', x: 0.47, lane: 'wall' },
      { prop: 'locker', x: 0.5, lane: 'wall' },
      { prop: 'gunlocker', x: 0.54, lane: 'wall' },
    ],
  },
  floor: {
    setting: 'int',
    mood: 'dim',
    pieces: [
      { prop: 'hole', x: 0.5, lane: 'back' },
      { prop: 'debris', x: 0.38, lane: 'back' },
      { prop: 'debris', x: 0.62, lane: 'back', flip: true },
    ],
  },
  ambush: {
    setting: 'int',
    interior: 'house',
    pieces: [
      { prop: 'wardrobe', x: 0.5, lane: 'wall', frame: 1 },
      { prop: 'sofa', x: 0.36, lane: 'back', kind: null },
    ],
  },
  door: {
    setting: 'int',
    interior: 'warehouse',
    pieces: [
      { prop: 'shutter', x: 0.5, lane: 'wall' },
      { prop: 'pallet', x: 0.34, lane: 'back', kind: null },
    ],
  },
  trader: {
    setting: 'ext',
    pieces: [
      { prop: 'trader', x: 0.52, lane: 'back' },
      { prop: 'campfire', x: 0.46, lane: 'back' },
      { prop: 'tarp', x: 0.6, lane: 'back' },
    ],
  },
  wounded: {
    setting: 'int',
    mood: 'dim',
    pieces: [
      { prop: 'wounded', x: 0.5, lane: 'back' },
      { prop: 'corpse', x: 0.6, lane: 'mid' },
      { prop: 'boxes', x: 0.4, lane: 'back' },
    ],
  },
  trap: {
    setting: 'int',
    mood: 'dim',
    pieces: [
      { prop: 'tripwire', x: 0.5, lane: 'back' },
      { prop: 'door', x: 0.42, lane: 'wall', kind: null },
    ],
  },

  // ── 序章：阿凱的學校，一層一層往下逃（src/data/prologue.ts） ──
  pro_roof: {
    setting: 'ext',
    facade: 'rooftop',
    mood: 'dim',
    pieces: [
      { prop: 'debris', x: 0.3, lane: 'back', kind: null },
      { prop: 'bench', x: 0.12, lane: 'back', kind: null },
    ],
    noExtras: true,
  },
  pro_4f: {
    setting: 'int',
    interior: 'classroom',
    mood: 'dim',
    pieces: [
      { prop: 'locker', x: 0.18, lane: 'wall' },
      { prop: 'locker', x: 0.21, lane: 'wall' },
      { prop: 'desk', x: 0.42, lane: 'back', kind: null },
      { prop: 'corpse', x: 0.6, lane: 'back', kind: null },
      { prop: 'locker', x: 0.78, lane: 'wall' },
    ],
    noExtras: true,
  },
  pro_3f: {
    setting: 'int',
    interior: 'classroom',
    mood: 'dark',
    pieces: [
      { prop: 'locker', x: 0.1, lane: 'wall' },
      { prop: 'desk', x: 0.3, lane: 'back', kind: null },
      { prop: 'locker', x: 0.52, lane: 'wall' },
      { prop: 'desk', x: 0.66, lane: 'back', kind: null },
      { prop: 'noticeboard', x: 0.84, lane: 'wall' },
    ],
    noExtras: true,
  },
  pro_2f: {
    setting: 'int',
    interior: 'classroom',
    mood: 'dim',
    pieces: [
      // 對準走廊牆上畫的教室前門（每 300px 一扇，門寬 32）
      { prop: 'door', x: 376, lane: 'wall' },
      { prop: 'door', x: 676, lane: 'wall' },
      { prop: 'door', x: 976, lane: 'wall' },
      { prop: 'locker', x: 0.15, lane: 'wall' },
      { prop: 'desk', x: 0.68, lane: 'back', kind: null },
    ],
    noExtras: true,
  },
  pro_1f: {
    setting: 'int',
    interior: 'lobby',
    mood: 'dim',
    pieces: [
      { prop: 'noticeboard', x: 0.2, lane: 'wall' },
      { prop: 'plant', x: 0.35, lane: 'wall' },
      { prop: 'shutter', x: 0.5, lane: 'wall', kind: null },
      { prop: 'plant', x: 0.65, lane: 'wall' },
      { prop: 'bench', x: 0.8, lane: 'back', kind: null },
    ],
    noExtras: true,
  },

  // ── 會進戰鬥／潛入的事件 ──
  sleepers: {
    setting: 'int',
    interior: 'lobby',
    mood: 'dim',
    pieces: [
      { prop: 'bench', x: 0.25, lane: 'back' },
      { prop: 'plant', x: 0.15, lane: 'wall' },
      { prop: 'counter', x: 0.45, lane: 'back' },
      { prop: 'bench', x: 0.62, lane: 'front' },
      { prop: 'plant', x: 0.7, lane: 'wall' },
      { prop: 'fusebox', x: 0.08, lane: 'wall' },
      { prop: 'boxes', x: 0.93, lane: 'back', role: 'loot' },
    ],
  },
  patrol: {
    setting: 'ext',
    facade: 'parking',
    pieces: [
      { prop: 'car_red', x: 0.22, lane: 'back' },
      { prop: 'car_white', x: 0.4, lane: 'front' },
      { prop: 'car_blue', x: 0.58, lane: 'back' },
      { prop: 'car_taxi', x: 0.76, lane: 'mid', flip: true },
      { prop: 'lamppost', x: 0.32, lane: 'wall' },
      { prop: 'lamppost', x: 0.68, lane: 'wall' },
      { prop: 'cart', x: 0.5, lane: 'mid' },
    ],
    noExtras: true,
  },
  trapped: {
    setting: 'ext',
    facade: 'street',
    pieces: [
      { prop: 'bus', x: 300, lane: 'mid', role: 'protect' },
      { prop: 'car_red', x: 0.62, lane: 'back', frame: 1 },
      { prop: 'barrel', x: 0.55, lane: 'front' },
      { prop: 'lamppost', x: 0.18, lane: 'wall' },
      { prop: 'lamppost', x: 0.78, lane: 'wall' },
    ],
  },
  quiet: {
    setting: 'ext',
    facade: 'street',
    pieces: [
      { prop: 'door', x: 0.9, lane: 'wall', kind: null },
      { prop: 'trashbags', x: 0.7, lane: 'back' },
      { prop: 'scooter', x: 0.4, lane: 'back', kind: null },
      { prop: 'lamppost', x: 0.55, lane: 'wall' },
    ],
  },
  hold: {
    setting: 'int',
    interior: 'warehouse',
    pieces: [
      { prop: 'pallet', x: 0.18, lane: 'back' },
      { prop: 'pallet', x: 0.24, lane: 'front' },
      { prop: 'ammobox', x: 0.2, lane: 'mid', kind: null },
      { prop: 'forklift', x: 0.45, lane: 'back' },
      { prop: 'barrel', x: 0.62, lane: 'back' },
      { prop: 'barrel', x: 0.65, lane: 'mid' },
      { prop: 'door', x: 0.8, lane: 'wall' },
      { prop: 'door', x: 0.4, lane: 'wall' },
    ],
  },
  cache: {
    setting: 'ext',
    pieces: [
      { prop: 'tarp', x: 0.92, lane: 'back', role: 'loot' },
      { prop: 'boxes', x: 0.95, lane: 'mid' },
      { prop: 'dumpster', x: 0.5, lane: 'back' },
      { prop: 'campfire', x: 0.3, lane: 'mid' },
    ],
  },
  shelter: {
    setting: 'ext',
    facade: 'homes',
    pieces: [
      { prop: 'barricadedoor', x: 300, lane: 'wall', role: 'protect' },
      { prop: 'car_white', x: 0.6, lane: 'back' },
      { prop: 'barrel', x: 0.72, lane: 'mid' },
      { prop: 'lamppost', x: 0.5, lane: 'wall' },
    ],
  },
  armory: {
    setting: 'int',
    interior: 'precinct',
    pieces: [
      { prop: 'gunlocker', x: 0.62, lane: 'wall', role: 'loot' },
      { prop: 'gunlocker', x: 0.65, lane: 'wall' },
      { prop: 'gunlocker', x: 0.68, lane: 'wall' },
      { prop: 'ammobox', x: 0.55, lane: 'back' },
      { prop: 'door', x: 0.9, lane: 'wall' },
      { prop: 'door', x: 0.3, lane: 'wall' },
    ],
  },
  horde: {
    setting: 'ext',
    facade: 'street',
    mood: 'dim',
    pieces: [
      { prop: 'car_blue', x: 0.35, lane: 'back', frame: 1, kind: 'cover' },
      { prop: 'barrel', x: 0.5, lane: 'mid' },
      { prop: 'barrel', x: 0.53, lane: 'back' },
      { prop: 'jersey', x: 0.25, lane: 'front' },
      { prop: 'car_red', x: 0.7, lane: 'front' },
    ],
  },
};

/** 每個區域「第一次抵達」的開場佈置（事件卡背景） */
export const ARRIVAL_SETS: Record<string, SetDressing> = {
  gas: { setting: 'ext', pieces: [{ prop: 'pump', x: 0.42, lane: 'back' }, { prop: 'pump', x: 0.55, lane: 'back' }, { prop: 'car_white', x: 0.7, lane: 'mid', frame: 1 }] },
  market: { setting: 'ext', pieces: [{ prop: 'cart', x: 0.4, lane: 'back' }, { prop: 'car_red', x: 0.6, lane: 'back' }] },
  homes: { setting: 'ext', pieces: [{ prop: 'scooter', x: 0.42, lane: 'back' }, { prop: 'scooter', x: 0.47, lane: 'back' }, { prop: 'trashbags', x: 0.6, lane: 'back' }] },
  hospital: { setting: 'ext', pieces: [{ prop: 'ambulance', x: 0.5, lane: 'back' }, { prop: 'wheelchair', x: 0.65, lane: 'back' }] },
  police: { setting: 'ext', pieces: [{ prop: 'policecar', x: 0.45, lane: 'back' }, { prop: 'jersey', x: 0.6, lane: 'back' }] },
  checkpoint: { setting: 'ext', pieces: [{ prop: 'truck', x: 0.5, lane: 'back' }, { prop: 'sandbags', x: 0.66, lane: 'back' }] },
};

// ── 守城據點地圖 ─────────────────────────────────────

export interface OutpostMapDef {
  id: string;
  name: string;
  blurb: string;
  /** 特色（選單上的小字） */
  perks: string[];
  theme: string;
  /** 覆寫主題的建築立面 */
  facade?: FacadeStyle;
  /** 戰場上的固定擺件（x 是世界座標，戰場寬 1280；建築槽位在 120～400，別擋到） */
  pieces: Piece[];
  /** 每天白天重新補上的油桶與物資箱位置 */
  barrels: number[];
  crates: number[];
  /**
   * 單軸據點（窄巷）：大家都在同一條線上，鏡頭拉近；只有一個入口。
   * waves：夜晚霧屍數量倍率；runners：平民霧屍換成跑者的比例；slots：開放的建築槽位（不填 = 全部）。
   */
  single?: { waves: number; runners: number; slots: string[] };
  /**
   * 雙面據點（孤島小店）：據點在戰場正中間，左右各一道路障，霧屍同時從兩邊來。
   * waves：夜晚霧屍數量倍率；slots：開放的建築槽位（src/data/buildings.ts 的 DUAL_SLOTS）。
   * 隊員白天在戰場上點一下就能換守左邊或右邊。
   */
  dual?: { waves: number; slots: string[] };
  /** 不擺隨機道具的範圍（據點、路障、槽位附近）；不填 = [[0, 430]] */
  keepClear?: [number, number][];
  /** 地形：立體障礙物、減速地面、油漬（src/scenery/Terrain.ts） */
  terrain?: TerrainDef[];
}

export const OUTPOST_MAPS: OutpostMapDef[] = [
  {
    id: 'street',
    name: '街口據點',
    blurb: '十字路口的五金行，左右都是倒塌的店面。',
    perks: ['倒塌的騎樓把路切成之字形', '路口積水拖慢霧屍', '廢棄車輛可觸發警報引怪'],
    theme: 'street',
    terrain: [
      { kind: 'block', style: 'rubble', x0: 540, x1: 600, y0: 226, y1: 270, height: 30 },
      { kind: 'block', style: 'concrete', x0: 770, x1: 840, y0: 302, y1: 346, height: 26 },
      { kind: 'water', x0: 670, x1: 760, y0: 288, y1: 330 },
    ],
    pieces: [
      { prop: 'car_red', x: 640, lane: 266 },
      { prop: 'car_white', x: 930, lane: 318, flip: true, frame: 1, kind: 'cover' },
      { prop: 'jersey', x: 520, lane: 338 },
      { prop: 'lamppost', x: 470, lane: 'wall' },
      { prop: 'lamppost', x: 820, lane: 'wall' },
      { prop: 'dumpster', x: 1080, lane: 250 },
      { prop: 'hydrant', x: 720, lane: 'back', kind: null },
    ],
    barrels: [560, 760, 1010],
    crates: [880],
  },
  {
    id: 'gasstation',
    name: '加油站',
    blurb: '公路中間的加油站，便利商店夾在兩頭公路之間。霧屍沿著公路從兩邊來，地上全是漏出來的油。',
    perks: ['單軸雙向：公路兩頭同時來霧屍', '油漬會被爆炸點燃，整片燒起來', '加油機與油桶：連鎖爆炸'],
    theme: 'gasstation',
    facade: 'gascenter',
    pieces: [
      { prop: 'pump', x: 300, lane: 'back' },
      { prop: 'pump', x: 420, lane: 'back' },
      { prop: 'pump', x: 1050, lane: 'back' },
      { prop: 'pump', x: 1170, lane: 'back' },
      { prop: 'car_taxi', x: 160, lane: 'back' },
      { prop: 'tires', x: 1000, lane: 'back' },
      { prop: 'lamppost', x: 980, lane: 'wall' },
    ],
    barrels: [430, 870],
    crates: [1240],
    keepClear: [[470, 810]],
    single: {
      waves: 1.3,
      runners: 0.3,
      slots: ['R-tower-far', 'R-tower-near', 'R-front-2', 'R-mid-2', 'L-tower-far', 'L-tower-near', 'L-front-2', 'L-mid-2'],
    },
    dual: { waves: 1, slots: [] },
    terrain: [
      { kind: 'oil', x0: 380, x1: 460, y0: 272, y1: 308 },
      { kind: 'oil', x0: 830, x1: 910, y0: 272, y1: 308 },
    ],
  },
  {
    id: 'school',
    name: '國小校園',
    blurb: '圍牆內的操場，校車還停在門口，教室裡留著學童的書包。',
    perks: ['校門窄口：霧屍只能從中間擠進來', '沙坑讓霧屍陷住', '物資箱較多'],
    theme: 'school',
    terrain: [
      { kind: 'block', style: 'brick', x0: 600, x1: 640, y0: 226, y1: 266, height: 26 },
      { kind: 'block', style: 'brick', x0: 600, x1: 640, y0: 314, y1: 346, height: 26 },
      { kind: 'sand', x0: 440, x1: 540, y0: 244, y1: 286 },
    ],
    pieces: [
      { prop: 'bus', x: 760, lane: 262, kind: 'cover' },
      { prop: 'hoop', x: 560, lane: 'wall' },
      { prop: 'hoop', x: 1060, lane: 'wall', flip: true },
      { prop: 'bench', x: 500, lane: 330 },
      { prop: 'sandbags', x: 980, lane: 336 },
      { prop: 'lamppost', x: 900, lane: 'wall' },
    ],
    barrels: [620],
    crates: [540, 900, 1120],
  },
  {
    id: 'alley',
    name: '後巷鐵捲門',
    blurb: '兩棟樓中間的窄巷，盡頭是一扇拉下一半的鐵捲門。只有一個入口，霧屍只能排成一列擠進來。',
    perks: ['單軸：只有一個入口，好守', '霧屍量多、跑得快，打起來爽快', '巷口積水拖慢霧屍'],
    theme: 'street',
    terrain: [{ kind: 'water', x0: 560, x1: 660, y0: 276, y1: 304 }],
    facade: 'alley',
    pieces: [
      { prop: 'dumpster', x: 620, lane: 'back' },
      { prop: 'trashbags', x: 700, lane: 'back' },
      { prop: 'trashbags', x: 980, lane: 'back' },
      { prop: 'lamppost', x: 520, lane: 'wall' },
      { prop: 'lamppost', x: 1000, lane: 'wall' },
    ],
    barrels: [820],
    crates: [],
    single: { waves: 1.45, runners: 0.35, slots: ['tower-far', 'tower-near', 'front-2', 'mid-2'] },
  },
];

OUTPOST_MAPS.push({
  id: 'islandshop',
  name: '孤島小店',
  blurb: '空曠路口正中間的 24 小時便利商店，燈還亮著。四面都沒有遮蔽，霧屍會從左右兩邊同時湧上來。',
  perks: ['雙面防守：左右各一道路障', '隊員分配到兩側，主角居中支援', '停車場花台把路分成上下兩條'],
  theme: 'street',
  facade: 'islandshop',
  pieces: [
    { prop: 'car_white', x: 140, lane: 300, frame: 1, kind: 'cover' },
    { prop: 'lamppost', x: 200, lane: 'wall' },
    { prop: 'trashbags', x: 70, lane: 'back' },
    { prop: 'car_red', x: 1130, lane: 270, flip: true },
    { prop: 'lamppost', x: 1080, lane: 'wall' },
    { prop: 'jersey', x: 1220, lane: 330 },
  ],
  barrels: [250, 1030],
  crates: [60, 1210],
  dual: {
    waves: 1.2,
    slots: ['R-tower-far', 'R-tower-near', 'R-front-1', 'R-front-2', 'R-front-3', 'R-mid-2', 'L-tower-far', 'L-tower-near', 'L-front-1', 'L-front-2', 'L-front-3', 'L-mid-2'],
  },
  keepClear: [[290, 990]],
  terrain: [
    { kind: 'block', style: 'planter', x0: 320, x1: 380, y0: 270, y1: 300, height: 16 },
    { kind: 'block', style: 'planter', x0: 900, x1: 960, y0: 270, y1: 300, height: 16 },
    { kind: 'block', style: 'container', x0: 60, x1: 150, y0: 226, y1: 262, height: 48 },
    { kind: 'mud', x0: 1000, x1: 1100, y0: 300, y1: 346 },
  ],
});

export function getOutpostMap(id: string | undefined): OutpostMapDef {
  return OUTPOST_MAPS.find((m) => m.id === id) ?? OUTPOST_MAPS[0];
}

/** 互動道具的數值 */
export const PROP_TUNING = {
  barrel: { hp: 30, radius: 70, damage: 160, chainDelay: 0.18, playerDamage: 35, fuse: 1.6 },
  pump: { hp: 60, radius: 96, damage: 220 },
  car: { hp: 260, alarmTime: 9, lureRange: 420, noise: 15 },
  crate: { hp: 24 },
  light: { hp: 1 },
  /** 潛入：亮處被發現速度倍率、斷電後的倍率 */
  stealthLit: 1.5,
  stealthDark: 0.7,
  /** 封門要幾秒 */
  boardTime: 1.2,
};
