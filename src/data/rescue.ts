import type { CompanionRole } from './companions';

/**
 * 夜晚防守的隨機事件：倖存者從戰場東邊逃向據點，後面跟著一小群霧屍。
 * - 倖存者翻進路障 → 加入隊伍（隊伍還有空位就當晚直接參戰）
 * - 倖存者被咬死 → 屍變，起身成為霧屍（生前是警察就變警察霧屍…）
 *
 * 邏輯在 src/systems/RescueEvent.ts；這裡只放數值。
 */
export const RESCUE = {
  /** 第幾天開始會發生（第 1 夜讓玩家先熟悉守城） */
  minDay: 2,
  /** 每夜發生的機率 */
  chance: 0.6,
  /** 入夜後幾秒內隨機時間觸發 */
  delay: [16, 40] as [number, number],
  /** 倖存者血量、跑速（像素 / 秒，霧屍大多 10–22，慢跑者 44） */
  hp: 60,
  speed: 34,
  /** 前面被擋住時的跑速倍率（會往上下閃） */
  blockedMul: 0.45,
  /** 霧屍眼中的吸引力：距離乘這個值，越小越容易被盯上（主角是 1） */
  lure: 0.7,
  /** 追在後面的霧屍：基本數量 + 每兩天多一隻，上限 */
  packBase: 2,
  packMax: 6,
  /** 被咬死後幾秒屍變 */
  turnDelay: 1.4,
  /** 隊伍超過這個人數就不再發生（避免名冊爆掉） */
  maxCrew: 8,
  /** 倖存者職業的權重 */
  roles: { shooter: 5, medic: 2, engineer: 2 } as Record<CompanionRole, number>,
  /** 跑到哪裡算安全：擋路線往右這麼多像素內就翻進去 */
  safeMargin: 8,
};

/** 追兵的組成（依天數解鎖，沒解鎖就用平民） */
export const RESCUE_PACK = ['basic', 'basic', 'runner', 'basic', 'dog', 'worker'];

/** 倖存者的出身 → 屍變後的職業霧屍（src/data/crewBody.ts 的 BACKGROUNDS） */
export const TURN_INTO: Record<string, string> = {
  veteran: 'soldier',
  police: 'police',
  laborer: 'worker',
  mechanic: 'worker',
  athlete: 'runner',
  doctor: 'nurse',
  nurse: 'nurse',
  gangster: 'prisoner',
  fighter: 'prisoner',
};
