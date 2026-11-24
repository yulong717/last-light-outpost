/**
 * 霧屍「職業」與「變異」資料。
 *
 * 一隻霧屍 = 職業（外觀制服＋基礎能力）＋隨機外觀（膚色、衣服顏色、頭飾、背包、血跡、體型）
 *           ＋ 0～2 個變異詞綴（狂暴、巨型、硬皮、爆裂、再生）。
 * 擲骰在 src/systems/ZombieFactory.ts，圖像合成在 src/art/ZombieComposer.ts。
 * 這裡只放數字，調平衡改這個檔案就好。
 */

/** 頭飾：cosmetic 只是外觀；helmet 會擋爆頭，直到被打飛 */
export type HatId =
  | 'none'
  | 'cap'
  | 'beanie'
  | 'police_cap'
  | 'riot_helmet'
  | 'hard_hat'
  | 'fire_helmet'
  | 'army_helmet'
  | 'nurse_cap'
  | 'bandana';

/** 上衣圖樣（畫在原圖「上衣」區域上） */
export type ShirtPattern = 'plain' | 'police' | 'hivis' | 'fire' | 'scrubs' | 'camo' | 'jumpsuit' | 'tank' | 'tie';
export type PantsPattern = 'plain' | 'camo' | 'fire';

/** HSV 調整：[色相(度), 飽和度倍率, 明度倍率] */
export type HsvShift = readonly [number, number, number];

/** 頭盔／防彈衣的防護：armor 是減傷比例（0..1），hp 是耐久（吸收掉的傷害扣這裡，歸零就失效） */
export interface ArmorPiece {
  armor: number;
  hp: number;
}

export type ProfessionAbility =
  /** 死亡時爆開，波及周圍（主角、夥伴、路障與其他霧屍） */
  | 'burst'
  /** 每隔一段時間替附近霧屍回血 */
  | 'heal_aura'
  /** 血量低於一半時暴走：更快、出手更頻繁 */
  | 'enrage'
  /** 狂奔屍：靠近時停下嘶吼蓄力，接著直線衝刺撞上來（見 SPRINT） */
  | 'sprint';

/** 身體種類：人形霧屍，或三種動物（各有自己的圖與行為） */
export type BodyKind = 'human' | 'dog' | 'crow' | 'bear';

export interface ProfessionDef {
  id: string;
  name: string;
  /** 不填 = 人形 */
  body?: BodyKind;
  /** 成群出現：波次挑到牠時一次出幾隻（屍犬、屍鴉） */
  pack?: number;
  /** 一句話介紹，圖鑑與第一次出現時顯示 */
  blurb: string;
  hp: number;
  speed: number;
  damage: number;
  attackInterval: number;
  /** 整體大小；底圖已畫成對的尺寸，這裡只做小幅調整（巨屍有自己的 XL 底圖，不再放大） */
  scale: number;
  /** 身形加寬（1 = 原圖） */
  widen: number;
  /** 人形底圖：'basic' 一般霧屍（M 人台，預設）、'brute' 巨屍（XL 壯人台） */
  base?: 'basic' | 'brute';
  /** 對路障、建築的傷害倍率（工人拿鐵鎚、消防員拿斧頭） */
  structureMul?: number;
  /** 擊退抵抗（0..1） */
  knockbackResist?: number;
  /** 硬直抵抗（0..1），給近戰武器的 stagger 用 */
  staggerResist?: number;
  /** 不怕火（之後的火焰武器、燃燒瓶用） */
  fireproof?: boolean;
  /** 防彈背心（會壞） */
  vest?: ArmorPiece;
  /** 天生的身體減傷（不會壞，例如消防衣） */
  bodyArmor?: number;
  ability?: ProfessionAbility;
  /** 頭飾機率表（權重）；頭盔類會給予頭部防護 */
  hats: Partial<Record<HatId, number>>;
  look: {
    /** 可能的膚色（不填就用全體共用的屍膚表） */
    skins?: HsvShift[];
    shirts: number[];
    pants: number[];
    shirt: ShirtPattern;
    pantsPattern?: PantsPattern;
    /** 背包機率 */
    backpack?: number;
    /** 血跡多寡 0..3 */
    blood?: [number, number];
  };
  /** 女性機率（0..1，預設 0.45） */
  femaleChance?: number;
  /** 女性穿裙子的機率 */
  skirtChance?: number;
  /** 可能的體型（權重）；不填用 BUILDS 的預設權重 */
  builds?: Partial<Record<BuildId, number>>;
  /** 第幾天開始出現 */
  unlockDay: number;
  /** 出現權重（越大越常見） */
  weight: number;
  /** 威脅點數：波次預算用，越強越貴 */
  threat: number;
  /** 擊殺掉落廢料 */
  scrap: number;
}

