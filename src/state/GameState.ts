import { defaultCrew, makeCrewMember, upgradeCrewMember, type CompanionRole, type CrewMember } from '../data/companions';
import { randomSeed } from '../utils/rng';
import { BARRICADE_LEVELS, ECONOMY, type BuildingKind } from '../data/buildings';
import { EXPLORE_TIME, SUPPLIES, ZONES, INTEL, type IntelKind, type Loot, type SupplyId } from '../data/explore';
import { AMMO, MAX_GUNS, START_LOADOUT, getFirearm, getMelee, getWeapon, type AmmoType } from '../data/weapons';

/**
 * 跨場景的遊戲進度。之後白天探索、據點升級、存檔都會讀寫這裡。
 */
export interface GameStateData {
  version: number;
  day: number;
  baseHp: number;
  baseMaxHp: number;
  barricadeMaxHp: number;
  /** 軍械庫：擁有的武器、帶上場的配置、各口徑備彈 */
  armory: ArmoryData;
  scrap: number;
  /** 隊伍裡的 NPC 夥伴（陣亡會從這裡移除） */
  crew: CrewMember[];
  /** 主路障目前耐久（白天修理、夜裡被拆，跨夜保留） */
  barricadeHp: number;
  barricadeLevel: number;
  /** 各槽位上蓋的建築（槽位定義見 src/data/buildings.ts） */
  buildings: SavedBuilding[];
  /** 已經見過的霧屍職業（第一次遇到時畫面會介紹） */
  seenZombies?: string[];
  /** 輔助用品（醫療包、手榴彈、開鎖工具、誘餌） */
  supplies: Record<SupplyId, number>;
  /** 今天白天還剩幾個時段可以探索 */
  dayTime: number;
  /** 今天已經去過的區域（每區一天一次） */
  exploredToday: string[];
  /** 今天的情報：哪一區發生了什麼 */
  intel?: { zone: string; kind: IntelKind };
}

export interface ArmoryData {
  /** 擁有的武器 id（槍與近戰） */
  owned: string[];
  /** 帶上場的槍（最多 MAX_GUNS 把，依 1/2/3 鍵順序） */
  loadout: string[];
  /** 帶上場的近戰武器 */
  melee: string;
  /** 各口徑備彈（彈匣裡的不算） */
  ammo: Record<AmmoType, number>;
}

function freshArmory(): ArmoryData {
  return {
    owned: [...START_LOADOUT.guns, START_LOADOUT.melee],
    loadout: [...START_LOADOUT.guns],
    melee: START_LOADOUT.melee,
    ammo: Object.fromEntries(Object.values(AMMO).map((a) => [a.id, a.start])) as Record<AmmoType, number>,
  };
}

export interface SavedBuilding {
  slot: string;
  kind: BuildingKind;
  level: number;
  hp: number;
}

const SAVE_KEY = 'llo-save';
const SAVE_VERSION = 3;

function fresh(): GameStateData {
  return {
    version: SAVE_VERSION,
    day: 1,
    baseHp: 100,
    baseMaxHp: 100,
    barricadeMaxHp: BARRICADE_LEVELS[0].maxHp,
    armory: freshArmory(),
    scrap: ECONOMY.startScrap,
    barricadeHp: BARRICADE_LEVELS[0].maxHp,
    barricadeLevel: 1,
    buildings: [],
    crew: defaultCrew(),
    supplies: freshSupplies(),
    dayTime: EXPLORE_TIME.slotsPerDay,
    exploredToday: [],
    intel: rollIntel(1),
  };
}

function freshSupplies(): Record<SupplyId, number> {
  return Object.fromEntries(Object.values(SUPPLIES).map((s) => [s.id, s.start])) as Record<SupplyId, number>;
}

/** 每天隨機挑一個已解鎖的區域發生特殊狀況 */
function rollIntel(day: number): GameStateData['intel'] {
  const zones = ZONES.filter((z) => z.unlockDay <= day);
  const kinds = Object.keys(INTEL) as IntelKind[];
  if (zones.length === 0) return undefined;
  return { zone: zones[Math.floor(Math.random() * zones.length)].id, kind: kinds[Math.floor(Math.random() * kinds.length)] };
}

class GameStateStore {
  data: GameStateData = fresh();

  reset(): void {
    this.data = fresh();
  }

