import type { WaveDef } from './waves';

/**
 * 開局教學戰鬥：選完主角、看完序章後，先在據點前打一小波霧屍熟悉操作，
 * 打完才進入第一天白天。教學中的子彈、輔助用品、路障耐久打完都會還原，
 * 主角也不會倒下（血量最低留 1）。流程說明見 docs/TUTORIAL.md。
 */

/** 手機上要閃框提示的按鈕（UIScene 依名稱找位置） */
export type TutorialFocus = 'joystick' | 'fire' | 'reload' | 'melee' | 'stance' | 'swap' | null;

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
  /** 身上沒有槍（阿凱開局只有球棒）時改用的文字與目標 */
  unarmed?: Partial<Pick<TutorialStepDef, 'title' | 'desktop' | 'touch' | 'goal' | 'focus'>>;
}

/** 沒有槍時跳過的步驟 */
export const GUN_STEPS: TutorialStepDef['id'][] = ['shoot', 'reload', 'swap'];

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
    title: '翻出路障，切成近戰',
    desktop: '按 4（或 X）收槍拿近戰武器，左鍵揮、按住連砍；拿槍時右鍵／V 也能快揮',
    touch: '按「持刀」收槍，點畫面就揮、按住連砍；拿槍時按「近戰」也能快揮',
    focus: 'stance',
    goal: 3,
    unarmed: {
      title: '你只有球棒：翻出路障，近身揮擊',
      desktop: '左鍵（或右鍵／V）揮棒，按住連續揮；體力見底會變慢',
      touch: '點畫面就揮棒，按住連續揮；體力見底會變慢',
      focus: 'fire',
      goal: 4,
    },
  },
  {
    id: 'swap',
    title: '切回槍、換武器',
    desktop: '近戰模式中按 Q 或 1／2 回到槍，再按 Q 換下一把',
    touch: '按「持槍」回到槍，或按右下「換槍」',
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
    unarmed: {
      desktop: '趁霧屍拆路障時出去揮棒，體力快見底就退回來喘口氣',
      touch: '趁霧屍拆路障時出去揮棒，體力快見底就退回來喘口氣',
    },
  },
];

/** 沒有槍時的練習波：只有平民霧屍，少一點 */
export const TUTORIAL_WAVE_MELEE: WaveDef[] = [
  { delayBefore: 1, groups: [{ enemy: 'basic', count: 4, interval: 2.2 }] },
];

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
