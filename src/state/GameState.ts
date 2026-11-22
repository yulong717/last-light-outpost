import { DEFAULT_CREW, randomCrewName, type CompanionRole, type CrewMember } from '../data/companions';

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
}

const SAVE_KEY = 'llo-save';
const SAVE_VERSION = 1;

function fresh(): GameStateData {
  return {
    version: SAVE_VERSION,
    day: 1,
    baseHp: 100,
    baseMaxHp: 100,
    barricadeMaxHp: 300,
    ammoReserve: 999,
    scrap: 0,
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
      if (!Array.isArray(parsed.crew)) parsed.crew = DEFAULT_CREW.map((c) => ({ ...c }));
      this.data = parsed;
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