/** 頭盔類頭飾的防護數值；沒列的頭飾純屬外觀 */
export const HELMETS: Partial<Record<HatId, ArmorPiece>> = {
  hard_hat: { armor: 0.55, hp: 30 },
  riot_helmet: { armor: 0.65, hp: 45 },
  fire_helmet: { armor: 0.5, hp: 40 },
  army_helmet: { armor: 0.7, hp: 55 },
};

/** 一般屍膚：灰綠（原色）、慘白、病黃、青紫、深褐 */
export const SKINS: HsvShift[] = [
  [-1, 1, 1],
  [95, 0.45, 1.12],
  [58, 2.0, 1.0],
  [205, 0.9, 0.95],
  [28, 1.4, 0.72],
];

const CIVIL_SHIRTS = [0xd8d8d0, 0x9c2f2f, 0x2f5f9c, 0x3f7a3a, 0xc9a227, 0x6b4a8a, 0x8a8a8a, 0x2b2b2b, 0xb86a2b];
const CIVIL_PANTS = [0x2b3a55, 0x3a3a3a, 0x7a6a4f, 0x4a4a3a, 0x253045];

export const PROFESSIONS: Record<string, ProfessionDef> = {
  basic: {
    id: 'basic',
    name: '平民霧屍',
    blurb: '最常見的屍群，數量就是牠們的武器。',
    hp: 30,
    speed: 23,
    damage: 5,
    attackInterval: 1.0,
    scale: 1,
    widen: 1,
    hats: { none: 6, cap: 2, beanie: 2, bandana: 1 },
    look: { shirts: CIVIL_SHIRTS, pants: CIVIL_PANTS, shirt: 'plain', backpack: 0.2, blood: [0, 2] },
    femaleChance: 0.5,
    skirtChance: 0.4,
    unlockDay: 1,
    weight: 10,
    threat: 1,
    scrap: 2,
  },
  runner: {
    id: 'runner',
    name: '慢跑者',
    blurb: '跑得飛快但很脆，別讓牠們摸到你身邊。',
    hp: 18,
    speed: 50,
    damage: 3,
    attackInterval: 0.6,
    // 一般霧屍的瘦版：瘦弱體型（0.98）× 0.98 ≈ 54 高（規格 §2.1）
    scale: 0.98,
    widen: 0.92,
    hats: { none: 5, cap: 2, bandana: 2 },
    look: {
      shirts: [0xe8e04a, 0xe0508a, 0x40c8d8, 0xf08a30, 0x70d050],
      pants: [0x202020, 0x303850],
      shirt: 'tank',
      blood: [1, 3],
    },
    femaleChance: 0.5,
    builds: { thin: 8, average: 2 },
    unlockDay: 1,
    weight: 4,
    threat: 1.5,
    scrap: 3,
  },
  sprinter: {
    id: 'sprinter',
    name: '狂奔屍',
    blurb: '聽到尖嘯就要注意！牠會蹲低蓄力後直線衝過來，趁蓄力時爆頭或重擊可以打斷。',
    hp: 34,
    speed: 26,
    damage: 7,
    attackInterval: 0.8,
    scale: 0.98,
    widen: 0.94,
    ability: 'sprint',
    hats: { none: 6, beanie: 1, bandana: 1 },
    look: {
      skins: [
        [350, 1.5, 0.9],
        [10, 1.3, 0.85],
      ],
      shirts: [0x8a1e1e, 0x5a1a1a, 0x2b2b2b, 0x6a3a2a],
      pants: [0x202020, 0x2a2a35],
      shirt: 'tank',
      blood: [2, 3],
    },
    femaleChance: 0.4,
    builds: { thin: 5, average: 3 },
    unlockDay: 1,
    weight: 2.5,
    threat: 2.5,
    scrap: 4,
  },
  brute: {
    id: 'brute',
    name: '腫脹霧屍',
    blurb: '皮厚血多，倒下時會爆出腐液，離牠遠一點再開槍。',
    hp: 140,
    speed: 13,
    damage: 15,
    attackInterval: 1.6,
    // XL 壯人台的底圖（約 62 高、寬 1.4 倍），不再把一般霧屍放大 1.3 倍
    base: 'brute',
    scale: 1,
    widen: 1,
    structureMul: 1.5,
    knockbackResist: 0.6,
    staggerResist: 0.4,
    ability: 'burst',
    hats: { none: 1 },
    look: {
      skins: [
        [285, 1.8, 0.92],
        [300, 1.5, 0.85],
        [265, 1.6, 0.95],
      ],
      shirts: [0xb8a040, 0x9c8a50, 0x8a6a3a],
      pants: [0x5a4030, 0x4a3a2a],
      shirt: 'tank',
      blood: [1, 3],
    },
    femaleChance: 0.3,
    builds: { average: 3, tall: 1 },
    unlockDay: 1,
    weight: 1.5,
    threat: 6,
    scrap: 8,
  },
  worker: {
    id: 'worker',
    name: '工地霧屍',
    blurb: '戴工程帽擋爆頭，手上的鐵鎚拆路障特別快。',
    hp: 45,
    speed: 20,
    damage: 7,
    attackInterval: 1.2,
    scale: 1.02,
    widen: 1.06,
    structureMul: 2.5,
    hats: { hard_hat: 7, none: 2, beanie: 1 },
    look: { shirts: [0xf07a18, 0xe0d020], pants: [0x2f4a78, 0x3a3a3a], shirt: 'hivis', blood: [0, 2] },
    femaleChance: 0.2,
    builds: { average: 4, stocky: 4, tall: 1, thin: 1 },
    unlockDay: 2,
    weight: 4,
    threat: 2.5,
    scrap: 4,
  },
  police: {
    id: 'police',
    name: '警察霧屍',
    blurb: '防彈背心讓打身體幾乎沒用，瞄頭！鎮暴頭盔要先打飛。',
    hp: 40,
    speed: 23,
    damage: 6,
    attackInterval: 1.0,
    scale: 1,
    widen: 1.04,
    vest: { armor: 0.45, hp: 60 },
    hats: { police_cap: 6, riot_helmet: 3, none: 1 },
    look: { shirts: [0x4a6aa8, 0x5a7ab8], pants: [0x1c2438, 0x242c40], shirt: 'police', blood: [0, 2] },
    femaleChance: 0.35,
    unlockDay: 2,
    weight: 3,
    threat: 3,
    scrap: 5,
  },
  nurse: {
    id: 'nurse',
    name: '護理師霧屍',
    blurb: '會替身邊的霧屍「療傷」，優先解決牠。',
    hp: 28,
    speed: 25,
    damage: 4,
    attackInterval: 0.9,
    scale: 0.96,
    widen: 0.96,
    ability: 'heal_aura',
    hats: { nurse_cap: 5, none: 3 },
    look: { shirts: [0x6cc4c0, 0x8ab8e0, 0xe8a0c0], pants: [0x6cc4c0, 0x8ab8e0, 0xe8a0c0], shirt: 'scrubs', blood: [1, 3] },
    femaleChance: 0.7,
    skirtChance: 0.3,
    unlockDay: 3,
    weight: 2,
    threat: 3,
    scrap: 5,
  },
  firefighter: {
    id: 'firefighter',
    name: '消防員霧屍',
    blurb: '厚重防火衣減傷又不怕火，打不退、推不動。',
    hp: 90,
    speed: 17,
    damage: 8,
    attackInterval: 1.3,
    scale: 1.08,
    widen: 1.12,
    structureMul: 2,
    bodyArmor: 0.25,
    knockbackResist: 0.8,
    staggerResist: 0.6,
    fireproof: true,
    hats: { fire_helmet: 8, none: 1 },
    look: { shirts: [0xb89a5a, 0x2a2a2a], pants: [0xb89a5a, 0x2a2a2a], shirt: 'fire', pantsPattern: 'fire', blood: [0, 1] },
    femaleChance: 0.2,
    builds: { average: 4, stocky: 4, tall: 2 },
    unlockDay: 3,
    weight: 1.5,
    threat: 5,
    scrap: 7,
  },
  prisoner: {
    id: 'prisoner',
    name: '囚犯霧屍',
    blurb: '受傷過半就會暴走，衝刺速度與攻速大增。',
    hp: 50,
    speed: 23,
    damage: 8,
    attackInterval: 0.9,
    scale: 1.02,
    widen: 1.04,
    ability: 'enrage',
    hats: { none: 6, bandana: 2, beanie: 1 },
    look: { shirts: [0xe8701c, 0xd86018], pants: [0xe8701c, 0xd86018], shirt: 'jumpsuit', blood: [1, 3] },
    femaleChance: 0.3,
    unlockDay: 4,
    weight: 2,
    threat: 3.5,
    scrap: 5,
  },
  soldier: {
    id: 'soldier',
    name: '士兵霧屍',
    blurb: '頭盔加防彈衣的重裝屍。準備穿甲彈或近戰重擊。',
    hp: 80,
    speed: 19,
    damage: 10,
    attackInterval: 1.1,
    scale: 1.05,
    widen: 1.08,
    vest: { armor: 0.5, hp: 100 },
    knockbackResist: 0.4,
    staggerResist: 0.3,
    hats: { army_helmet: 9, none: 1 },
    look: { shirts: [0x5a6a3a, 0x6a6040], pants: [0x5a6a3a, 0x6a6040], shirt: 'camo', pantsPattern: 'camo', backpack: 0.5, blood: [0, 2] },
    femaleChance: 0.2,
    builds: { average: 5, stocky: 3, tall: 2 },
    unlockDay: 5,
    weight: 1,
    threat: 7,
    scrap: 10,
  },
};

