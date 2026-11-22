import type { CompanionRole } from './companions';
import type { BodyGearId, FaceGearId, HeadGearId } from './crewLooks';
import { getFirearm, getMelee, type WeaponClass } from './weapons';

/**
 * 隊員的「體格」與「出身」：比外觀更深的差異。
 *
 * - 體格：血量、速度、閃避、近戰力道、後座控制、負重都不同，畫面上身形也真的變寬變窄。
 * - 出身：決定會用哪些武器、用得多好（武器熟練度 0～4）。0 = 不會用，不能配發。
 * - 重武器有體格限制：瘦小的人扛不動機槍、揮不動大鐵鎚。
 */

// ───────────────────────── 體格 ─────────────────────────
export type BodyType = 'slim' | 'average' | 'athletic' | 'stocky' | 'hulk';

export interface BodyDef {
  id: BodyType;
  name: string;
  desc: string;
  weight: number;
  hp: number;
  speed: number;
  /** 閃避霧屍攻擊的機率 */
  dodge: number;
  /** 近戰傷害、擊退倍率 */
  melee: number;
  /** 後座控制：越大越穩（重武器散布、射速受影響） */
  recoil: number;
  /** 探索時多帶回的戰利品（每點 +8%） */
  carry: number;
  /** 畫面：軀幹加寬幾格像素（負數變窄）、整體高矮 */
  widen: number;
  height: number;
  /** 扛得動機槍 */
  heavyGuns: boolean;
  /** 揮得動重型近戰（大鐵鎚） */
  heavyMelee: boolean;
}

export const BODIES: Record<BodyType, BodyDef> = {
  slim: {
    id: 'slim',
    name: '瘦小',
    desc: '跑得快、難打中，但不耐打，扛不動重武器',
    weight: 2,
    hp: 0.8,
    speed: 1.12,
    dodge: 0.12,
    melee: 0.8,
    recoil: 0.8,
    carry: -1,
    widen: -3,
    height: 0.95,
    heavyGuns: false,
    heavyMelee: false,
  },
  average: {
    id: 'average',
    name: '標準',
    desc: '沒有特別的長處或短處',
    weight: 4,
    hp: 1,
    speed: 1,
    dodge: 0.04,
    melee: 1,
    recoil: 1,
    carry: 0,
    widen: 0,
    height: 1,
    heavyGuns: false,
    heavyMelee: true,
  },
  athletic: {
    id: 'athletic',
    name: '精實',
    desc: '體能好，跑得快、出手有力',
    weight: 2.5,
    hp: 1.08,
    speed: 1.08,
    dodge: 0.06,
    melee: 1.15,
    recoil: 1.1,
    carry: 0,
    widen: 1,
    height: 1.03,
    heavyGuns: true,
    heavyMelee: true,
  },
  stocky: {
    id: 'stocky',
    name: '壯碩',
    desc: '耐打、力氣大，能扛機槍，但跑得慢',
    weight: 2,
    hp: 1.28,
    speed: 0.9,
    dodge: 0.02,
    melee: 1.3,
    recoil: 1.25,
    carry: 1,
    widen: 4,
    height: 0.99,
    heavyGuns: true,
    heavyMelee: true,
  },
  hulk: {
    id: 'hulk',
    name: '巨漢',
    desc: '一堵肉牆：血多、力量驚人、背得多，但慢又是大目標',
    weight: 0.8,
    hp: 1.6,
    speed: 0.78,
    dodge: 0,
    melee: 1.55,
    recoil: 1.4,
    carry: 2,
    widen: 7,
    height: 1.1,
    heavyGuns: true,
    heavyMelee: true,
  },
};

// ───────────────────────── 武器熟練 ─────────────────────────
export type WeaponGroup = 'handgun' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'lmg' | 'melee';

export const WEAPON_GROUPS: { id: WeaponGroup; name: string }[] = [
  { id: 'handgun', name: '手槍' },
  { id: 'smg', name: '衝鋒槍' },
  { id: 'rifle', name: '步槍' },
  { id: 'shotgun', name: '霰彈槍' },
  { id: 'sniper', name: '狙擊槍' },
  { id: 'lmg', name: '機槍' },
  { id: 'melee', name: '近戰' },
];

export type Proficiency = Record<WeaponGroup, number>;

export const PROF_NAMES = ['不會用', '生疏', '普通', '熟練', '專精'];

/** 每一級熟練（相對「普通」）的影響 */
export const PROF_EFFECT = {
  spread: 0.16,
  fireRate: 0.08,
  reload: 0.12,
  headChance: 0.04,
  meleeDamage: 0.15,
  meleeSpeed: 0.1,
};

