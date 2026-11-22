import { Rng } from '../utils/rng';
import type { CompanionRole } from './companions';
import {
  BODY_EXCLUSIVE,
  BODY_GEAR,
  BOOT_COLORS,
  CLOTH,
  FACE_GEAR,
  HAIR_COLORS,
  HAIR_STYLES,
  HEAD_GEAR,
  JACKET_COLORS,
  NO_FACE_WEIGHT,
  NO_HAT_WEIGHT,
  PANTS_COLORS,
  SKIN_TONES,
  roleWeight,
  type BodyGearId,
  type CrewLook,
  type FaceGearId,
  type GearDef,
  type HeadGearId,
} from './crewLooks';
import {
  ATTRS,
  FLAW_BONUS_POINTS,
  FLAW_CHANCE,
  SECOND_PERK_CHANCE,
  TRAITS,
  TRAIT_BY_ID,
  type CrewAttrs,
  type TraitDef,
} from './crewTraits';

/**
 * 隨機產生一位倖存者：名字、外觀、屬性、特質。
 * 全部由種子決定，同一個種子一定產生同一個人。
 */

const SURNAMES = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐蘇葉莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余趙盧梁顏柯孫魏翁戴范宋方'.split('');
const GIVEN = '志明家豪俊傑建宏冠宇承恩宗翰柏翰淑芬美玲雅婷怡君佩珊欣怡詩涵品妤宜蓁子晴國華文雄振宇信宏嘉玲惠婷心怡宇軒浩然'.match(/.{2}/g)!;
const NICK_PREFIX = ['阿', '小', '老', '大'];
const NICK_CHAR = '哲芸陳凱樂雨熊胖猴龍虎強明華美玲偉翔安峰傑鳳妹弟伯叔'.split('');

export function randomName(rng: Rng, taken: string[] = []): string {
  for (let i = 0; i < 30; i++) {
    const n = rng.chance(0.45) ? rng.pick(NICK_PREFIX) + rng.pick(NICK_CHAR) : rng.pick(SURNAMES) + rng.pick(GIVEN);
    if (!taken.includes(n)) return n;
  }
  return rng.pick(SURNAMES) + rng.pick(GIVEN);
}

export interface CrewProfileGen {
  name: string;
  look: CrewLook;
  attrs: CrewAttrs;
  traits: string[];
}

function pickTraits(rng: Rng, role: CompanionRole): string[] {
  const chosen: TraitDef[] = [];
  const ok = (t: TraitDef): boolean =>
    !chosen.includes(t) &&
    (!t.roles || t.roles.includes(role)) &&
    !chosen.some((c) => c.excludes?.includes(t.id) || t.excludes?.includes(c.id));
  const add = (kind: 'perk' | 'flaw'): void => {
    const t = rng.weighted(TRAITS, (x) => (x.kind === kind && ok(x) ? x.weight : 0));
    if (t) chosen.push(t);
  };
  add('perk');
  const flawed = rng.chance(FLAW_CHANCE);
  if (flawed) add('flaw');
  // 有缺點的人較容易多一個專長（補償）
  if (rng.chance(flawed ? SECOND_PERK_CHANCE + 0.25 : SECOND_PERK_CHANCE)) add('perk');
  return chosen.map((t) => t.id);
}

/** 職業偏好的屬性（多分到點數的機率較高） */
const ROLE_FAVOR: Record<CompanionRole, Partial<CrewAttrs>> = {
  shooter: { aim: 2, hand: 1.5 },
  medic: { agi: 1.6, nerve: 1.4 },
  engineer: { vit: 1.8, hand: 1.2 },
};

function rollAttrs(rng: Rng, role: CompanionRole, flawed: boolean): CrewAttrs {
  const attrs: CrewAttrs = { vit: 3, agi: 3, aim: 3, hand: 3, nerve: 3 };
  const keys = ATTRS.map((a) => a.key);
  const favor = ROLE_FAVOR[role];
  // 隨機搬點數：總和不變，所以每個人「一樣強、強的方向不同」
  const moves = rng.int(2, 5);
  for (let i = 0; i < moves; i++) {
    const to = rng.weighted(keys, (k) => (attrs[k] < 5 ? (favor[k] ?? 1) : 0));
    const from = rng.weighted(keys, (k) => (k !== to && attrs[k] > 1 ? 1 / (favor[k] ?? 1) : 0));
    if (!to || !from) continue;
    attrs[to]++;
    attrs[from]--;
  }
  let bonus = flawed ? FLAW_BONUS_POINTS : 0;
  while (bonus > 0) {
    const to = rng.weighted(keys, (k) => (attrs[k] < 5 ? (favor[k] ?? 1) : 0));
    if (!to) break;
    attrs[to]++;
    bonus--;
  }
  return attrs;
}