// ───────────────────────── 動物 ─────────────────────────

const NO_LOOK: ProfessionDef['look'] = { shirts: [0], pants: [0], shirt: 'plain' };

/**
 * 動物霧屍。和人形共用波次、廢料、變異系統，只是外觀（src/art/AnimalArt.ts）與行為
 * （Zombie.updateCrow／撲咬／衝撞）不同。沒有頭盔、背心、體型、性別。
 */
export const ANIMALS: Record<string, ProfessionDef> = {
  dog: {
    id: 'dog',
    name: '屍犬',
    blurb: '成群奔襲，會撲上來咬；身形低矮，瞄低一點。',
    body: 'dog',
    pack: 3,
    hp: 22,
    speed: 62,
    damage: 4,
    attackInterval: 0.55,
    scale: 1,
    widen: 1,
    structureMul: 0.5,
    hats: { none: 1 },
    look: NO_LOOK,
    femaleChance: 0,
    builds: { average: 1 },
    unlockDay: 2,
    weight: 1.6,
    threat: 2,
    scrap: 3,
  },
  crow: {
    id: 'crow',
    name: '屍鴉',
    blurb: '飛過路障直接俯衝啄人，一槍就落，但要抬高槍口。',
    body: 'crow',
    pack: 3,
    hp: 8,
    speed: 58,
    damage: 3,
    attackInterval: 1.4,
    scale: 1,
    widen: 1,
    hats: { none: 1 },
    look: NO_LOOK,
    femaleChance: 0,
    builds: { average: 1 },
    unlockDay: 3,
    weight: 1.2,
    threat: 1.5,
    scrap: 2,
  },
  bear: {
    id: 'bear',
    name: '屍熊',
    blurb: '巨大又耐打，靠近路障時會衝撞，第一下特別重。',
    body: 'bear',
    hp: 320,
    speed: 12,
    damage: 26,
    attackInterval: 2.0,
    scale: 1.2,
    widen: 1,
    structureMul: 2,
    knockbackResist: 0.9,
    staggerResist: 0.8,
    hats: { none: 1 },
    look: NO_LOOK,
    femaleChance: 0,
    builds: { average: 1 },
    unlockDay: 6,
    weight: 0.6,
    threat: 12,
    scrap: 20,
  },
};
Object.assign(PROFESSIONS, ANIMALS);

