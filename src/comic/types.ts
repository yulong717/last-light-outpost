/**
 * 漫畫分格敘事（Sequential Comic Panel Cinematic）的劇本格式。
 *
 * 一段演出 = 一串 Beat（節拍），由 ComicSequencer 依序執行：
 * 新畫格一格一格進場、舊畫格保留在畫面上並退到背景（變暗、褪色、微縮），最新的畫格永遠是焦點。
 * 劇情導入、過場、角色介紹、事件 QTE 全部共用這一套。說明見 docs/COMIC_CINEMATICS.md。
 *
 * 座標一律是 640×360 的邏輯像素；畫格內的文字、擬聲字座標是「畫格左上角為原點」的像素。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 畫格進場方式
 * - slide-*：從畫面外滑進來（left = 從左邊進來）
 * - zoom：從小放大浮現
 * - unfold-x / unfold-y：像拉開百葉一樣展開
 * - wipe-*：外框先出現，畫面從一側裁切揭露（wipe-right = 由左往右揭開）
 * - slam：重大事件——放大砸進畫面、白閃、震動、速度線
 * - cut：直接出現
 */
export type PanelEnter =
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'zoom'
  | 'unfold-x'
  | 'unfold-y'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-down'
  | 'slam'
  | 'cut';

/** 格內鏡頭：zoom 1 = 剛好蓋滿畫格；x / y 是插圖上的焦點（0..1） */
export interface PanelCam {
  zoom?: number;
  x?: number;
  y?: number;
}

export type TextKind =
  /** 旁白框：方形黃底黑字（預設） */
  | 'caption'
  /** 對白泡泡：白底圓角＋尾巴 */
  | 'speech'
  /** 心聲：白底、虛線框、小圓點尾巴 */
  | 'thought'
  /** 大喊：鋸齒框 */
  | 'shout';

export interface PanelText {
  text: string;
  kind?: TextKind;
  /** 文字框左上角（畫格內座標） */
  x: number;
  y: number;
  /** 最大寬度（預設依畫格寬度） */
  w?: number;
  /** 對白尾巴指向的點（畫格內座標） */
  tail?: [number, number];
  /** 進場後幾毫秒才出現 */
  delay?: number;
}

/** 擬聲字：大字、斜放、描黑邊、彈出來 */
export interface PanelSfx {
  text: string;
  x: number;
  y: number;
  size?: number;
  angle?: number;
  color?: string;
  delay?: number;
}

/** 畫格特效 */
export type PanelFx =
  /** 放射速度線（會閃動），焦點用 cam 的 x / y */
  | 'speed'
  /** 水平速度線 */
  | 'dash'
  /** 整個畫面白閃 */
  | 'flash'
  /** 鏡頭震動 */
  | 'shake'
  /** 網點覆蓋（回憶、定格的質感） */
  | 'halftone'
  /** 紅色衝擊染色 */
  | 'red';

/**
 * 突破畫格邊界的物件：畫在遮罩外面，角色的手、刀、飛出來的碎片可以伸出格子。
 * x / y 是物件中心在畫格內的座標（可以超出 0..w / 0..h）。
 */
export interface PanelPop {
  art: string;
  x: number;
  y: number;
  scale?: number;
  /** 進場後幾毫秒才衝出來 */
  delay?: number;
  /** 從哪個方向衝出來（偏移量，像素） */
  from?: [number, number];
}

export interface PanelBeat {
  type: 'panel';
  /** 之後 focus / move / remove 用的名字 */
  id: string;
  /** 插圖 id（src/comic/art.ts 解析：qte/<事件>/<格> 或 CinemaArt 的 id） */
  art: string;
  rect: Rect;
  /** 整格傾斜角度（度），做出非對稱版面 */
  tilt?: number;
  enter?: PanelEnter;
  /** 進場動畫長度（毫秒） */
  dur?: number;
  /** 格內運鏡：from → to，持續 camDur 毫秒（預設跟停留時間一樣長） */
  cam?: { from?: PanelCam; to?: PanelCam; dur?: number };
  texts?: PanelText[];
  sfx?: PanelSfx[];
  fx?: PanelFx[];
  pop?: PanelPop;
  /** 整格壓暗（0..1），例如 QTE 動作格 */
  shade?: number;
  /** 外框顏色（預設黑） */
  border?: number;
  /** 進場後停留多久才往下走（毫秒），'tap' = 等玩家點一下；預設依文字量 */
  hold?: number | 'tap';
  /** 進場音效（AudioManager 的音效名） */
  sound?: string;
  /** false：舊畫格不退到背景（同時並列的格子） */
  dimOthers?: boolean;
}

export type Beat =
  | PanelBeat
  /** 定格：白閃、焦點格停住、蓋上網點 */
  | { type: 'freeze'; id?: string; hold?: number | 'tap'; sound?: string }
  /** 把舊畫格叫回焦點（回想、對照） */
  | { type: 'focus'; id: string; hold?: number | 'tap' }
  /** 重新排版：畫格移動／縮放到新位置（讓出空間給新畫格） */
  | { type: 'move'; id: string; rect: Rect; tilt?: number; dur?: number }
  /** 拿掉一格 */
  | { type: 'remove'; id: string }
  /** 換頁：所有畫格往一個方向退場 */
  | { type: 'clear'; dir?: 'left' | 'right' | 'up' | 'down' | 'fade' }
  | { type: 'wait'; ms: number | 'tap' }
  | { type: 'sound'; key: string }
  /**
   * 互動：交給宿主場景（例如 QTE），宿主回傳結果字串，之後的 branch 依結果分歧。
   * panel：互動發生在哪一格（宿主會拿到它的位置）。
   */
  | { type: 'interact'; id: string; panel?: string }
  | { type: 'branch'; cases: Record<string, Beat[]> }
  /** 大字標題卡（章節名、角色名），疊在所有畫格上 */
  | { type: 'title'; text: string; sub?: string; hold?: number | 'tap' };

export interface ComicScript {
  id: string;
  beats: Beat[];
  /** 底色（預設深色紙） */
  bg?: number;
  /** 能不能按「跳過」整段（QTE 不能） */
  skippable?: boolean;
  /** 播完是否等玩家點一下才結束（預設 true） */
  endTap?: boolean;
  /** 背景音樂情緒（AudioManager.setMood） */
  mood?: string;
}