  /**
   * 招募一位倖存者加入隊伍（白天探索救出時呼叫）。回傳新隊員。
   */
  recruit(role: CompanionRole, name?: string, seed = randomSeed()): CrewMember {
    const crew = this.data.crew;
    const id = `crew-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    // 長相、屬性、特質都由種子隨機產生
    const member = makeCrewMember(id, role, seed, crew.map((c) => c.name), name);
    crew.push(member);
    return member;
  }

  // ── 白天探索 ──────────────────────────────────────

  /** 新的一天：時段補滿、換情報、負傷隊員休養一天 */
  startNewDay(): void {
    const d = this.data;
    d.dayTime = EXPLORE_TIME.slotsPerDay;
    d.exploredToday = [];
    d.intel = rollIntel(d.day);
    for (const c of d.crew) if (c.injuredDays) c.injuredDays = Math.max(0, c.injuredDays - 1);
  }

  /** 把一份戰利品收進據點：彈藥、用品有上限，武器重複就換成廢料，倖存者加入隊伍 */
  addLoot(loot: Loot): { recruits: CrewMember[]; overflowScrap: number } {
    const d = this.data;
    let overflowScrap = 0;
    d.scrap += loot.scrap ?? 0;
    for (const [t, n] of Object.entries(loot.ammo ?? {}) as [AmmoType, number][]) {
      const room = AMMO[t].max - d.armory.ammo[t];
      const got = Math.min(room, n);
      d.armory.ammo[t] += got;
      // 囤滿的彈藥依盒價換成廢料
      overflowScrap += Math.floor(((n - got) / AMMO[t].box) * AMMO[t].price);
    }
    for (const [s, n] of Object.entries(loot.supplies ?? {}) as [SupplyId, number][]) {
      const got = Math.min(SUPPLIES[s].max - d.supplies[s], n);
      d.supplies[s] += got;
      overflowScrap += (n - got) * 8;
    }
    for (const id of loot.weapons ?? []) {
      const def = getWeapon(id);
      if (!def) continue;
      if (this.owns(id)) {
        overflowScrap += Math.round(def.price * 0.3);
        continue;
      }
      d.armory.owned.push(id);
      if (def.kind === 'firearm' && d.armory.loadout.length < MAX_GUNS) d.armory.loadout.push(id);
    }
    d.scrap += overflowScrap;
    const recruits = (loot.survivors ?? []).map((r) => this.recruit(r));
    return { recruits, overflowScrap };
  }

  useSupply(id: SupplyId): boolean {
    if (this.data.supplies[id] <= 0) return false;
    this.data.supplies[id]--;
    return true;
  }

  // ── 軍械庫 ──────────────────────────────────────────

  owns(id: string): boolean {
    return this.data.armory.owned.includes(id);
  }

  /** 買武器；買到槍且配置還有空位就自動帶上。回傳是否成功 */
  buyWeapon(id: string): boolean {
    const def = getWeapon(id);
    const a = this.data.armory;
    if (!def || this.owns(id) || this.data.scrap < def.price || def.unlockDay > this.data.day) return false;
    this.data.scrap -= def.price;
    a.owned.push(id);
    if (def.kind === 'firearm' && a.loadout.length < MAX_GUNS) a.loadout.push(id);
    return true;
  }

  /** 買一盒彈藥；回傳實際買到幾發（滿了就 0） */
  buyAmmo(type: AmmoType): number {
    const def = AMMO[type];
    const a = this.data.armory;
    const room = def.max - a.ammo[type];
    if (room <= 0 || this.data.scrap < def.price) return 0;
    const n = Math.min(def.box, room);
    this.data.scrap -= def.price;
    a.ammo[type] += n;
    return n;
  }

  /** 槍帶上／卸下（至少留一把） */
  toggleLoadout(id: string): void {
    const a = this.data.armory;
    if (!getFirearm(id) || !this.owns(id)) return;
    if (a.loadout.includes(id)) {
      if (a.loadout.length > 1) a.loadout = a.loadout.filter((g) => g !== id);
    } else if (a.loadout.length < MAX_GUNS) a.loadout.push(id);
  }

  equipMelee(id: string): void {
    if (getMelee(id) && this.owns(id)) this.data.armory.melee = id;
  }

  /** 夥伴永久陣亡：從隊伍移除 */
  removeCrew(id: string): void {
    this.data.crew = this.data.crew.filter((c) => c.id !== id);
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // 隱私模式等情況寫不進去，忽略即可
    }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as GameStateData & { ammoReserve?: number };
      // v2 → v3：舊存檔沒有軍械庫，補上起始配置
      if (parsed.version === 2) {
        delete parsed.ammoReserve;
        parsed.armory = freshArmory();
        parsed.version = SAVE_VERSION;
      }
      if (parsed.version !== SAVE_VERSION) return false;
      if (!parsed.armory) parsed.armory = freshArmory();
      // 之後新增的彈種：補 0
      for (const t of Object.keys(AMMO) as AmmoType[]) parsed.armory.ammo[t] ??= 0;
      // 舊存檔沒有隊伍欄位：補上預設小隊
      if (!Array.isArray(parsed.crew)) parsed.crew = defaultCrew();
      // 舊隊員沒有外觀與能力：用 id 固定種子補上
      parsed.crew = parsed.crew.map((c) => upgradeCrewMember(c));
      // 探索模式之前的存檔：補上用品、時段
      parsed.supplies ??= freshSupplies();
      for (const s of Object.keys(SUPPLIES) as SupplyId[]) parsed.supplies[s] ??= 0;
      parsed.dayTime ??= EXPLORE_TIME.slotsPerDay;
      parsed.exploredToday ??= [];
      this.data = parsed;
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