/** 屍鴉：巡航高度、俯衝到的高度、啄完拉開的時間 */
export const CROW = { cruiseAlt: 70, strikeAlt: 20, diveSpeed: 110, retreatTime: 1.1 };
/** 屍犬撲咬：距離、冷卻、速度、傷害倍率 */
export const POUNCE = { range: 56, cooldown: 2.2, speed: 170, time: 0.32, damageMul: 1.5, aggro: 200 };
/**
 * 狂奔屍的衝刺：
 * - range：目標（主角／夥伴／路障）進入這個距離就開始蓄力
 * - windup：嘶吼＋蹲低蓄力的秒數（玩家的反應時間；期間被硬直會被打斷）
 * - speed／maxTime：衝刺速度（像素／秒）與最長時間；方向在蓄力結束那一刻鎖定，可以閃開
 * - impactMul：撞上的第一下傷害倍率；recover：撞完喘氣的秒數；cooldown：下次衝刺前的冷卻
 */
export const SPRINT = { range: 210, minRange: 44, windup: 0.85, speed: 200, maxTime: 1.2, impactMul: 1.8, recover: 0.9, cooldown: 3.5 };
/** 屍熊衝撞：離擋路線多遠開始衝、速度倍率、第一下傷害倍率 */
export const CHARGE = { from: 130, speedMul: 2.4, impactMul: 2 };

