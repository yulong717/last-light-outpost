import { COMPANION_ROLES, type CompanionRole, type CrewMember } from '../data/companions';
import {
  AMMO_ROLL,
  EVENTS,
  EXPLORE_TIME,
  HORDE_EVENT,
  INTEL,
  LOOT_TIERS,
  NOISE,
  type EventAction,
  type ExploreEvent,
  type FieldSpec,
  type Loot,
  type LootTier,
  type Outcome,
  type SupplyId,
  type ZoneDef,
} from '../data/explore';
import { AMMO, getWeapon, type AmmoType } from '../data/weapons';
import { GameState } from '../state/GameState';
import { Rng, randomSeed } from '../utils/rng';

export const PLAYER_EXPLORE_HP = 100;

/** 事件結算後的說明（給畫面顯示） */
export interface Resolution {
  text: string;
  gained: Loot;
  hurt: number;
  crewHurt: { name: string; amount: number; downed: boolean }[];
  noise: number;
}

/**
 * 一趟探索的狀態：路線、噪音、主角與隊員血量、背包。
 * 不碰畫面；ExpeditionScene 讀它來畫，事件結果也都經由這裡結算。
 * 背包要平安回到據點才會入帳（bank），主角倒下就整包丟掉。
 */
export class Expedition {
  static current: Expedition | null = null;

  readonly rng: Rng;
  /** 目前在第幾站（0 起算）；等於 zone.nodes 代表走完 */
  index = 0;
  noise = 0;
  hp = PLAYER_EXPLORE_HP;
  readonly crewHp = new Map<string, number>();
  readonly bag: Loot = {};
  /** 已經抽過的事件（同一趟不重複） */
  private seen = new Set<string>();
  readonly riskNow: number;
  readonly lootMul: number;
  readonly intel?: (typeof INTEL)[keyof typeof INTEL];
  kills = 0;

  constructor(
    readonly zone: ZoneDef,
    readonly squad: CrewMember[],
    seed = randomSeed(),
  ) {
    this.rng = new Rng(seed);
    const st = GameState.data;
    this.intel = st.intel?.zone === zone.id ? INTEL[st.intel.kind] : undefined;
    this.riskNow = zone.risk + (this.intel?.riskAdd ?? 0);
    this.lootMul = this.intel?.lootMul ?? 1;
    for (const m of squad) this.crewHp.set(m.id, COMPANION_ROLES[m.role].maxHp);
  }

  /** 出發：扣時段、記錄今天去過 */
  static start(zone: ZoneDef, squad: CrewMember[]): Expedition {
    const st = GameState.data;
    st.dayTime = Math.max(0, st.dayTime - zone.time);
    st.exploredToday.push(zone.id);
    GameState.save();
    Expedition.current = new Expedition(zone, squad);
    return Expedition.current;
  }

  get finished(): boolean {
    return this.index >= this.zone.nodes;
  }

  get isFinale(): boolean {
    return this.index === this.zone.nodes - 1;
  }

  get aliveSquad(): CrewMember[] {
    return this.squad.filter((m) => (this.crewHp.get(m.id) ?? 0) > 0);
  }

  /** 抽下一站的事件；噪音滿了強制屍潮 */
  nextEvent(): ExploreEvent {
    if (this.noise >= NOISE.max) return HORDE_EVENT;
    const finale = this.isFinale;
    const pool = EVENTS.filter(
      (e) =>
        !!e.finale === finale &&
        !this.seen.has(e.id) &&
        (e.minRisk ?? 0) <= this.riskNow &&
        (!e.zones || e.zones.includes(this.zone.id)),
    );
    const ev = this.rng.weighted(pool.length ? pool : EVENTS.filter((e) => !!e.finale === finale), (e) => e.weight)!;
    this.seen.add(ev.id);
    return ev;
  }

  /** 這個選項現在能不能選；不能時回傳原因 */
  blocked(opt: { consume?: SupplyId; scrap?: number }): string | null {
    if (opt.consume && GameState.data.supplies[opt.consume] <= 0) return '沒有';
    if (opt.scrap && GameState.data.scrap < opt.scrap) return '廢料不足';
    return null;
  }

