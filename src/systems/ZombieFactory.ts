import Phaser from 'phaser';
import { composeZombie, type BodyLook } from '../art/ZombieComposer';
import { ANIMAL_PALETTES, composeAnimal } from '../art/AnimalArt';
import { Zombie } from '../entities/Zombie';
import type { EnemyDef } from '../data/enemies';
import {
  BUILDS,
  FEMALE,
  HAIR_COLORS,
  HELMETS,
  MUTATIONS,
  SKIRT_COLORS,
  PROFESSIONS,
  SKINS,
  mutationChance,
  paceMul,
  secondMutationChance,
  type ArmorPiece,
  type BuildDef,
  type BuildId,
  type BodyKind,
  type HatId,
  type MutationDef,
  type MutationId,
  type ProfessionDef,
} from '../data/zombies';

/** 一隻霧屍的完整「個體」：職業、外觀、裝備、變異，以及套用後的最終數值 */
export interface ZombieSpec {
  profession: ProfessionDef;
  mutations: MutationDef[];
  /** 最終數值（給 Zombie 用；id 仍是職業 id，音效與統計靠它分類） */
  def: EnemyDef;
  /** 合成好的身體貼圖 key */
  texture: string;
  hat: HatId;
  /** 頭飾顏色（可染色的頭飾才有） */
  hatTint?: number;
  /** 頭盔（會擋爆頭、會被打飛） */
  helmet: ArmorPiece | null;
  /** 防彈背心（會被打壞） */
  vest: ArmorPiece | null;
  /** 天生身體減傷（不會壞） */
  bodyArmor: number;
  knockbackResist: number;
  staggerResist: number;
  structureMul: number;
  fireproof: boolean;
  burst: 'big' | 'small' | null;
  regen: number;
  /** 人形或動物 */
  body: BodyKind;
  /** 體型（影響數值與寬度） */
  build: BuildDef;
  female: boolean;
  /** 橫向寬度倍率（體型 × 性別），Zombie 用 setScale(s × widthMul, s) */
  widthMul: number;
  /** 身體色調（變異） */
  tint?: number;
  /** 顯示用全名，例如「狂暴的警察霧屍」 */
  displayName: string;
}

/**
 * 每個職業最多保留幾組合成好的外觀；超過就從既有的裡面挑，
 * 避免一路玩下去貼圖無限增加（每組約 250KB）。頭飾、變異色調不佔名額。
 */