// ───────────────────────── 體型與性別 ─────────────────────────

export type BuildId = 'thin' | 'average' | 'stocky' | 'tall';

export interface BuildDef {
  id: BuildId;
  /** 名稱前綴（普通體型不加） */
  prefix: string;
  /** 預設出現權重 */
  weight: number;
  hpMul: number;
  speedMul: number;
  damageMul: number;
  /** 橫向寬度倍率（畫面上變胖／變瘦，命中框跟著變） */
  widthMul: number;
  /** 整體大小倍率（高大） */
  scaleMul: number;
  knockbackResist: number;
}

/** 體型會影響數值：瘦的快而脆、壯的慢而耐打、高大的打得痛 */
export const BUILDS: Record<BuildId, BuildDef> = {
  thin: { id: 'thin', prefix: '瘦弱', weight: 3, hpMul: 0.8, speedMul: 1.12, damageMul: 0.9, widthMul: 0.86, scaleMul: 0.98, knockbackResist: 0 },
  average: { id: 'average', prefix: '', weight: 5, hpMul: 1, speedMul: 1, damageMul: 1, widthMul: 1, scaleMul: 1, knockbackResist: 0 },
  stocky: { id: 'stocky', prefix: '壯碩', weight: 2, hpMul: 1.3, speedMul: 0.88, damageMul: 1.15, widthMul: 1.18, scaleMul: 1.02, knockbackResist: 0.15 },
  tall: { id: 'tall', prefix: '高大', weight: 1.5, hpMul: 1.15, speedMul: 1, damageMul: 1.1, widthMul: 1.02, scaleMul: 1.1, knockbackResist: 0.05 },
};

/**
 * 女性霧屍：外觀差異（長髮／馬尾／短鮑伯、可能穿裙子、身形略纖細），數值和男性相同；
 * 能力差異交給職業與體型。
 */
export const FEMALE = { widthMul: 0.92, scaleMul: 0.95 };
export const HAIR_COLORS = [0x2a2018, 0x4a3020, 0x6a4a28, 0xc8a050, 0x8a3018, 0x9a9a9a, 0x1a1a22];
export const SKIRT_COLORS = [0x3a3a4a, 0x7a2a3a, 0x2a4a6a, 0x5a4a3a, 0x8a8a7a];

// ───────────────────────── 變異 ─────────────────────────

export type MutationId = 'frenzied' | 'hulking' | 'hardened' | 'volatile' | 'regen';

export interface MutationDef {
  id: MutationId;
  /** 名稱前綴，例如「狂暴的警察霧屍」 */
  prefix: string;
  hpMul?: number;
  speedMul?: number;
  damageMul?: number;
  attackIntervalMul?: number;
  scaleMul?: number;
  /** 額外的天生身體減傷（加在職業的 bodyArmor 上） */
  bodyArmor?: number;
  knockbackResist?: number;
  /** 死亡時爆開 */
  burst?: boolean;
  /** 每秒回血（脫離受擊 2 秒後） */
  regen?: number;
  /** 身上的色調（不會蓋掉受擊閃白） */
  tint?: number;
  /** 頭上標記的顏色 */
  mark: number;
  /** 第幾天開始可能出現 */
  unlockDay: number;
  weight: number;
  /** 額外威脅點數與廢料 */
  threat: number;
  scrap: number;
}