const CLASS_GROUP: Record<WeaponClass, WeaponGroup> = {
  pistol: 'handgun',
  revolver: 'handgun',
  smg: 'smg',
  rifle: 'rifle',
  shotgun: 'shotgun',
  sniper: 'sniper',
  lmg: 'lmg',
};

export function weaponGroup(id: string): WeaponGroup | null {
  if (getMelee(id)) return 'melee';
  const f = getFirearm(id);
  return f ? CLASS_GROUP[f.cls] : null;
}

// ───────────────────────── 出身 ─────────────────────────
export interface BackgroundDef {
  id: string;
  name: string;
  desc: string;
  /** 各職業出現的權重 */
  roles: Partial<Record<CompanionRole, number>>;
  prof: Proficiency;
  /** 體格傾向（權重倍率） */
  bodies?: Partial<Record<BodyType, number>>;
  /** 外觀傾向：這些配件出現機率提高 */
  head?: HeadGearId[];
  face?: FaceGearId[];
  gear?: BodyGearId[];
  /** 偏好的夾克顏色（CLOTH 索引） */
  jackets?: number[];
  /** 治療、修理加成 */
  heal?: number;
  repair?: number;
  /** 帶著自己的武器加入（招募時的預設配槍） */
  kit?: string;
}

const P = (handgun: number, smg: number, rifle: number, shotgun: number, sniper: number, lmg: number, melee: number): Proficiency => ({
  handgun,
  smg,
  rifle,
  shotgun,
  sniper,
  lmg,
  melee,
});

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'veteran',
    name: '退伍軍人',
    desc: '步槍與機槍的老手',
    roles: { shooter: 4, medic: 0.5, engineer: 1 },
    prof: P(3, 3, 4, 2, 2, 3, 2),
    bodies: { athletic: 2, stocky: 1.5, slim: 0.4 },
    head: ['helmet', 'cap'],
    gear: ['vest', 'bandolier'],
    jackets: [1, 3, 7, 9],
    kit: 'm4a1',
  },
  {
    id: 'police',
    name: '前警察',
    desc: '手槍、衝鋒槍、霰彈槍都熟',
    roles: { shooter: 3, medic: 0.7, engineer: 0.5 },
    prof: P(4, 3, 2, 3, 1, 1, 2),
    head: ['cap'],
    face: ['sunglasses'],
    gear: ['vest'],
    jackets: [2, 3, 5],
    kit: 'mp5',
  },
  {
    id: 'hunter',
    name: '獵人',
    desc: '狙擊天分，霰彈槍也拿手',
    roles: { shooter: 3, engineer: 0.8, medic: 0.5 },
    prof: P(2, 1, 3, 3, 4, 0, 2),
    bodies: { athletic: 1.5, hulk: 0.5 },
    head: ['bucket', 'cap', 'cowboy'],
    face: ['beard', 'stubble'],
    gear: ['backpack'],
    jackets: [1, 6, 7, 9],
    kit: 'mosin',
  },
  {
    id: 'gangster',
    name: '幫派份子',
    desc: '短槍掃射與巷戰',
    roles: { shooter: 2, engineer: 0.6, medic: 0.3 },
    prof: P(3, 4, 2, 3, 0, 1, 3),
    face: ['sunglasses', 'cigarette', 'stubble'],
    jackets: [5, 8, 3],
  },
  {
    id: 'laborer',
    name: '工地師傅',
    desc: '揮重物是本行，槍就普普',
    roles: { engineer: 4, shooter: 1, medic: 0.3 },
    prof: P(2, 1, 1, 2, 0, 2, 4),
    bodies: { stocky: 2.5, hulk: 2, slim: 0.3 },
    head: ['hardhat'],
    gear: ['hivis', 'toolbelt'],
    jackets: [7, 11, 4],
    repair: 1.2,
    kit: 'sledge',
  },
  {
    id: 'mechanic',
    name: '技師',
    desc: '修理快，霰彈槍和扳手都上手',
    roles: { engineer: 4, shooter: 0.5, medic: 0.3 },
    prof: P(2, 1, 1, 3, 0, 1, 3),
    face: ['goggles'],
    gear: ['toolbelt'],
    jackets: [2, 3, 4],
    repair: 1.25,
  },
  {
    id: 'athlete',
    name: '運動員',
    desc: '球棒揮得又快又狠，槍不太行',
    roles: { shooter: 1, medic: 1.2, engineer: 1 },
    prof: P(1, 1, 1, 1, 0, 1, 4),
    bodies: { athletic: 4, slim: 1, hulk: 0.6 },
    head: ['cap'],
    jackets: [2, 6, 12],
    kit: 'bat',
  },
  {
    id: 'doctor',
    name: '醫師',
    desc: '治療量高，只會用手槍',
    roles: { medic: 4, engineer: 0.2 },
    prof: P(2, 1, 1, 1, 0, 0, 1),
    bodies: { slim: 1.5, hulk: 0.3 },
    face: ['glasses'],
    jackets: [10, 2, 13],
    heal: 1.25,
  },
  {
    id: 'nurse',
    name: '護理師',
    desc: '治療快，冷靜沉著',
    roles: { medic: 3 },
    prof: P(2, 2, 1, 1, 0, 0, 1),
    jackets: [10, 9, 2],
    heal: 1.15,
  },
  {
    id: 'student',
    name: '大學生',
    desc: '什麼都生疏，但年輕腿快',
    roles: { shooter: 1, medic: 1, engineer: 1 },
    prof: P(2, 2, 1, 1, 1, 0, 2),
    bodies: { slim: 2.5, hulk: 0.2 },
    gear: ['backpack', 'scarf'],
    jackets: [0, 2, 4, 6, 8, 11],
  },
  {
    id: 'clerk',
    name: '上班族',
    desc: '沒碰過槍，只能拿手槍防身',
    roles: { shooter: 0.6, medic: 1, engineer: 1 },
    prof: P(2, 1, 1, 1, 0, 0, 1),
    face: ['glasses'],
    jackets: [3, 2, 5],
  },
  {
    id: 'fighter',
    name: '格鬥教練',
    desc: '近戰專精，討厭槍',
    roles: { shooter: 1, engineer: 0.8, medic: 0.4 },
    prof: P(1, 0, 0, 1, 0, 0, 4),
    bodies: { athletic: 3, stocky: 2, slim: 0.3 },
    face: ['bandage'],
    jackets: [5, 3, 8],
    kit: 'machete',
  },
];

