import { defaultCrew, makeCrewMember, upgradeCrewMember, type CompanionRole, type CrewMember } from '../data/companions';
import { randomSeed } from '../utils/rng';
import { BARRICADE_LEVELS, ECONOMY, type BuildingKind } from '../data/buildings';

/**
 * 跨場景的遊戲進度。之後白天探索、據點升級、存檔都會讀寫這裡。
 */
export interface GameStateData {
  version: number;
  day: number;
  baseHp: number;
  baseMaxHp: number;
  barricadeMaxHp: number;
  ammoReserve: number;
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
}

export interface SavedBuilding {
  slot: string;
  kind: BuildingKind;
  level: number;
  hp: number;
}

const SAVE_KEY = 'llo-save';
const SAVE_VERSION = 2;

function fresh(): GameStateData {
  return {
    version: SAVE_VERSION,
    day: 1,
    baseHp: 100,
    baseMaxHp: 100,
    barricadeMaxHp: BARRICADE_LEVELS[0].maxHp,
    ammoReserve: 999,
    scrap: ECONOMY.startScrap,
    barricadeHp: BARRICADE_LEVELS[0].maxHp,
    barricadeLevel: 1,
    buildings: [],
    crew: defaultCrew(),
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
  recruit(role: CompanionRole, name?: string, seed = randomSeed()): CrewMember {
    const crew = this.data.crew;
    const id = `crew-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    // 長相、屬性、特質都由種子隨機產生
    const member = makeCrewMember(id, role, seed, crew.map((c) => c.name), name);
    crew.push(member);
    return member;
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
      const parsed = JSON.parse(raw) as GameStateData;
      if (parsed.version !== SAVE_VERSION) return false;
      // 舊存檔沒有隊伍欄位：補上預設小隊
      if (!Array.isArray(parsed.crew)) parsed.crew = defaultCrew();
      // 舊隊員沒有外觀與能力：用 id 固定種子補上
      parsed.crew = parsed.crew.map((c) => upgradeCrewMember(c));
      this.data = parsed;
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
