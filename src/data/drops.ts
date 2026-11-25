import type { Loot } from './explore';

/**
 * 夜晚防守：特殊職業霧屍被打倒時，有機率掉出跟生前職業有關的東西。
 * 掉落物留在屍體旁邊一段時間，主角要走過去撿（翻出路障外撿＝冒險換資源）。
 * 撐過一夜時，地上還沒撿的東西會自動收回據點。
 *
 * 邏輯在 src/systems/ZombieDrops.ts；這裡只放數值。
 */

/** 掉落物的小圖示（程式畫的，見 ZombieDrops.ts 的 ICONS） */
export type DropIcon = 'ammo' | 'shells' | 'rifle' | 'med' | 'heal' | 'tool' | 'pick' | 'gun' | 'scrap';

export interface DropEntry {
  weight: number;
  icon: DropIcon;
  /** 收進據點的東西（彈藥、用品、武器、廢料） */
  loot?: Loot;
  /** 撿到當下回血 */
  heal?: number;
  /** 撿到當下修補路障 */
  repair?: number;
  /** 跳字（沒寫就用 loot 的描述） */
  label?: string;
}

export interface DropTable {
  /** 倒下時掉東西的機率 */
  chance: number;
  entries: DropEntry[];
}

export const DROP_TUNING = {
  /** 有變異的霧屍額外加的掉落機率（每種變異） */
  mutationBonus: 0.12,
  /** 掉在地上多久消失（秒），最後 4 秒會閃 */
  lifetime: 16,
  blinkFrom: 4,
  /** 主角離多近會被吸過來 */
  magnet: 30,
};

/**
 * 職業 → 掉落表。霧屍不掉武器：武器只在指定的地點撿得到（見 src/data/weapons.ts 的 found）。
 * 平民、腫脹霧屍（會爆開）、動物不掉。
 */
export const ZOMBIE_DROPS: Partial<Record<string, DropTable>> = {
  police: {
    chance: 0.45,
    entries: [
      { weight: 6, icon: 'ammo', loot: { ammo: { '9mm': 15 } } },
      { weight: 2, icon: 'ammo', loot: { ammo: { '357': 6 } } },
      { weight: 2, icon: 'shells', loot: { ammo: { '12ga': 5 } } },
      { weight: 1, icon: 'tool', repair: 30, label: '鎮暴盾牌：路障 +30' },
    ],
  },
  soldier: {
    chance: 0.6,
    entries: [
      { weight: 6, icon: 'rifle', loot: { ammo: { '556': 20 } } },
      { weight: 3, icon: 'rifle', loot: { ammo: { '762': 10 } } },
      { weight: 3, icon: 'rifle', loot: { ammo: { '556': 10 } } },
      { weight: 1, icon: 'med', loot: { supplies: { medkit: 1 } }, label: '急救包 +1' },
    ],
  },
  nurse: {
    chance: 0.5,
    entries: [
      { weight: 4, icon: 'heal', heal: 25, label: '繃帶：生命 +25' },
      { weight: 3, icon: 'med', loot: { supplies: { medkit: 1 } } },
    ],
  },
  worker: {
    chance: 0.45,
    entries: [
      { weight: 4, icon: 'tool', repair: 40, label: '木板鐵釘：路障 +40' },
      { weight: 3, icon: 'scrap', loot: { scrap: 10 } },
    ],
  },
  firefighter: {
    chance: 0.45,
    entries: [
      { weight: 3, icon: 'tool', repair: 55, label: '破門工具：路障 +55' },
      { weight: 2, icon: 'heal', heal: 20, label: '氧氣面罩：生命 +20' },
      { weight: 1, icon: 'med', loot: { supplies: { medkit: 1 } } },
    ],
  },
  prisoner: {
    chance: 0.4,
    entries: [
      { weight: 3, icon: 'pick', loot: { supplies: { lockpick: 1 } } },
      { weight: 3, icon: 'scrap', loot: { scrap: 8 } },
      { weight: 1, icon: 'tool', loot: { supplies: { decoy: 1 } }, label: '噪音誘餌 +1' },
    ],
  },
  runner: {
    chance: 0.2,
    entries: [
      { weight: 3, icon: 'heal', heal: 15, label: '運動飲料：生命 +15' },
      { weight: 2, icon: 'scrap', loot: { scrap: 5 } },
    ],
  },
};