export const MUTATIONS: Record<MutationId, MutationDef> = {
  frenzied: {
    id: 'frenzied',
    prefix: '狂暴的',
    speedMul: 1.45,
    attackIntervalMul: 0.75,
    tint: 0xffb0a0,
    mark: 0xff4a3a,
    unlockDay: 1,
    weight: 3,
    threat: 1.5,
    scrap: 2,
  },
  hulking: {
    id: 'hulking',
    prefix: '巨型',
    hpMul: 1.9,
    damageMul: 1.4,
    speedMul: 0.85,
    scaleMul: 1.22,
    knockbackResist: 0.4,
    mark: 0xffa030,
    unlockDay: 2,
    weight: 2,
    threat: 2.5,
    scrap: 3,
  },
  hardened: {
    id: 'hardened',
    prefix: '硬皮',
    hpMul: 1.25,
    bodyArmor: 0.25,
    tint: 0xb8c8d8,
    mark: 0x9ab8e0,
    unlockDay: 3,
    weight: 2,
    threat: 2,
    scrap: 2,
  },
  volatile: {
    id: 'volatile',
    prefix: '爆裂',
    burst: true,
    tint: 0xd8ffa0,
    mark: 0x9aff4a,
    unlockDay: 2,
    weight: 2,
    threat: 1.5,
    scrap: 2,
  },
  regen: {
    id: 'regen',
    prefix: '再生',
    regen: 4,
    mark: 0x4affb0,
    unlockDay: 4,
    weight: 1.5,
    threat: 2,
    scrap: 3,
  },
};

/** 爆開的範圍與傷害（腫脹霧屍與「爆裂」變異共用；腫脹的更大） */
export const BURST = {
  big: { radius: 48, damage: 16 },
  small: { radius: 34, damage: 10 },
  /** 爆炸對其他霧屍的傷害倍率：連鎖引爆很爽，但不要一顆清場 */
  zombieMul: 2,
};

/** 護理師的治療光環 */
export const HEAL_AURA = { interval: 3, radius: 64, amount: 10 };

/** 囚犯暴走 */
export const ENRAGE = { below: 0.5, speedMul: 1.8, attackIntervalMul: 0.6, tint: 0xff8a7a };

/** 天數越大霧屍走得越快：每天 +3%，最多 +30%（狂奔屍的衝刺速度不受影響，維持可反應） */
export function paceMul(day: number): number {
  return Math.min(1.3, 1 + 0.03 * Math.max(0, day - 1));
}

/** 每隻霧屍得到變異的機率：依天數上升 */
export function mutationChance(day: number): number {
  return Math.min(0.45, 0.04 + 0.06 * (day - 1));
}

/** 已有一個變異時，再多一個的機率（第 6 天起） */
export function secondMutationChance(day: number): number {
  return day < 6 ? 0 : Math.min(0.3, 0.05 * (day - 5));
}

/**
 * 肢體破壞與爆頭（一般人形霧屍）：
 * - 斷手：攻擊力剩 armDamageMul，照樣走過來
 * - 斷腳：倒地改成爬行，速度剩 crawl.speedMul、攻擊間隔乘 crawl.attackMul，判定框變矮
 * - 爆頭擊殺：頭整個炸開；近戰的重擊（收尾、衝刺打、處決）殺掉時有 heavyHeadBurst 的機率也炸頭
 *
 * 機率 ＝ chance[傷害類型] ×（重擊 heavyMul）× clamp(這一下扣的血 ÷ 最大血量 × 3, 0.4, 1.6)，上限 max。
 * 槍打到哪個部位就斷哪裡（判定框上 25% 是頭、到 60% 是手、以下是腳）；近戰和爆炸隨機。
 */
export const GORE = {
  chance: { ballistic: 0.14, buckshot: 0.24, slash: 0.32, blunt: 0.2, blast: 0.35 } as Record<string, number>,
  heavyMul: 1.8,
  max: 0.6,
  armDamageMul: 0.5,
  crawl: { speedMul: 0.6, attackMul: 1.4 },
  heavyHeadBurst: 0.35,
  /** 擊退抗性高於這個值的（重量級）不會被打斷手腳 */
  resistAbove: 0.75,
};
