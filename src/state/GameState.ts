import { DEFAULT_CREW, randomCrewName, type CompanionRole, type CrewMember } from '../data/companions';
import { BARRICADE_LEVELS, ECONOMY, type BuildingKind } from '../data/buildings';
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
    crew: DEFAULT_CREW.map((c) => ({ ...c })),
  };
}

class GameStateStore {
  data: GameStateData = fresh();

  reset(): void {
    this.data = fresh();
  }

  /**
   * 招募一位倖存者加入隊伍（白天探索救出時呼叫）。回傳新隊員。
   */
  recruit(role: CompanionRole, name?: string): CrewMember {
    const crew = this.data.crew;
    const member: CrewMember = {
      id: `crew-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
      name: name ?? randomCrewName(crew.map((c) => c.name)),
      role,
    };
    crew.push(member);
    return member;
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
      if (!Array.isArray(parsed.crew)) parsed.crew = DEFAULT_CREW.map((c) => ({ ...c }));
      this.data = parsed;
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
