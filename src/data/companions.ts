/**
 * NPC 夥伴的職業資料。數值都集中在這裡調整。
 *
 * 招募方式：白天探索時救出倖存者，帶回據點後加入隊伍（GameState.recruit）。
 * 探索模式完成前，新遊戲先送一組預設小隊方便測試（DEFAULT_CREW）。
 */
export type CompanionRole = 'shooter' | 'medic' | 'engineer';

export interface CompanionGunDef {
  damage: number;
  /** 每秒射擊次數 */
  fireRate: number;
  magazine: number;
  reloadTime: number;
  /** 射程（像素） */
  range: number;
  /** 散布角度（度） */
  spread: number;
  /** 瞄頭的機率（0~1） */
  headChance: number;
  knockback: number;
}

export interface CompanionRoleDef {
  role: CompanionRole;
  /** 顯示用職業名 */
  title: string;
  maxHp: number;
  /** 移動速度（像素 / 秒，左右）；前後自動乘 0.7 */
  speed: number;
  /** 佔位用：把主角圖染成這個顏色 */
  tint: number;
  /** 頭上職業標記的顏色 */
  markColor: number;
  gun: CompanionGunDef;
  /** 醫護：每次治療量、間隔、範圍 */
  heal?: { amount: number; interval: number; range: number };
  /** 工兵：每秒修理量 */
  repairPerSec?: number;
}

export const COMPANION_ROLES: Record<CompanionRole, CompanionRoleDef> = {
  shooter: {
    role: 'shooter',
    title: '射手',
    maxHp: 70,
    speed: 72,
    tint: 0x7f9cff,
    markColor: 0x42a5f5,
    gun: { damage: 8, fireRate: 1.4, magazine: 10, reloadTime: 1.6, range: 300, spread: 3, headChance: 0.2, knockback: 2 },
  },
  medic: {
    role: 'medic',
    title: '醫護',
    maxHp: 55,
    speed: 76,
    tint: 0x9fe6a0,
    markColor: 0x66bb6a,
    gun: { damage: 4, fireRate: 0.8, magazine: 8, reloadTime: 1.4, range: 220, spread: 5, headChance: 0.05, knockback: 1 },
    heal: { amount: 10, interval: 2.5, range: 90 },
  },
  engineer: {
    role: 'engineer',
    title: '工兵',
    maxHp: 80,
    speed: 66,
    tint: 0xffb25c,
    markColor: 0xffa726,
    gun: { damage: 4, fireRate: 0.8, magazine: 8, reloadTime: 1.6, range: 200, spread: 5, headChance: 0.05, knockback: 1 },
    repairPerSec: 7,
  },
};

/** 同時出戰的夥伴上限 */
export const MAX_DEPLOYED = 3;

/** 夥伴血歸零即永久陣亡（從隊伍移除），沒有扶起機制。 */

/** 存檔裡的一位隊員 */
export interface CrewMember {
  id: string;
  name: string;
  role: CompanionRole;
}

const NAMES = ['阿哲', '小芸', '老陳', '阿凱', '美玲', '大熊', '阿樂', '小雨', '志明', '春嬌'];

export function randomCrewName(taken: string[] = []): string {
  const free = NAMES.filter((n) => !taken.includes(n));
  const pool = free.length > 0 ? free : NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const DEFAULT_CREW: CrewMember[] = [
  { id: 'crew-1', name: '阿哲', role: 'shooter' },
  { id: 'crew-2', name: '小芸', role: 'medic' },
  { id: 'crew-3', name: '老陳', role: 'engineer' },
];
