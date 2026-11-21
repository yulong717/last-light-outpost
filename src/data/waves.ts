export interface SpawnGroup {
  enemy: string;
  count: number;
  /** 同組兩隻之間的間隔（秒） */
  interval: number;
}

export interface WaveDef {
  groups: SpawnGroup[];
  /** 這一波開始前的休息秒數 */
  delayBefore: number;
}

/**
 * 第一個夜晚的波次。之後會改由「天數 + 灰霧濃度」動態生成，
 * 目前先寫死，方便調整手感。
 */
export const NIGHT_ONE: WaveDef[] = [
  { delayBefore: 2, groups: [{ enemy: 'basic', count: 8, interval: 1.4 }] },
  {
    delayBefore: 5,
    groups: [
      { enemy: 'basic', count: 10, interval: 1.0 },
      { enemy: 'runner', count: 4, interval: 2.2 },
    ],
  },
  {
    delayBefore: 5,
    groups: [
      { enemy: 'basic', count: 12, interval: 0.8 },
      { enemy: 'runner', count: 6, interval: 1.6 },
      { enemy: 'brute', count: 2, interval: 8 },
    ],
  },
];
