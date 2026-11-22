/**
 * 據點布置的數值：建築種類、固定建造槽位、廢料收支。
 * 想調平衡只要改這個檔案。
 */

export type BuildingKind = 'sandbag' | 'spikes' | 'lamp' | 'turret';

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  /** 一句話說明，顯示在建造選單 */
  desc: string;
  /** 建造花費（廢料）；升到 Lv n 要花 cost × (n - 1) */
  cost: number;
  maxLevel: number;
  /** 耐久（Lv1），每升一級 +50% */
  hp: number;
  texture: string;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  sandbag: {
    kind: 'sandbag',
    name: '沙包牆',
    desc: '擋住霧屍，牠們會停下來拆',
    cost: 15,
    maxLevel: 3,
    hp: 140,
    texture: 'bld_sandbag',
  },
  spikes: {
    kind: 'spikes',
    name: '尖刺陷阱',
    desc: '踩上去持續受傷並減速',
    cost: 20,
    maxLevel: 3,
    hp: 40,
    texture: 'bld_spikes',
  },
  lamp: {
    kind: 'lamp',
    name: '照明燈',
    desc: '霧屍畏光，光圈內移動變慢',
    cost: 25,
    maxLevel: 3,
    hp: 1,
    texture: 'bld_lamp',
  },
  turret: {
    kind: 'turret',
    name: '自動砲塔',
    desc: '自動射擊前方最近的霧屍',
    cost: 60,
    maxLevel: 3,
    hp: 1,
    texture: 'bld_turret',
  },
};

/** 各等級的效果數值（索引 0 = Lv1） */
export const SPIKES = {
  /** 每次刺傷的傷害 */
  damage: [6, 9, 13],
  /** 刺傷間隔（秒） */
  interval: 0.5,
  /** 踩在上面的速度倍率 */
  slow: [0.55, 0.5, 0.45],
  /** 每刺一下掉多少耐久 */
  wear: 1,
  /** 判定範圍（以槽位腳底為中心的半寬、半高） */
  halfW: 16,
  halfH: 12,
};

export const LAMP = {
  /** 光圈半徑（地面距離，y 方向加權 1.6） */
  radius: [64, 80, 96],
  slow: [0.75, 0.68, 0.6],
};

export const TURRET = {
  damage: [8, 11, 15],
  /** 射擊間隔（秒） */
  interval: [0.8, 0.65, 0.5],
  /** 只打前方（右側）這個距離內的霧屍 */
  range: [220, 260, 300],
};

/** 沙包擋住的上下範圍（以槽位腳底為中心的半高）；三個前排槽位剛好連成一道牆 */
export const SANDBAG_HALF_H = 20;

/**
 * 固定建造槽位。x / y 是建築腳底的世界座標（y 在地面帶 226–346 之內）。
 * kinds 是這個槽位能蓋的建築。
 * - 路障後方兩座高台：砲塔、照明燈
 * - 路障前方三排地面點：沙包、陷阱、照明燈
 */
export interface SlotDef {
  id: string;
  x: number;
  y: number;
  kinds: BuildingKind[];
}

export const SLOTS: SlotDef[] = [
  { id: 'tower-far', x: 122, y: 258, kinds: ['turret', 'lamp'] },
  { id: 'tower-near', x: 122, y: 324, kinds: ['turret', 'lamp'] },

  { id: 'front-1', x: 214, y: 250, kinds: ['sandbag', 'spikes'] },
  { id: 'front-2', x: 214, y: 290, kinds: ['sandbag', 'spikes'] },
  { id: 'front-3', x: 214, y: 330, kinds: ['sandbag', 'spikes'] },

  { id: 'mid-1', x: 300, y: 244, kinds: ['sandbag', 'spikes', 'lamp'] },
  { id: 'mid-2', x: 300, y: 288, kinds: ['sandbag', 'spikes', 'lamp'] },
  { id: 'mid-3', x: 300, y: 332, kinds: ['sandbag', 'spikes', 'lamp'] },

  { id: 'far-1', x: 390, y: 262, kinds: ['spikes', 'lamp', 'sandbag'] },
  { id: 'far-2', x: 390, y: 318, kinds: ['spikes', 'lamp', 'sandbag'] },
];

/** 廢料收支 */
export const ECONOMY = {
  startScrap: 80,
  /** 撐過一夜的獎勵 */
  nightBonus: 20,
  /** 每天白天固定入帳（白天探索做好之前的暫代收入） */
  dailySalvage: 25,
  /** 擊殺各型霧屍掉落的廢料 */
  killScrap: { basic: 2, runner: 3, brute: 8 } as Record<string, number>,
  /** 拆除退還比例（以投入的總花費計） */
  refundRatio: 0.5,
  /** 修理：補滿耐久要花「建造費 × 這個比例」，依缺損比例計 */
  repairRatio: 0.5,
};

/** 主路障：等級、耐久與花費 */
export const BARRICADE_LEVELS = [
  { maxHp: 300, upgradeCost: 40 },
  { maxHp: 420, upgradeCost: 80 },
  { maxHp: 560, upgradeCost: 0 },
];
/** 修理主路障：每 1 廢料補多少耐久 */
export const BARRICADE_HP_PER_SCRAP = 10;
/** 修理據點外牆：每 1 廢料補多少耐久 */
export const BASE_HP_PER_SCRAP = 4;

export function buildingMaxHp(kind: BuildingKind, level: number): number {
  return Math.round(BUILDINGS[kind].hp * (1 + 0.5 * (level - 1)));
}

/** 從 Lv1 蓋到指定等級總共花了多少 */
export function investedCost(kind: BuildingKind, level: number): number {
  const c = BUILDINGS[kind].cost;
  let sum = c;
  for (let lv = 2; lv <= level; lv++) sum += c * (lv - 1);
  return sum;
}
