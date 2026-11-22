import type { CompanionGunDef, CompanionRole, CompanionRoleDef } from './companions';
import type { BodyGearId, FaceGearId } from './crewLooks';

/**
 * 隊員能力：五項屬性（1～5 星）＋ 特質（專長與缺點）。
 * 兩者都換算成對職業基礎數值的乘數，集中在 resolveCrewStats() 一次算好，
 * 戰鬥程式只讀算好的結果，平衡時只需要改這個檔案。
 */
export type AttrKey = 'vit' | 'agi' | 'aim' | 'hand' | 'nerve';

export const ATTRS: { key: AttrKey; name: string; desc: string }[] = [
  { key: 'vit', name: '體力', desc: '血量' },
  { key: 'agi', name: '腳程', desc: '移動速度' },
  { key: 'aim', name: '槍法', desc: '散布、爆頭率' },
  { key: 'hand', name: '手速', desc: '射速、換彈' },
  { key: 'nerve', name: '膽識', desc: '反應時間、被貼身時的穩定度' },
];

export type CrewAttrs = Record<AttrKey, number>;

/** 屬性每項 3 星為平均，總和固定 15；有缺點的人多 2 點補償 */
export const FLAW_BONUS_POINTS = 2;
/** 每人 1～2 個專長；帶缺點的機率 */
export const FLAW_CHANCE = 0.5;
export const SECOND_PERK_CHANCE = 0.35;

/** 特質對數值的修正（全部選填，乘數預設 1、加值預設 0） */
export interface TraitMods {
  hp?: number;
  speed?: number;
  damage?: number;
  fireRate?: number;
  reload?: number;
  spread?: number;
  range?: number;
  magazine?: number;
  knockback?: number;
  /** 爆頭率加值 */
  headChance?: number;
  /** 反應時間倍率 */
  aimDelay?: number;
  /** 治療量倍率（醫護） */
  heal?: number;
  /** 修理速度倍率（工兵） */
  repair?: number;
}

/** 需要戰鬥程式特別處理的行為 */
export type TraitHook =
  | 'lastStand' // 血少於 35%：傷害、射速提升
  | 'secondWind' // 每晚一次，致命傷改留 1 血
  | 'nimble' // 有機率閃過近戰攻擊
  | 'inspiring' // 附近隊友射速提升
  | 'scavenger' // 活過一晚多帶回廢料
  | 'skittish' // 霧屍靠近時手抖、會往後退
  | 'reckless'; // 不太管隊形，會往前站

export interface TraitDef {
  id: string;
  name: string;
  desc: string;
  kind: 'perk' | 'flaw';
  weight: number;
  /** 只會出現在這些職業 */
  roles?: CompanionRole[];
  mods?: TraitMods;
  hook?: TraitHook;
  /** 外觀上一定會帶的配件（讓能力看得出來） */
  face?: FaceGearId;
  body?: BodyGearId;
  /** 體型傾向：寬、高的加減 */
  build?: { w?: number; h?: number };
  /** 互斥的特質 */
  excludes?: string[];
}

