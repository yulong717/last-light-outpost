import type { WaveDef } from './waves';

/**
 * 開局教學戰鬥：選完主角、看完序章後，先在據點前打一小波霧屍熟悉操作，
 * 打完才進入第一天白天。教學中的子彈、輔助用品、路障耐久打完都會還原，
 * 主角也不會倒下（血量最低留 1）。流程說明見 docs/TUTORIAL.md。
 */

/** 手機上要閃框提示的按鈕（UIScene 依名稱找位置） */
export type TutorialFocus = 'joystick' | 'fire' | 'reload' | 'melee' | 'swap' | null;

export interface TutorialStepDef {
  id: 'move' | 'shoot' | 'reload' | 'melee' | 'swap' | 'wave';
  /** 上方提示框的大標 */
  title: string;
  /** 電腦版操作說明 */
  desktop: string;
  /** 手機版操作說明 */
  touch: string;
  focus: TutorialFocus;
  /** 完成條件要做幾次（走的距離、擊殺數、打中次數） */
  goal: number;
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    id: 'move',
    title: '先走兩步',
    desktop: 'WASD 或方向鍵移動，上下也能走（前後排）',
    touch: '左下角按住拖曳，就是移動搖桿',
    focus: 'joystick',
    goal: 70,
  },
  {
    id: 'shoot',
    title: '霧屍來了！開槍',
    desktop: '滑鼠瞄準、左鍵射擊・瞄頭打得更痛',
    touch: '手指點住右半邊畫面：瞄哪打哪，放開停火',
    focus: 'fire',
    goal: 2,
  },
  {
    id: 'reload',
    title: '彈匣快空了，換彈',
    desktop: '按 R 換彈（打空也會自動換）',
    touch: '按右下「換彈」（打空也會自動換）',
    focus: 'reload',
    goal: 1,
  },
  {
    id: 'melee',
    title: '翻出路障，近身揮擊',
    desktop: '走到路障外，右鍵或 V 近戰：不花子彈，但耗體力',
    touch: '走到路障外，按「近戰」：不花子彈，但耗體力',
    focus: 'melee',
    goal: 2,
  },
  {
    id: 'swap',
    title: '切換武器',
    desktop: '按 Q 或 1／2 換槍',
    touch: '按右下「換槍」',
    focus: 'swap',
    goal: 1,
  },
  {
    id: 'wave',
    title: '守住據點！清光這一波',
    desktop: '退回路障後面打，霧屍會先拆路障',
    touch: '退回路障後面打，霧屍會先拆路障',
    focus: null,
    goal: 1,
  },
];

/** 近戰練習一次放幾隻（射擊練習一次一隻） */
export const TUTORIAL_DUMMIES = { melee: 2 };

/** 最後的練習波：比第一夜的第一波再少一點 */
export const TUTORIAL_WAVE: WaveDef[] = [
  {
    delayBefore: 1,
    groups: [
      { enemy: 'basic', count: 5, interval: 1.6 },
      { enemy: 'runner', count: 1, interval: 1, startDelay: 6 },
    ],
  },
];
