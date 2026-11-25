import { applyBase, generateBodyInfo, generateCrewProfile } from './crewGen';
import { BODIES, type BodyType, type Proficiency } from './crewBody';
import type { CrewLook } from './crewLooks';
import type { CrewAttrs } from './crewTraits';
import { hashSeed, randomSeed } from '../utils/rng';

/**
 * NPC 夥伴的職業資料。數值都集中在這裡調整。
 *
 * 招募方式：白天探索時救出倖存者，帶回據點後加入隊伍（GameState.recruit）。
 * 每位隊員的長相、屬性、特質都是隨機產生（src/data/crewGen.ts），職業只決定基礎數值與招牌配件。
 * 探索模式完成前，新遊戲先送一組預設小隊方便測試（defaultCrew）。
 */
export type CompanionRole = 'shooter' | 'medic' | 'engineer';

export interface CompanionGunDef {
  /** 用哪把武器的槍聲（src/data/weapons.ts 的 id）；用 companionGunFor(id) 產生整組數值 */
  weaponId?: string;
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
  /** 換裝貼圖還沒產生時的備用染色 */
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
  /** 產生外觀與能力用的種子（除錯時可重現） */
  seed: number;
  look: CrewLook;
  attrs: CrewAttrs;
  /** 特質 id（見 src/data/crewTraits.ts） */
  traits: string[];
  /** 體格（src/data/crewBody.ts）：血量、速度、閃避、近戰、後座、負重、身形 */
  body: BodyType;
  /** 出身：決定武器熟練度的底子 */
  background: string;
  /** 各類武器熟練度 0～4（0 = 不會用） */
  prof: Proficiency;
  /** 配發的武器（一把槍同時只會在一個人手上）；沒有就用隨身手槍 */
  weaponId?: string;
  /** 探索中倒下：還要休養幾天（> 0 時不能出戰、不能探索） */
  injuredDays?: number;
  /** 玩家在名冊裡設成「待命」：夜晚防守不上場 */
  standby?: boolean;
  /** 雙面據點（孤島小店）守哪一側：1 = 右、-1 = 左；沒設就左右輪流 */
  side?: 1 | -1;
}

/** 這位隊員現在能不能出戰／探索 */
export function crewReady(m: CrewMember): boolean {
  return !(m.injuredDays && m.injuredDays > 0);
}

/** 今晚會上場防守的隊員：沒負傷、沒設成待命，最多 MAX_DEPLOYED 位 */
export function deployedCrew(crew: CrewMember[]): CrewMember[] {
  return crew.filter((m) => crewReady(m) && !m.standby).slice(0, MAX_DEPLOYED);
}

/** 依職業與種子產生一位完整的隊員 */
export function makeCrewMember(id: string, role: CompanionRole, seed: number, takenNames: string[] = [], name?: string): CrewMember {
  const p = generateCrewProfile(role, seed, takenNames);
  return {
    id,
    role,
    seed,
    name: name ?? p.name,
    look: p.look,
    attrs: p.attrs,
    traits: p.traits,
    body: p.body,
    background: p.background,
    prof: p.prof,
  };
}

/**
 * 舊存檔的隊員只有 id／名字／職業：用 id 換一個固定種子補上外觀與能力。
 * 缺欄位才補，已經有的不動。
 */
export function upgradeCrewMember(m: Partial<CrewMember> & { id: string; name: string; role: CompanionRole }): CrewMember {
  let out: CrewMember;
  if (m.look && m.attrs && Array.isArray(m.traits) && typeof m.seed === 'number') out = m as CrewMember;
  else {
    const seed = typeof m.seed === 'number' ? m.seed : hashSeed(m.id);
    const full = makeCrewMember(m.id, m.role, seed, [], m.name);
    out = { ...full, ...(m.weaponId ? { weaponId: m.weaponId } : {}), ...(m.injuredDays ? { injuredDays: m.injuredDays } : {}) };
  }
  // 舊隊員沒有體格與出身：用獨立亂數補上，原本的長相不變（只依體格加寬身形）
  if (!out.body || !out.background || !out.prof) {
    const info = generateBodyInfo(out.role, out.seed, out.traits, out.attrs);
    out = { ...out, ...info, look: { ...out.look, widen: BODIES[info.body].widen } };
  }
  // 舊隊員還是主角換裝的樣子：補上底圖（不同的人），配件保留
  if (!out.look.base) out = { ...out, look: applyBase(out.look, out.seed, out) };
  return out;
}

/** 探索模式完成前，新遊戲先送一組預設小隊（每局隨機長相與能力） */
export function defaultCrew(): CrewMember[] {
  const roles: CompanionRole[] = ['shooter', 'medic', 'engineer'];
  const crew: CrewMember[] = [];
  roles.forEach((role, i) => {
    crew.push(makeCrewMember(`crew-${i + 1}-${randomSeed().toString(36)}`, role, randomSeed(), crew.map((c) => c.name)));
  });
  return crew;
}