const LOOKS_PER_PROFESSION = 6;
const lookPool = new Map<string, string[]>();

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function weighted<K extends string>(table: Partial<Record<K, number>>): K {
  const entries = Object.entries(table) as [K, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

const HAT_COLORS = [0xc03030, 0x3050a0, 0x2a2a2a, 0x40803a, 0xd0a020, 0x808080, 0x8a4ab0, 0xd06a20];
const FIRE_HELMET_COLORS = [0xe8e0c8, 0xd83020, 0xf0c020, 0x303030];
const BACKPACK_COLORS = [0x6a4a2a, 0x2a4a6a, 0x5a2a2a, 0x3a5a2a, 0x2a2a2a];

function rollLook(scene: Phaser.Scene, p: ProfessionDef, female = false): string {
  const poolKey = `${p.id}:${female ? 'f' : 'm'}`;
  const pool = lookPool.get(poolKey) ?? [];
  lookPool.set(poolKey, pool);
  // 有效的貼圖才重用（場景重開後 TextureManager 仍保留，通常都在）
  const alive = pool.filter((k) => scene.textures.exists(k));
  if (alive.length >= LOOKS_PER_PROFESSION) return pick(alive);
  const [b0, b1] = p.look.blood ?? [0, 2];
  const look: BodyLook = {
    skin: pick(p.look.skins ?? SKINS),
    shirt: pick(p.look.shirts),
    pants: pick(p.look.pants),
    shirtPattern: p.look.shirt,
    pantsPattern: p.look.pantsPattern ?? 'plain',
    backpack: Math.random() < (p.look.backpack ?? 0) ? pick(BACKPACK_COLORS) : null,
    blood: Phaser.Math.Between(b0, b1),
    widen: +(p.widen * Phaser.Math.FloatBetween(0.95, 1.06)).toFixed(2),
    seed: Phaser.Math.Between(1, 9999),
    hair: female ? { style: pick(['long', 'long', 'ponytail', 'bob'] as const), color: pick(HAIR_COLORS) } : null,
    skirt: female && Math.random() < (p.skirtChance ?? 0) ? pick(SKIRT_COLORS) : null,
  };
  // 同一身制服：上衣和褲子用同一色（連身服、消防衣、手術服、迷彩）
  if (p.look.shirt === 'jumpsuit' || p.look.shirt === 'fire' || p.look.shirt === 'scrubs' || p.look.shirt === 'camo') {
    const i = p.look.shirts.indexOf(look.shirt);
    look.pants = p.look.pants[i] ?? look.pants;
  }
  const key = composeZombie(scene, look);
  if (key !== 'zombie_basic') pool.push(key);
  return key;
}

/**
 * 預先合成外觀：每組約 4–5ms，夜裡第一次出現某職業時才合成會小卡一下，
 * 所以白天進場時就把今晚會出現的職業都合成好。
 */
export function prewarmLooks(scene: Phaser.Scene, professionIds: Iterable<string>): void {
  for (const id of new Set(professionIds)) {
    const p = PROFESSIONS[id];
    if (!p) continue;
    if (p.body && p.body !== 'human') {
      ANIMAL_PALETTES[p.body].forEach((_, v) => composeAnimal(scene, p.body as Exclude<BodyKind, 'human'>, v));
      continue;
    }
    for (const female of [false, true]) {
      if (female && (p.femaleChance ?? 0.45) <= 0) continue;
      // 女性比例低的職業先合成少一點，其餘夜裡再補
      const want = female ? Math.ceil(LOOKS_PER_PROFESSION * Math.min(1, (p.femaleChance ?? 0.45) * 2)) : LOOKS_PER_PROFESSION;
      for (let i = lookPool.get(`${id}:${female ? 'f' : 'm'}`)?.length ?? 0; i < want; i++) rollLook(scene, p, female);
    }
  }
}

function rollMutations(day: number): MutationDef[] {
  if (Math.random() >= mutationChance(day)) return [];
  const avail = Object.values(MUTATIONS).filter((m) => m.unlockDay <= day);
  const table = Object.fromEntries(avail.map((m) => [m.id, m.weight])) as Partial<Record<MutationId, number>>;
  const first = MUTATIONS[weighted(table)];
  const list = [first];
  if (Math.random() < secondMutationChance(day)) {
    delete table[first.id];
    if (Object.keys(table).length) list.push(MUTATIONS[weighted(table)]);
  }
  return list;
}

/** 指定部分屬性（圖鑑、劇情、探索事件用）；沒指定的照常隨機 */
export interface RollOptions {
  mutations?: MutationId[];
  female?: boolean;
  build?: BuildId;
}

/** 擲出一隻霧屍。professionId 不存在時退回平民。 */
export function rollZombie(scene: Phaser.Scene, professionId: string, day: number, opts: RollOptions | MutationId[] = {}): ZombieSpec {
  const o: RollOptions = Array.isArray(opts) ? { mutations: opts } : opts;
  const p = PROFESSIONS[professionId] ?? PROFESSIONS.basic;
  const muts = o.mutations ? o.mutations.map((id) => MUTATIONS[id]) : rollMutations(day);
  const prod = (f: (m: MutationDef) => number | undefined) => muts.reduce((k, m) => k * (f(m) ?? 1), 1);

  const body: BodyKind = p.body ?? 'human';
  const animal = body !== 'human';
  const hat = weighted(p.hats);
  const helmetDef = HELMETS[hat];
  const female = !animal && (o.female ?? Math.random() < (p.femaleChance ?? 0.45));
  const defaultBuilds = Object.fromEntries(Object.values(BUILDS).map((b) => [b.id, b.weight])) as Record<BuildId, number>;
  const build = BUILDS[animal ? 'average' : (o.build ?? weighted(p.builds ?? defaultBuilds))];
  const scale = +(
    p.scale *
    build.scaleMul *
    (female ? FEMALE.scaleMul : 1) *
    prod((m) => m.scaleMul) *
    Phaser.Math.FloatBetween(0.96, 1.05)
  ).toFixed(3);
  const widthMul = +(build.widthMul * (female ? FEMALE.widthMul : 1)).toFixed(3);
  const texture = animal
    ? composeAnimal(scene, body, Math.floor(Math.random() * ANIMAL_PALETTES[body].length))
    : rollLook(scene, p, female);
  const def: EnemyDef = {
    id: p.id,
    name: p.name,
    hp: Math.round(p.hp * build.hpMul * prod((m) => m.hpMul)),
    speed: p.speed * build.speedMul * prod((m) => m.speedMul) * paceMul(day),
    damage: Math.round(p.damage * build.damageMul * prod((m) => m.damageMul)),
    attackInterval: p.attackInterval * prod((m) => m.attackIntervalMul),
    width: 20,
    height: 44,
    color: 0x888888,
    texture,
    scale,
  };
  const burstFromMut = muts.some((m) => m.burst);
  const tinted = muts.find((m) => m.tint !== undefined);
  let hatTint: number | undefined;
  if (hat === 'fire_helmet') hatTint = pick(FIRE_HELMET_COLORS);
  else if (hat === 'cap' || hat === 'beanie' || hat === 'bandana') hatTint = pick(HAT_COLORS);

  return {
    profession: p,
    mutations: muts,
    def,
    texture,
    hat,
    hatTint,
    helmet: helmetDef ? { ...helmetDef } : null,
    vest: p.vest ? { ...p.vest } : null,
    bodyArmor: Math.min(0.8, (p.bodyArmor ?? 0) + muts.reduce((s, m) => s + (m.bodyArmor ?? 0), 0)),
    knockbackResist: Math.min(1, (p.knockbackResist ?? 0) + build.knockbackResist + muts.reduce((s, m) => s + (m.knockbackResist ?? 0), 0)),
    staggerResist: p.staggerResist ?? 0,
    structureMul: p.structureMul ?? 1,
    fireproof: !!p.fireproof,
    burst: p.ability === 'burst' ? 'big' : burstFromMut ? 'small' : null,
    regen: muts.reduce((s, m) => s + (m.regen ?? 0), 0),
    tint: tinted?.tint,
    body,
    build,
    female,
    widthMul,
    displayName: muts.map((m) => m.prefix).join('') + build.prefix + (female ? '女' : '') + p.name,
  };
}

/** 擊殺掉落：職業基礎 + 每個變異加成 */
export function scrapFor(spec: ZombieSpec): number {
  return spec.profession.scrap + spec.mutations.reduce((s, m) => s + m.scrap, 0);
}

/** 威脅點數（波次預算） */
export function threatOf(professionId: string): number {
  return PROFESSIONS[professionId]?.threat ?? 1;
}

/**
 * 出怪的統一入口（夜晚防守、探索模式、劇情事件都用這個）：擲出個體並放進場景。
 * 回傳的 Zombie 需要呼叫端每幀 update(dt, ctx)，並自行放進敵人清單。
 *
 *   const z = spawnEnemy(scene, 'dog', x, y, { day: 4 });
 *   const boss = spawnEnemy(scene, 'bear', x, y, { day: 9, mutations: ['frenzied'] });
 */
export function spawnEnemy(
  scene: Phaser.Scene,
  id: string,
  x: number,
  y: number,
  opts: RollOptions & { day?: number } = {},
): Zombie {
  return new Zombie(scene, x, y, rollZombie(scene, id, opts.day ?? 1, opts));
}

/** 目前可出現的敵人 id（依天數解鎖）；body 可篩選人形或某種動物 */
export function enemyIds(day = Infinity, body?: BodyKind): string[] {
  return Object.values(PROFESSIONS)
    .filter((p) => p.unlockDay <= day && (!body || (p.body ?? 'human') === body))
    .map((p) => p.id);
}
