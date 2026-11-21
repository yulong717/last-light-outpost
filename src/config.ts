/** 固定邏輯解析度：480×270（16:9），放大到 1080p 剛好 4 倍。 */
export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;

/** 地面高度（角色腳底的 y）。 */
export const GROUND_Y = 222;

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
