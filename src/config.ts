/** 固定邏輯解析度：640×360（16:9），放大 2 倍為 720p、3 倍為 1080p，都是整數倍。 */
export const GAME_WIDTH = 640;
export const GAME_HEIGHT = 360;

/** 地平線：地面帶從這裡開始往下畫（上方是天空與遠景）。 */
export const GROUND_Y = 206;

/**
 * 2.5D 地面帶：角色「腳底 y」可活動的上下範圍。
 * y 越小越遠（畫面越上方），繪製順序也依腳底 y 排序。
 */
export const LANE_TOP = 226;
export const LANE_BOTTOM = 346;

/** 戰場寬度（世界座標），比畫面寬，鏡頭跟著主角捲動。 */
export const WORLD_WIDTH = 1280;

/**
 * 單軸（橫向捲軸）模式：所有人的腳底都壓在同一條線上，只能左右移動。
 * 探索的「沿街前進」與窄走廊事件會打開，場景結束時關掉。
 */
export const SINGLE_LANE_Y = 290;
let laneLock: [number, number] | null = null;

export function setSingleLane(on: boolean): void {
  laneLock = on ? [SINGLE_LANE_Y - 2, SINGLE_LANE_Y + 2] : null;
}

export function singleLane(): boolean {
  return laneLock !== null;
}

/**
 * 多樓層模式（爛尾樓、透天厝據點）：戰場分成好幾層，每層是一條路（腳底 y 固定在那層的地板上），
 * 或是一整條 2.5D 地面帶（透天厝的一樓院子，band）。由下往上排：[1F, 2F, 頂樓…]。
 * 換樓層只能走樓梯（DefenseScene 處理），一般移動、推擠、繞路都會被夾回原本那一層。
 */
let floorBands: [number, number][] | null = null;
/** 單線樓層的地板上下能偏多少（一點點縱深，不然整排疊成一條線） */
export const FLOOR_BAND = 3;

/** ys：每層地板 y；bands：這層是一整條地面帶時填 [上緣, 下緣] */
export function setFloors(ys: number[] | null, bands?: ([number, number] | undefined)[]): void {
  floorBands = ys ? ys.map((y, i) => bands?.[i] ?? [y - FLOOR_BAND, y + FLOOR_BAND]) : null;
}

/** 目前各層的代表 y（單線樓層就是地板 y，地面帶取中間）；不是多樓層模式就是 null */
export function floorLevels(): number[] | null {
  return floorBands ? floorBands.map(([a, b]) => (a + b) / 2) : null;
}

/** 腳底 y 在第幾層（0 = 1F）；不是多樓層模式一律 0 */
export function floorOf(y: number): number {
  if (!floorBands) return 0;
  const dist = ([a, b]: [number, number]) => (y < a ? a - y : y > b ? y - b : 0);
  let best = 0;
  for (let i = 1; i < floorBands.length; i++) if (dist(floorBands[i]) < dist(floorBands[best])) best = i;
  return best;
}

/** 這一層可以站的 y 範圍 */
export function floorBand(i: number): [number, number] | null {
  return floorBands?.[i] ?? null;
}

/** 把腳底 y 夾在地面帶之內（單軸模式時夾在那條線上；多樓層時夾在最近那一層）。 */
export function clampLaneY(y: number): number {
  if (floorBands) {
    const [a, b] = floorBands[floorOf(y)];
    return Math.min(b, Math.max(a, y));
  }
  const [top, bottom] = laneLock ?? [LANE_TOP, LANE_BOTTOM];
  return Math.min(bottom, Math.max(top, y));
}

/** 會飛的（烏鴉）：多樓層時可以在各層之間自由移動，只夾在最低與最高層之間 */
export function clampFlyY(y: number): number {
  if (!floorBands) return clampLaneY(y);
  return Math.min(Math.max(...floorBands.map((b) => b[1])), Math.max(Math.min(...floorBands.map((b) => b[0])), y));
}

/** 依腳底 y 算出繪製深度；特效、HUD 用更大的固定值蓋在上面。 */
export function depthForY(y: number): number {
  return 10 + y / 10;
}
export const DEPTH_FX = 60;

/** 色塊佔位用的顏色，日後換成像素圖時刪掉即可。 */
export const PLACEHOLDER_COLORS = {
  player: 0x4caf50,
  zombieBasic: 0xc0392b,
  zombieRunner: 0xe67e22,
  zombieBrute: 0x8e44ad,
  barricade: 0x8d6e63,
  bullet: 0xfff176,
  ground: 0x2b2f36,
  sky: 0x1b1f27,
  fog: 0x9aa3ad,
} as const;
