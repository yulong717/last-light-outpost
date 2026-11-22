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
  /** 主路障目前耐久（白天修理、夜裡被拆，跨夜保留） */
  barricadeHp: number;
  barricadeLevel: number;
  /** 各槽位上蓋的建築（槽位定義見 src/data/buildings.ts） */
  buildings: SavedBuilding[];
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
  };
}

class GameStateStore {
  data: GameStateData = fresh();

  reset(): void {
    this.data = fresh();
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
      this.data = parsed;
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