export const TRAITS: TraitDef[] = [
  // ── 專長 ──
  { id: 'sharpshooter', name: '神槍手', desc: '爆頭率 +15%、射程 +15%', kind: 'perk', weight: 3, mods: { headChance: 0.15, range: 1.15 } },
  { id: 'quickhands', name: '快手', desc: '換彈時間 -35%', kind: 'perk', weight: 3, mods: { reload: 0.65 } },
  { id: 'tough', name: '鐵打的', desc: '血量 +30%', kind: 'perk', weight: 3, mods: { hp: 1.3 }, build: { w: 0.06 } },
  { id: 'fleet', name: '飛毛腿', desc: '移動速度 +22%', kind: 'perk', weight: 2, mods: { speed: 1.22 }, build: { w: -0.05, h: 0.02 } },
  { id: 'heavyhitter', name: '重手', desc: '傷害 +20%、擊退加倍', kind: 'perk', weight: 2.5, mods: { damage: 1.2, knockback: 2 }, build: { w: 0.05 } },
  { id: 'triggerhappy', name: '火力狂', desc: '射速 +30%，但散布 +20%', kind: 'perk', weight: 2, mods: { fireRate: 1.3, spread: 1.2 }, body: 'bandolier' },
  { id: 'coolhead', name: '冷靜', desc: '反應快一倍，被貼身也不慌', kind: 'perk', weight: 2.5, mods: { aimDelay: 0.5 }, excludes: ['skittish'] },
  { id: 'laststand', name: '背水一戰', desc: '血量低於 35% 時傷害 +40%、射速 +25%', kind: 'perk', weight: 2, hook: 'lastStand' },
  { id: 'secondwind', name: '命硬', desc: '每晚一次，致命傷改為剩 1 血', kind: 'perk', weight: 1.5, hook: 'secondWind' },
  { id: 'nimble', name: '身手矯健', desc: '20% 機率閃過霧屍攻擊', kind: 'perk', weight: 2, hook: 'nimble', build: { w: -0.04 } },
  { id: 'inspiring', name: '鼓舞人心', desc: '附近隊友射速 +12%', kind: 'perk', weight: 1.2, hook: 'inspiring', excludes: ['loner'] },
  { id: 'scavenger', name: '拾荒好手', desc: '活過一晚多帶回 8 廢料', kind: 'perk', weight: 1.5, hook: 'scavenger', body: 'backpack' },
  { id: 'fieldmedic', name: '戰地醫生', desc: '治療量 +40%', kind: 'perk', weight: 4, roles: ['medic'], mods: { heal: 1.4 } },
  { id: 'handyman', name: '巧手', desc: '修理速度 +50%', kind: 'perk', weight: 4, roles: ['engineer'], mods: { repair: 1.5 }, body: 'toolbelt' },
  { id: 'deadeye', name: '老練射手', desc: '傷害 +15%、彈匣 +30%', kind: 'perk', weight: 3, roles: ['shooter'], mods: { damage: 1.15, magazine: 1.3 } },

  // ── 缺點 ──
  { id: 'nearsighted', name: '近視', desc: '射程 -25%、散布 +25%', kind: 'flaw', weight: 3, mods: { range: 0.75, spread: 1.25 }, face: 'glasses', excludes: ['sharpshooter'] },
  { id: 'skittish', name: '膽小', desc: '霧屍靠近時手抖、會往後退', kind: 'flaw', weight: 2.5, hook: 'skittish', excludes: ['coolhead', 'laststand'] },
  { id: 'butterfingers', name: '笨手笨腳', desc: '換彈時間 +45%', kind: 'flaw', weight: 2.5, mods: { reload: 1.45 }, excludes: ['quickhands'] },
  { id: 'frail', name: '體弱', desc: '血量 -22%', kind: 'flaw', weight: 2.5, mods: { hp: 0.78 }, build: { w: -0.06 }, excludes: ['tough'] },
  { id: 'sluggish', name: '慢吞吞', desc: '移動速度 -22%', kind: 'flaw', weight: 2, mods: { speed: 0.78 }, build: { w: 0.07, h: -0.02 }, excludes: ['fleet'] },
  { id: 'smoker', name: '老菸槍', desc: '血量 -10%、移動速度 -10%', kind: 'flaw', weight: 1.5, mods: { hp: 0.9, speed: 0.9 }, face: 'cigarette' },
  { id: 'wasteful', name: '浪費子彈', desc: '彈匣 -35%', kind: 'flaw', weight: 2, mods: { magazine: 0.65 }, excludes: ['deadeye'] },
  { id: 'reckless', name: '莽撞', desc: '常常站到隊形前面', kind: 'flaw', weight: 1.5, hook: 'reckless', excludes: ['skittish'] },
  { id: 'loner', name: '獨行俠', desc: '不吃鼓舞效果，治療量 -30%', kind: 'flaw', weight: 1, mods: { heal: 0.7 }, excludes: ['inspiring'] },
];

export const TRAIT_BY_ID: Record<string, TraitDef> = Object.fromEntries(TRAITS.map((t) => [t.id, t]));

