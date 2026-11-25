import type { FieldSpec } from './explore';

/**
 * 序章（＝第一夜）：阿凱在學校頂樓睡過頭，醒來發現整個學校都不對勁，一層一層往下逃出去。
 * 全程單軸（只能左右走），每一層教一件事：移動與揮棒 → 掙脫與衝刺 → 潛行暗殺 → 封門 → 撐到校門打開。
 * 每一層是一個 ExploreFieldScene 小關卡（傳入 stage），流程由 PrologueScene 串起來。
 * 說明見 docs/PROLOGUE.md。
 */

/** 教學提示什麼時候跳出來 */
export type HintWhen =
  | 'start'
  /** 第一次被霧屍抓住 */
  | 'grab'
  /** 潛行被發現 */
  | 'alert'
  /** 第一次打倒霧屍 */
  | 'kill'
  /** 主角走到這個 x 以右 */
  | { x: number }
  /** 關卡開始幾秒後 */
  | { seconds: number };

export interface StageHint {
  when: HintWhen;
  /** 電腦版文字 */
  text: string;
  /** 手機版文字（沒填就用 text） */
  touch?: string;
}

/** 擺好位置的霧屍 */
export interface StageZombie {
  x: number;
  /** 職業 id（src/data/zombies.ts） */
  id: string;
  /** 一開始面向哪邊（潛行時決定牠看哪裡） */
  facing?: 1 | -1;
  /** 潛行：來回巡邏的範圍（左右各幾 px），0 = 站著不動只會轉頭 */
  patrol?: number;
}

export interface PrologueStage {
  id: string;
  /** 樓層名，轉場與牆上大字用 */
  floor: string;
  /** 轉場畫面上的一句話 */
  narration: string;
  /** 場景佈置（src/data/scenery.ts 的 EVENT_SETS） */
  set: string;
  worldW: number;
  /** 主角起點 x（預設 60，最左邊） */
  startX?: number;
  spec: FieldSpec;
  /** 戰鬥：一開始就在場上的霧屍（走近 wakeRange 內才撲過來） */
  zombies?: StageZombie[];
  wakeRange?: number;
  /** 潛行：巡邏中的霧屍 */
  sleepers?: StageZombie[];
  /** 潛行：陰影區 [x, 寬] */
  shadows?: [number, number][];
  /** 陸續從兩側／門裡冒出來的霧屍 */
  reinforce?: { ids: string[]; count: number; every: number; delay?: number };
  /** 出口牌子上的字 */
  exitLabel?: string;
  /** 過關時的大字 */
  doneText: string;
  hints: StageHint[];
}

