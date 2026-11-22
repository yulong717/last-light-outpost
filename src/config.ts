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

/** 把腳底 y 夾在地面帶之內。 */
export function clampLaneY(y: number): number {
  return Math.min(LANE_BOTTOM, Math.max(LANE_TOP, y));
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