  /** 檢定成功率：有指定職業同行直接成功，否則看隊伍（含主角＝3 星）最高屬性 */
  checkChance(a: Extract<EventAction, { type: 'check' }>): number {
    const squad = this.aliveSquad;
    if (a.role && squad.some((m) => m.role === a.role)) return 1;
    const best = Math.max(3, ...squad.map((m) => m.attrs[a.attr]));
    return Math.min(0.95, a.base + best * a.perPoint);
  }

  /** QTE 的寬容度：隊伍最高膽識，3 星為 1 */
  qteEase(): number {
    const best = Math.max(3, ...this.aliveSquad.map((m) => m.attrs.nerve));
    return 1 + (best - 3) * 0.12;
  }

  /** 潛入時霧屍視野的倍率：隊伍平均腳程越高越難被發現 */
  stealthMul(): number {
    const sq = this.aliveSquad;
    const agi = sq.length ? sq.reduce((s, m) => s + m.attrs.agi, 0) / sq.length : 3;
    // 帶越多人越容易被發現
    return (1 - (agi - 3) * 0.08) * (1 + sq.length * 0.08);
  }

  /** 依風險與噪音算出這場戰鬥的霧屍數 */
  zombieCount(spec: FieldSpec): number {
    return spec.zombies + Math.max(0, this.riskNow - 2) + Math.floor(this.noise / NOISE.perExtraZombie);
  }

  addNoise(n: number): number {
    const add = Math.round(n * (this.intel?.noiseMul ?? 1));
    this.noise = Math.min(NOISE.max, Math.max(0, this.noise + add));
    return add;
  }

  /** 結算一個結果：入背包、扣血、加噪音 */
  apply(o: Outcome): Resolution {
    const res: Resolution = { text: o.text, gained: {}, hurt: 0, crewHurt: [], noise: 0 };
    if (o.scrapCost) GameState.data.scrap -= o.scrapCost;
    if (o.loot) mergeLoot(res.gained, this.rollLoot(o.loot));
    if (o.bonus) mergeLoot(res.gained, o.bonus);
    if (o.survivor) mergeLoot(res.gained, { survivors: [this.rollSurvivor()] });
    // 補給空投：大獎多一份
    if (this.isFinale && o.loot && this.intel?.bigBonus) mergeLoot(res.gained, this.rollLoot('medium'));
    if (this.isFinale && this.intel?.survivor && !res.gained.survivors?.length && o.loot) {
      mergeLoot(res.gained, { survivors: [this.rollSurvivor()] });
    }
    mergeLoot(this.bag, res.gained);
    if (o.hurt) {
      res.hurt = o.hurt;
      this.hp = Math.max(0, this.hp - o.hurt);
    }
    if (o.crewHurt) res.crewHurt = this.hurtCrew(o.crewHurt);
    if (o.noise) res.noise = this.addNoise(o.noise);
    return res;
  }

  /** 隨機一位還站著的隊員受傷 */
  hurtCrew(amount: number): Resolution['crewHurt'] {
    const alive = this.aliveSquad;
    if (alive.length === 0) {
      // 沒有隊員就主角扛
      this.hp = Math.max(0, this.hp - Math.round(amount * 0.6));
      return [];
    }
    const m = this.rng.pick(alive);
    const left = Math.max(0, (this.crewHp.get(m.id) ?? 0) - amount);
    this.crewHp.set(m.id, left);
    return [{ name: m.name, amount, downed: left <= 0 }];
  }

