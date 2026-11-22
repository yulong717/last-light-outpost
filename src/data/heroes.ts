import type { SupplyId } from './explore';
import type { AmmoType } from './weapons';

/**
 * 可選的主角。開局在選角畫面挑一位：起始武器、生命、開局地點、第一章劇情、技能都不同。
 * 技能的實際邏輯在 src/systems/HeroSystem.ts，數值都在這裡。
 * 玩法說明見 docs/HEROES.md。
 */
export type HeroId = 'student' | 'soldier' | 'lucky';

export interface HeroSkill {
  name: string;
  /** 主動技能的按鍵（被動不填） */
  key?: string;
  desc: string;
}

export interface HeroDef {
  id: HeroId;
  name: string;
  /** 身分（學生、特種兵…） */
  title: string;
  /** 選角畫面的一句話 */
  blurb: string;
  maxHp: number;
  /** 起始槍（第一把是主武器） */
  guns: string[];
  melee: string;
  /** 起始手槍是不是無限備彈（阿凱的 M1911 撿來的，彈匣有限） */
  infinitePistol: boolean;
  /** 起始備彈 */
  ammo: Partial<Record<AmmoType, number>>;
  supplies: Partial<Record<SupplyId, number>>;
  /** 開局地點（探索區域 id）：第一章在這裡 */
  startZone: string;
  skills: HeroSkill[];
  /** 主角身體的染色（同一套像素圖，用顏色區分） */
  tint: number;
  /** 選角卡的主色 */
  color: number;
}

export const HEROES: Record<HeroId, HeroDef> = {
  student: {
    id: 'student',
    name: '阿凱',
    title: '高中生',
    blurb: '棒球隊的板凳球員。跑得快、反應快，靠一根球棒殺出學校。',
    maxHp: 100,
    guns: ['m1911'],
    melee: 'bat',
    infinitePistol: false,
    ammo: { '9mm': 14 },
    supplies: { medkit: 1 },
    startZone: 'school',
    skills: [
      { name: '奔跑', key: 'Shift', desc: '移動速度 ×1.5，持續消耗體力。奔跑中近戰傷害 ×1.5、擊退大幅加強' },
      { name: '閃身步', desc: '被動：霧屍要打到或抓住你時，自動消耗 25% 體力閃開（冷卻 1.5 秒）' },
    ],
    tint: 0xc8d8ff,
    color: 0x5a8ae0,
  },
  soldier: {
    id: 'soldier',
    name: '馬克',
    title: '特種兵',
    blurb: '霧爆發那天正在鬧區執勤的特種部隊士兵。槍法好，近身格鬥更狠。',
    maxHp: 120,
    guns: ['m1911', 'm4a1'],
    melee: 'knife',
    infinitePistol: true,
    ammo: { '556': 90 },
    supplies: { grenade: 1 },
    startZone: 'downtown',
    skills: [
      { name: '戰術擊倒', key: 'C', desc: '消耗 30% 體力，近戰秒殺身邊最近的一隻霧屍（優先抓住你的那隻）。菁英改成重創 150 並硬直 2 秒' },
    ],
    tint: 0xc8d4a8,
    color: 0x7a8a4a,
  },
  lucky: {
    id: 'lucky',
    name: '好運姐',
    title: '幸運兒',
    blurb: '夜市彩券行的老闆娘，刮刮樂從沒槓龜過。霧來那晚，她又活了下來。',
    maxHp: 85,
    guns: ['python'],
    melee: 'knife',
    infinitePistol: false,
    ammo: { '357': 24 },
    supplies: { medkit: 1, lockpick: 1 },
    startZone: 'nightmarket',
    skills: [
      { name: '好狗運', desc: '被動：每發子彈 15% 機率「幸運一擊」必定爆頭；探索戰利品多抽一次、武器掉落率加倍' },
      { name: '大難不死', desc: '被動：每晚一次，致命傷改成剩 1 血，並把周圍霧屍震開' },
      { name: '霧屍滑倒', desc: '被動：被抓住時，每秒 25% 機率抓你的霧屍自己滑倒鬆手' },
    ],
    tint: 0xffd0e0,
    color: 0xd05a8a,
  },
};

export const HERO_ORDER: HeroId[] = ['student', 'soldier', 'lucky'];

export function getHero(id: HeroId | undefined): HeroDef {
  return HEROES[id ?? 'soldier'] ?? HEROES.soldier;
}

// ── 技能數值 ─────────────────────────────────────────

export const SPRINT = {
  speedMul: 1.5,
  /** 每秒耗體力 */
  drain: 20,
  /** 體力低於這個值不能開始跑 */
  minStart: 10,
  meleeDamageMul: 1.5,
  /** 擊退加成（像素） */
  meleeKnockback: 26,
  meleeStagger: 0.5,
};

export const DODGE = { cost: 25, cooldown: 1.5, iframes: 0.45, dash: 260 };

export const TAKEDOWN = {
  cost: 30,
  reach: 30,
  cooldown: 0.6,
  /** 威脅 ≥ 這個值算菁英，不能秒殺 */
  eliteThreat: 5,
  eliteDamage: 150,
  eliteStagger: 2,
};

export const LUCK = {
  critChance: 0.15,
  slipChancePerSec: 0.25,
  /** 大難不死：震開範圍與擊退 */
  lastStandRadius: 70,
  lastStandKnockback: 50,
  lastStandIframes: 2,
};

/** 被霧屍抓住（糾纏） */
export const GRAB = {
  /** 一隻抓住時的移動倍率；兩隻以上 */
  slow: 0.35,
  slowMulti: 0.2,
  /** 霧屍離開這個距離（被打退）就算掙脫 */
  breakDist: 36,
  /** 抓人的霧屍硬直超過這個秒數就鬆手（近戰、高制動的槍） */
  breakStagger: 0.2,
  /** 這些身體不會抓人 */
  noGrab: ['crow'] as string[],
};