function pickGear<T extends string>(
  rng: Rng,
  list: GearDef<T>[],
  role: CompanionRole,
  noneWeight: number,
): T | null {
  const opts: (T | null)[] = [null, ...list.map((g) => g.id)];
  return (
    rng.weighted(opts, (id) => {
      if (id === null) return noneWeight;
      const g = list.find((x) => x.id === id)!;
      return roleWeight(g, role);
    }) ?? null
  );
}

function rollLook(rng: Rng, role: CompanionRole, traits: string[]): CrewLook {
  const tdefs = traits.map((id) => TRAIT_BY_ID[id]).filter(Boolean);
  const head = pickGear<HeadGearId>(rng, HEAD_GEAR, role, NO_HAT_WEIGHT);
  const headDef = HEAD_GEAR.find((h) => h.id === head);

  // 臉：0～1 件隨機 + 特質指定的
  const face = new Set<FaceGearId>();
  const f = pickGear<FaceGearId>(rng, FACE_GEAR, role, NO_FACE_WEIGHT);
  if (f) face.add(f);
  for (const t of tdefs) if (t.face) face.add(t.face);
  // 眼鏡類只留一副；特質指定的優先
  const eyewear: FaceGearId[] = ['glasses', 'sunglasses', 'goggles', 'eyepatch'];
  const forcedEye = tdefs.find((t) => t.face && eyewear.includes(t.face))?.face;
  for (const e of eyewear) if (face.has(e) && face.size > 1 && forcedEye && e !== forcedEye) face.delete(e);
  if (face.has('mask')) {
    face.delete('beard');
    face.delete('stubble');
    face.delete('cigarette');
  }
  if (face.has('beard')) face.delete('stubble');

  // 身上：職業招牌 + 0～2 件隨機 + 特質指定的
  const body = new Set<BodyGearId>();
  if (role === 'medic') body.add('armband');
  for (const t of tdefs) if (t.body) body.add(t.body);
  const extra = rng.int(0, 2);
  for (let i = 0; i < extra; i++) {
    const g = pickGear<BodyGearId>(rng, BODY_GEAR, role, 2);
    if (!g) continue;
    if (BODY_EXCLUSIVE.some((grp) => grp.includes(g) && grp.some((o) => body.has(o)))) continue;
    body.add(g);
  }

  const hairStyle = rng.weighted(HAIR_STYLES, (h) => h.weight)!.id;
  const gearColors = [1, 2, 3, 5, 6, 7, 8, 9, 11];
  const gearDef = BODY_GEAR.find((g) => body.has(g.id) && g.colors);
  let w = rng.float(0.94, 1.06);
  let h = rng.float(0.96, 1.04);
  for (const t of tdefs) {
    w += t.build?.w ?? 0;
    h += t.build?.h ?? 0;
  }
  const jacket = rng.pick(JACKET_COLORS);
  return {
    skin: rng.int(0, SKIN_TONES.length - 1),
    hair: HAIR_COLORS.indexOf(rng.weighted(HAIR_COLORS, (c) => c.weight)!),
    hairStyle,
    band: rng.chance(0.35) ? rng.pick([0, 3, 5, 6, 8, 2, 9]) : null,
    jacket,
    // 迷彩只配軍事色系，格紋只配布料感的顏色
    pattern: rng.weighted(['plain', 'plaid', 'camo'] as const, (p) =>
      p === 'plain' ? 6 : p === 'plaid' ? ([6, 2, 9, 8, 11].includes(jacket) ? 2 : 0) : CAMO_COLORS.includes(jacket) ? (role === 'shooter' ? 2.5 : 1) : 0,
    )!,
    pants: rng.pick(PANTS_COLORS),
    boots: rng.int(0, BOOT_COLORS.length - 1),
    kneePads: rng.chance(role === 'shooter' ? 0.6 : 0.3),
    head,
    headColor: headDef?.colors ? rng.pick(headDef.colors) : 3,
    face: [...face],
    body: [...body],
    gearColor: gearDef?.colors ? pickDifferent(rng, gearDef.colors, jacket) : pickDifferent(rng, gearColors, jacket),
    build: { w: clamp(w, 0.86, 1.14), h: clamp(h, 0.92, 1.06) },
  };

  function pickDifferent(r: Rng, list: number[], avoid: number): number {
    const pool = list.filter((c) => c !== avoid && CLOTH[c]);
    return pool.length ? r.pick(pool) : list[0];
  }
}

const CAMO_COLORS = [1, 3, 7, 9];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function generateCrewProfile(role: CompanionRole, seed: number, takenNames: string[] = []): CrewProfileGen {
  const rng = new Rng(seed);
  const traits = pickTraits(rng, role);
  const flawed = traits.some((t) => TRAIT_BY_ID[t]?.kind === 'flaw');
  const attrs = rollAttrs(rng, role, flawed);
  const look = rollLook(rng, role, traits);
  const name = randomName(rng, takenNames);
  return { name, look, attrs, traits };
}