/** 一位隊員實際的戰鬥數值（職業基礎 × 屬性 × 特質） */
export interface CrewStats {
  maxHp: number;
  speed: number;
  gun: CompanionGunDef;
  aimDelay: number;
  heal?: { amount: number; interval: number; range: number };
  repairPerSec?: number;
  hooks: Set<TraitHook>;
}

/** 每一星相對 3 星的影響 */
const PER_STAR = {
  hp: 0.12,
  speed: 0.08,
  spread: 0.15,
  headChance: 0.04,
  fireRate: 0.08,
  reload: 0.1,
  aimDelay: 0.25,
};

const BASE_AIM_DELAY = 0.25;

export interface CrewProfile {
  attrs: CrewAttrs;
  traits: string[];
}

export function resolveCrewStats(def: CompanionRoleDef, profile: CrewProfile, baseGun: CompanionGunDef = def.gun): CrewStats {
  const a = profile.attrs;
  const m: Required<TraitMods> = {
    hp: 1,
    speed: 1,
    damage: 1,
    fireRate: 1,
    reload: 1,
    spread: 1,
    range: 1,
    magazine: 1,
    knockback: 1,
    headChance: 0,
    aimDelay: 1,
    heal: 1,
    repair: 1,
  };
  const hooks = new Set<TraitHook>();
  for (const id of profile.traits) {
    const t = TRAIT_BY_ID[id];
    if (!t) continue;
    if (t.hook) hooks.add(t.hook);
    for (const [k, v] of Object.entries(t.mods ?? {}) as [keyof TraitMods, number][]) {
      if (k === 'headChance') m.headChance += v;
      else m[k] *= v;
    }
  }
  const d = (k: AttrKey): number => (a[k] ?? 3) - 3;
  const gun: CompanionGunDef = {
    ...baseGun,
    damage: baseGun.damage * m.damage,
    fireRate: baseGun.fireRate * (1 + PER_STAR.fireRate * d('hand')) * m.fireRate,
    magazine: Math.max(2, Math.round(baseGun.magazine * m.magazine)),
    reloadTime: baseGun.reloadTime * (1 - PER_STAR.reload * d('hand')) * m.reload,
    range: baseGun.range * m.range,
    spread: Math.max(0.5, baseGun.spread * (1 - PER_STAR.spread * d('aim')) * m.spread),
    headChance: Math.min(0.75, Math.max(0, baseGun.headChance + PER_STAR.headChance * d('aim') + m.headChance)),
    knockback: baseGun.knockback * m.knockback,
  };
  return {
    maxHp: Math.round(def.maxHp * (1 + PER_STAR.hp * d('vit')) * m.hp),
    speed: def.speed * (1 + PER_STAR.speed * d('agi')) * m.speed,
    gun,
    aimDelay: BASE_AIM_DELAY * Math.max(0.2, 1 - PER_STAR.aimDelay * d('nerve')) * m.aimDelay,
    heal: def.heal ? { ...def.heal, amount: Math.round(def.heal.amount * m.heal) } : undefined,
    repairPerSec: def.repairPerSec ? def.repairPerSec * m.repair : undefined,
    hooks,
  };
}

/** 給介面顯示：「神槍手、近視」 */
export function traitNames(ids: string[]): string {
  return ids
    .map((id) => TRAIT_BY_ID[id]?.name)
    .filter(Boolean)
    .join('、');
}

/** 戰鬥相關常數 */
export const TRAIT_TUNING = {
  lastStandRatio: 0.35,
  lastStandDamage: 1.4,
  lastStandFireRate: 1.25,
  nimbleChance: 0.2,
  inspireRange: 90,
  inspireFireRate: 1.12,
  scavengerScrap: 8,
  /** 膽小：霧屍在這距離內時散布 ×1.6、往後退 */
  skittishRange: 60,
  skittishSpread: 1.6,
  /** 一般人膽識低（1～2 星）也會被貼身影響，倍率較小 */
  lowNervePanicSpread: 1.25,
  recklessStep: 26,
};