export const BACKGROUND_BY_ID: Record<string, BackgroundDef> = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b]));

// ───────────────────────── 配發 ─────────────────────────
export interface CrewBodyInfo {
  body: BodyType;
  background: string;
  prof: Proficiency;
}

/** 這位隊員能不能用這把武器；不行時附上原因 */
export function canWield(m: CrewBodyInfo, weaponId: string): { ok: boolean; reason?: string } {
  const g = weaponGroup(weaponId);
  if (!g) return { ok: false, reason: '不是武器' };
  if ((m.prof[g] ?? 0) <= 0) return { ok: false, reason: `不會用${WEAPON_GROUPS.find((x) => x.id === g)?.name}` };
  const body = BODIES[m.body] ?? BODIES.average;
  if (g === 'lmg' && !body.heavyGuns) return { ok: false, reason: `${body.name}扛不動機槍` };
  const melee = getMelee(weaponId);
  if (melee && weaponId === 'sledge' && !body.heavyMelee) return { ok: false, reason: `${body.name}揮不動` };
  return { ok: true };
}

export function proficiencyFor(m: CrewBodyInfo, weaponId: string): number {
  const g = weaponGroup(weaponId);
  return g ? (m.prof[g] ?? 0) : 0;
}

/** 沒有配發武器時，各職業手上的預設武器 */
export const ROLE_DEFAULT_WEAPON: Record<CompanionRole, string> = { shooter: 'm4a1', medic: 'm1911', engineer: 'm1911' };

/** 實際會拿的武器：配發的（還能用）> 職業預設（會用的話）> 會用的手槍 > 近戰 */
export function effectiveWeapon(m: CrewBodyInfo & { role: CompanionRole; weaponId?: string }): string {
  if (m.weaponId && canWield(m, m.weaponId).ok) return m.weaponId;
  const def = ROLE_DEFAULT_WEAPON[m.role];
  if (canWield(m, def).ok) return def;
  if (canWield(m, 'm1911').ok) return 'm1911';
  return 'knife';
}

/** 熟練度最高的兩類，給介面簡短顯示（「步槍專精・機槍熟練」） */
export function profSummary(p: Proficiency): string {
  return WEAPON_GROUPS.filter((g) => p[g.id] >= 3)
    .sort((a, b) => p[b.id] - p[a.id])
    .slice(0, 2)
    .map((g) => `${g.name}${PROF_NAMES[p[g.id]]}`)
    .join('・');
}