export const PROLOGUE_STAGES: PrologueStage[] = [
  {
    id: 'roof',
    floor: '頂樓',
    narration: '遠處有警報聲。操場上的人影，走路的樣子不太對。',
    set: 'pro_roof',
    worldW: 1100,
    spec: { mode: 'fight', goal: 'reach', title: '找到樓梯間', zombies: 0, axis: 'single', meleeOnly: true },
    zombies: [
      { x: 560, id: 'basic' },
      { x: 860, id: 'basic' },
      { x: 892, id: 'basic' },
    ],
    wakeRange: 230,
    exitLabel: '樓梯 ▼',
    doneText: '下樓',
    hints: [
      { when: 'start', text: 'A／D 左右移動', touch: '左下搖桿左右移動' },
      { when: { x: 330 }, text: '有人搖搖晃晃走過來……靠近後按左鍵揮棒', touch: '有人搖搖晃晃走過來……靠近後點畫面揮棒' },
      { when: 'kill', text: '連續揮會耗體力，停手一下就回來。按住可以一直揮' },
      { when: { x: 700 }, text: '兩隻一起來：球棒一揮能掃到一排，順便把牠們打退' },
    ],
  },
  {
    id: '4f',
    floor: '4F',
    narration: '走廊的燈一閃一閃。有個書包掉在樓梯口，上面都是血。',
    set: 'pro_4f',
    worldW: 1200,
    spec: { mode: 'fight', goal: 'reach', title: '穿過 4F 走廊', zombies: 0, axis: 'single', meleeOnly: true },
    zombies: [
      { x: 420, id: 'basic' },
      { x: 700, id: 'basic' },
      { x: 740, id: 'basic' },
      { x: 1010, id: 'runner' },
    ],
    wakeRange: 260,
    exitLabel: '樓梯 ▼ 3F',
    doneText: '下樓',
    hints: [
      { when: 'start', text: '一直往前跑會自動加速成衝刺：衝刺中揮棒會把霧屍撞飛' },
      { when: 'grab', text: '被抓住了！連續揮棒把牠打退就能掙脫' },
      { when: { x: 600 }, text: '閃身步：體力夠的時候，霧屍撲過來你會自動閃開' },
      { when: { x: 900 }, text: '那隻跑得很快——站穩，等牠衝進球棒的距離再揮' },
    ],
  },
  {
    id: '3f',
    floor: '3F',
    narration: '整條走廊擠滿了穿制服的身影。硬打，打不過。',
    set: 'pro_3f',
    worldW: 1400,
    spec: { mode: 'stealth', goal: 'reach', title: '溜過 3F 走廊', zombies: 0, axis: 'single' },
    sleepers: [
      { x: 330, id: 'basic', facing: -1, patrol: 0 },
      { x: 620, id: 'basic', facing: 1, patrol: 50 },
      { x: 900, id: 'basic', facing: -1, patrol: 40 },
      { x: 1160, id: 'basic', facing: 1, patrol: 60 },
    ],
    shadows: [
      [190, 70],
      [470, 80],
      [760, 70],
      [1030, 80],
    ],
    exitLabel: '樓梯 ▼ 2F',
    doneText: '下樓',
    hints: [
      { when: 'start', text: '潛行中腳步會放輕。地上的淡色光錐是牠們的視線' },
      { when: { x: 150 }, text: '躲進教室門口的陰影裡（頭上會顯示「隱蔽中」），比較不容易被看到' },
      { when: { x: 260 }, text: '等牠背對你，貼近按 E 暗殺——不會吵醒其他人', touch: '等牠背對你，貼近按「近戰」暗殺——不會吵醒其他人' },
      { when: 'alert', text: '被發現了！衝到樓梯口，或把牠們全部打倒' },
    ],
  },
  {
    id: '2f',
    floor: '2F',
    narration: '教室門後面有東西在撞。一下、一下、又一下。',
    set: 'pro_2f',
    worldW: 1200,
    spec: { mode: 'fight', goal: 'reach', title: '穿過 2F，別讓牠們從教室衝出來', zombies: 0, axis: 'single', meleeOnly: true },
    zombies: [{ x: 520, id: 'basic' }],
    wakeRange: 240,
    reinforce: { ids: ['basic', 'basic', 'runner'], count: 6, every: 3.2, delay: 4 },
    exitLabel: '樓梯 ▼ 1F',
    doneText: '下樓',
    hints: [
      { when: 'start', text: '靠近教室的門按 F 用木板封住，封住的門牠們出不來', touch: '靠近教室的門按「互動」用木板封住，封住的門牠們出不來' },
      { when: { seconds: 9 }, text: '門被撞開了就打——別停在原地被前後夾住' },
    ],
  },
  {
    id: '1f',
    floor: '1F',
    narration: '穿堂盡頭就是校門。鐵捲門的開關在警衛室，你按下去，馬達慢吞吞地轉。',
    set: 'pro_1f',
    worldW: 960,
    startX: 470,
    spec: { mode: 'fight', goal: 'survive', title: '撐到校門的鐵捲門升起', zombies: 0, axis: 'single', meleeOnly: true, seconds: 35 },
    zombies: [
      { x: 760, id: 'basic' },
      { x: 120, id: 'basic' },
    ],
    wakeRange: 2000,
    reinforce: { ids: ['basic', 'basic', 'runner'], count: 14, every: 2.2, delay: 2 },
    doneText: '校門開了！',
    hints: [
      { when: 'start', text: '馬達的聲音把整棟樓的霧屍都引來了。前後都會來，撐住！' },
      { when: { seconds: 12 }, text: '別被夾在中間：往人少的那邊退，一邊退一邊揮' },
      { when: { seconds: 26 }, text: '快好了——再撐一下！' },
    ],
  },
];

/** 逃出校門後：序章結束的收尾 */
export const PROLOGUE_OUTRO = {
  title: '第一夜　過去了',
  lines: [
    '你從鐵捲門底下滾出去，一路跑到天亮。',
    '學校回不去了。身上只有一根球棒，還有一點點從保健室順來的藥。',
    '你得一邊找物資，一邊找一個能撐過下一夜的地方。',
  ],
  objective: '出發：在天黑前找到能過夜的地方',
};

/** 序章結束時給的東西（取代舊的第一章獎勵） */
export const PROLOGUE_REWARD = { supplies: { medkit: 1 }, scrap: 20 };