  /** 換成一份實際的戰利品 */
  rollLoot(tier: LootTier): Loot {
    const z = this.zone;
    const t = LOOT_TIERS[tier];
    const r = this.rng;
    const mul = this.lootMul;
    const loot: Loot = {};
    loot.scrap = Math.round(r.int(z.loot.scrap[0], z.loot.scrap[1]) * t.scrapMul * mul);
    const ammoTypes = Object.keys(z.loot.ammo) as AmmoType[];
    for (let i = 0; i < t.ammoRolls; i++) {
      const type = r.weighted(ammoTypes, (a) => z.loot.ammo[a] ?? 0);
      if (!type) continue;
      const n = Math.max(1, Math.round(AMMO[type].box * r.float(AMMO_ROLL[0], AMMO_ROLL[1]) * mul));
      loot.ammo ??= {};
      loot.ammo[type] = (loot.ammo[type] ?? 0) + n;
    }
    if (r.chance(t.supplyChance)) {
      const ids = Object.keys(z.loot.supplies) as SupplyId[];
      const s = r.weighted(ids, (id) => z.loot.supplies[id] ?? 0);
      if (s) loot.supplies = { [s]: 1 };
    }
    // 武器：只掉還沒擁有、而且快解鎖的
    if (r.chance(t.weaponChance * mul)) {
      const day = GameState.data.day;
      const pool = z.loot.weapons.filter((id) => {
        const def = getWeapon(id);
        return def && !GameState.owns(id) && !this.bag.weapons?.includes(id) && def.unlockDay <= day + 2;
      });
      if (pool.length) loot.weapons = [r.pick(pool)];
    }
    return loot;
  }

  rollSurvivor(): CompanionRole {
    const roles = Object.keys(this.zone.survivors) as CompanionRole[];
    return this.rng.weighted(roles, (k) => this.zone.survivors[k] ?? 0) ?? 'shooter';
  }

  /** 走到下一站 */
  advance(): void {
    this.index++;
  }

  /**
   * 平安回到據點：背包入帳、倒下的隊員休養。回傳入帳結果。
   */
  bank(): ReturnType<typeof GameState.addLoot> {
    const res = GameState.addLoot(this.bag);
    this.markInjuries();
    GameState.save();
    Expedition.current = null;
    return res;
  }

  /** 主角倒下：被隊員拖回去，背包全丟 */
  fail(): void {
    // 主角倒下時，同行隊員為了拖人回來全都掛彩
    for (const m of this.squad) this.crewHp.set(m.id, 0);
    this.markInjuries();
    GameState.save();
    Expedition.current = null;
  }

  private markInjuries(): void {
    for (const m of this.squad) {
      if ((this.crewHp.get(m.id) ?? 0) <= 0) {
        const real = GameState.data.crew.find((c) => c.id === m.id);
        if (real) real.injuredDays = EXPLORE_TIME.injuryDays;
      }
    }
  }
}

export function mergeLoot(into: Loot, add: Loot): Loot {
  if (add.scrap) into.scrap = (into.scrap ?? 0) + add.scrap;
  for (const [k, n] of Object.entries(add.ammo ?? {})) {
    into.ammo ??= {};
    into.ammo[k as AmmoType] = (into.ammo[k as AmmoType] ?? 0) + (n ?? 0);
  }
  for (const [k, n] of Object.entries(add.supplies ?? {})) {
    into.supplies ??= {};
    into.supplies[k as SupplyId] = (into.supplies[k as SupplyId] ?? 0) + (n ?? 0);
  }
  if (add.weapons?.length) into.weapons = [...(into.weapons ?? []), ...add.weapons];
  if (add.survivors?.length) into.survivors = [...(into.survivors ?? []), ...add.survivors];
  return into;
}

/** 戰利品轉成一行行說明 */
export function describeLoot(l: Loot): string[] {
  const out: string[] = [];
  if (l.scrap) out.push(`廢料 +${l.scrap}`);
  for (const [k, n] of Object.entries(l.ammo ?? {})) if (n) out.push(`${AMMO[k as AmmoType].name} +${n}`);
  for (const [k, n] of Object.entries(l.supplies ?? {})) if (n) out.push(`${supplyName(k as SupplyId)} +${n}`);
  for (const id of l.weapons ?? []) out.push(`武器：${getWeapon(id)?.name ?? id}`);
  for (const r of l.survivors ?? []) out.push(`倖存者（${COMPANION_ROLES[r].title}）`);
  return out;
}

function supplyName(id: SupplyId): string {
  return { medkit: '醫療包', grenade: '手榴彈', lockpick: '開鎖工具', decoy: '噪音誘餌' }[id];
}
