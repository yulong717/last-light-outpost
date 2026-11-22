import { makeCrewMember, upgradeCrewMember, type CompanionRole, type CrewMember } from '../data/companions';
import { randomSeed } from '../utils/rng';
import { BARRICADE_LEVELS, ECONOMY, type BuildingKind } from '../data/buildings';
import { EXPLORE_TIME, SUPPLIES, ZONES, INTEL, type IntelKind, type Loot, type SupplyId } from '../data/explore';
import { CHAPTERS, START_SHOP, START_ZONES, type Chapter } from '../data/story';
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
  /** 主線進程（見 src/data/story.ts） */
  story: StoryProgress;
}

export interface StoryProgress {
  /** 目前在第幾章（0 起算）；等於 CHAPTERS.length 代表主線完成 */
  chapter: number;
  /** 已開放的探索區域 */
  zones: string[];
  /** 軍械庫有進貨、可以用廢料買的武器 */
  shop: string[];
  /** 劇情開場播到哪：0 = 序章還沒看，1 = 看完序章，k + 2 = 第 k 章（0 起算）的開場看過了 */
  introSeen: number;
}

function freshStory(): StoryProgress {
  return { chapter: 0, zones: [...START_ZONES], shop: [...START_SHOP], introSeen: 0 };
}

/** 舊存檔（主線之前）：當作主線已完成，全部開放，不打斷原本的進度 */
function finishedStory(): StoryProgress {
  return {
    chapter: CHAPTERS.length,
    zones: ZONES.map((z) => z.id),
    shop: CHAPTERS.flatMap((c) => c.shop),
    introSeen: CHAPTERS.length + 2,
  };
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
  const story = freshStory();
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
    // 開局只有主角一人：夥伴要靠主線與探索救回來
    crew: [],
    supplies: freshSupplies(),
    dayTime: EXPLORE_TIME.slotsPerDay,
    exploredToday: [],
    intel: rollIntel(1, story.zones),
    story,
  };
}

function freshSupplies(): Record<SupplyId, number> {
  return Object.fromEntries(Object.values(SUPPLIES).map((s) => [s.id, s.start])) as Record<SupplyId, number>;
}

/** 每天隨機挑一個已解鎖的區域發生特殊狀況 */
function rollIntel(day: number, open: string[]): GameStateData['intel'] {
  const zones = ZONES.filter((z) => z.unlockDay <= day && open.includes(z.id));
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
  // ── 主線 ──────────────────────────────────────────

  /** 目前進行中的章節（主線完成後為 undefined） */
  get chapter(): Chapter | undefined {
    return CHAPTERS[this.data.story.chapter];
  }

  /** 這章今天能不能觸發（天數到了沒） */
  chapterReady(): boolean {
    const c = this.chapter;
    return !!c && this.data.day >= c.minDay;
  }

  /** 這一區現在是不是主線劇情的地點 */
  isStoryZone(zoneId: string): boolean {
    return this.chapterReady() && this.chapter!.zone === zoneId;
  }

  zoneOpen(zoneId: string): boolean {
    return this.data.story.zones.includes(zoneId);
  }

  /** 軍械庫有沒有進這把武器（主角已擁有的也算） */
  inShop(weaponId: string): boolean {
    return this.data.story.shop.includes(weaponId) || this.owns(weaponId);
  }

  /** 完成目前這一章：開放區域、軍械庫進貨。回傳完成的章節 */
  completeChapter(): Chapter | undefined {
    const c = this.chapter;
    if (!c) return undefined;
    const st = this.data.story;
    for (const z of c.openZones) if (!st.zones.includes(z)) st.zones.push(z);
    for (const w of c.shop) if (!st.shop.includes(w)) st.shop.push(w);
    st.chapter++;
    return c;
  }

  /** 還沒播過的開場：序章 → 目前章節（天數到了才播） */
  pendingIntro(): 'prologue' | Chapter | null {
    const st = this.data.story;
    if (st.introSeen === 0) return 'prologue';
    if (st.introSeen <= st.chapter + 1 && this.chapterReady()) return this.chapter!;
    return null;
  }

  markIntroSeen(): void {
    const st = this.data.story;
    st.introSeen = st.introSeen === 0 ? 1 : st.chapter + 2;
  }

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
    d.intel = rollIntel(d.day, d.story.zones);
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
    const recruits = [
      ...(loot.named ?? []).map((n) => this.recruit(n.role, n.name)),
      ...(loot.survivors ?? []).map((r) => this.recruit(r)),
    ];
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
    if (!def || this.owns(id) || this.data.scrap < def.price || !this.inShop(id)) return false;
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
      if (!Array.isArray(parsed.crew)) parsed.crew = [];
      // 主線之前的存檔：當作主線已完成
      parsed.story ??= finishedStory();
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
