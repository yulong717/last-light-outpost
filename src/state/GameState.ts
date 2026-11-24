import { MAX_DEPLOYED, crewReady, deployedCrew, makeCrewMember, upgradeCrewMember, type CompanionRole, type CrewMember } from '../data/companions';
import { randomSeed } from '../utils/rng';
import { BACKGROUND_BY_ID, canWield } from '../data/crewBody';
import { BARRICADE_LEVELS, BUILDINGS, ECONOMY, type BuildingKind } from '../data/buildings';
import { DAY_HOURS, getNode } from '../data/route';
import { EXPLORE_TIME, SUPPLIES, ZONES, INTEL, type IntelKind, type Loot, type SupplyId } from '../data/explore';
import { CHAPTERS, OPENINGS, START_SHOP, chaptersFor, startZones, type Chapter } from '../data/story';
import { getHero, type HeroId } from '../data/heroes';
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
  /** 輔助用品（醫療包、開鎖工具、誘餌） */
  supplies: Record<SupplyId, number>;
  /** 今天白天還剩幾個時段可以探索 */
  dayTime: number;
  /** 今天已經去過的區域（每區一天一次） */
  exploredToday: string[];
  /** 今天的情報：哪一區發生了什麼 */
  intel?: { zone: string; kind: IntelKind };
  /** 守城據點地圖（開新遊戲時選，見 src/data/scenery.ts 的 OUTPOST_MAPS） */
  outpostMap?: string;
  /** 主線進程（見 src/data/story.ts） */
  story: StoryProgress;
  /** 選的主角（見 src/data/heroes.ts）；舊存檔沒有就當作馬克 */
  hero: HeroId;
  /** 開局教學戰鬥打完或跳過了（見 src/data/tutorial.ts） */
  tutorialDone?: boolean;
  /** 路線圖：現在在哪、今天還剩幾小時、最後經過的據點（見 src/data/route.ts）；序章之前的舊存檔沒有 */
  route?: RouteState;
}

export interface RouteState {
  node: string;
  hours: number;
  /** 今天最後經過（或睡過）的據點：時間用完就只能退回這裡防守 */
  lastOutpost?: string;
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

function freshStory(hero: HeroId): StoryProgress {
  return { chapter: 0, zones: startZones(hero), shop: [...START_SHOP], introSeen: 0 };
}

/** 舊存檔（主線之前）：當作主線已完成，全部開放，不打斷原本的進度 */
function finishedStory(): StoryProgress {
  return {
    chapter: CHAPTERS.length + 1,
    zones: ZONES.map((z) => z.id),
    shop: [...START_SHOP, ...Object.values(OPENINGS).flatMap((c) => c.shop), ...CHAPTERS.flatMap((c) => c.shop)],
    introSeen: CHAPTERS.length + 3,
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
  /** 起始手槍不是無限備彈（阿凱） */
  finitePistol?: boolean;
}

function freshArmory(hero?: HeroId): ArmoryData {
  const ammo = Object.fromEntries(Object.values(AMMO).map((a) => [a.id, a.start])) as Record<AmmoType, number>;
  if (!hero) {
    return { owned: [...START_LOADOUT.guns, START_LOADOUT.melee], loadout: [...START_LOADOUT.guns], melee: START_LOADOUT.melee, ammo };
  }
  const h = getHero(hero);
  for (const [t, n] of Object.entries(h.ammo) as [AmmoType, number][]) ammo[t] = n;
  return {
    owned: [...h.guns, h.melee],
    loadout: [...h.guns],
    melee: h.melee,
    ammo,
    ...(h.infinitePistol ? {} : { finitePistol: true }),
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

function fresh(hero: HeroId = 'soldier'): GameStateData {
  const story = freshStory(hero);
  const supplies = freshSupplies();
  for (const [k, n] of Object.entries(getHero(hero).supplies) as [SupplyId, number][]) supplies[k] = n;
  return {
    version: SAVE_VERSION,
    hero,
    day: 1,
    baseHp: 100,
    baseMaxHp: 100,
    barricadeMaxHp: BARRICADE_LEVELS[0].maxHp,
    armory: freshArmory(hero),
    scrap: ECONOMY.startScrap,
    barricadeHp: BARRICADE_LEVELS[0].maxHp,
    barricadeLevel: 1,
    buildings: [],
    // 開局只有主角一人：夥伴要靠主線與探索救回來
    crew: [],
    supplies,
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

  /** 新遊戲（選角畫面選完呼叫） */
  reset(hero: HeroId = 'soldier'): void {
    this.data = fresh(hero);
  }

  get hero() {
    return getHero(this.data.hero);
  }

  /** 這位主角的完整主線 */
  get chapters(): Chapter[] {
    return chaptersFor(this.data.hero);
  }

  /**
   * 招募一位倖存者加入隊伍（白天探索救出時呼叫）。回傳新隊員。
   */
  // ── 主線 ──────────────────────────────────────────

  /** 目前進行中的章節（主線完成後為 undefined） */
  get chapter(): Chapter | undefined {
    return this.chapters[this.data.story.chapter];
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
    // 出戰名額滿了：新人先待命，到名冊裡再換上場
    if (deployedCrew(crew).length >= MAX_DEPLOYED) member.standby = true;
    crew.push(member);
    // 有些倖存者帶著自己的武器加入（出身決定是什麼）；已經有同型號就不重複
    const kit = BACKGROUND_BY_ID[member.background]?.kit;
    if (kit && seed % 2 === 0 && !this.owns(kit) && getWeapon(kit)) {
      this.data.armory.owned.push(kit);
      member.weaponId = kit;
    }
    return member;
  }

  // ── 白天探索 ──────────────────────────────────────

  /** 新的一天：時段補滿、換情報、負傷隊員休養一天 */
  startNewDay(): void {
    const d = this.data;
    d.dayTime = EXPLORE_TIME.slotsPerDay;
    if (d.route) d.route.hours = DAY_HOURS;
    d.exploredToday = [];
    d.intel = rollIntel(d.day, d.story.zones);
    for (const c of d.crew) if (c.injuredDays) c.injuredDays = Math.max(0, c.injuredDays - 1);
    this.normalizeDeploy();
  }

  // ── 路線圖 ──────────────────────────────────────

  /** 沿路線走到相鄰的地點，扣掉路程時數；據點會記成「最後經過的據點」 */
  travel(to: string, hours: number): void {
    const r = this.data.route;
    if (!r) return;
    r.node = to;
    r.hours = Math.max(0, r.hours - hours);
    if (getNode(to)?.kind === 'outpost') r.lastOutpost = to;
  }

  /**
   * 在這個據點過夜。換了據點的話，舊據點的建築拆掉、退回一半的廢料，路障重新架（不帶走升級）。
   * 回傳退回的廢料（沒換據點是 0）。
   */
  settleAt(nodeId: string): number {
    const d = this.data;
    const node = getNode(nodeId);
    if (!node?.map) return 0;
    if (d.route) {
      d.route.node = nodeId;
      d.route.lastOutpost = nodeId;
    }
    if (d.outpostMap === node.map) return 0;
    let refund = 0;
    for (const b of d.buildings) refund += BUILDINGS[b.kind].cost * (1 + (b.level * (b.level - 1)) / 2);
    refund = Math.floor(refund / 2);
    d.scrap += refund;
    d.buildings = [];
    d.barricadeLevel = 1;
    d.barricadeMaxHp = BARRICADE_LEVELS[0].maxHp;
    d.barricadeHp = d.barricadeMaxHp;
    d.baseHp = d.baseMaxHp;
    d.outpostMap = node.map;
    return refund;
  }

  // ── 出戰名單 ──────────────────────────────────────

  /** 沒設待命的人超過名額時（養好傷、舊存檔），多出來的改成待命，名冊顯示和實際上場一致 */
  normalizeDeploy(): void {
    let n = 0;
    for (const c of this.data.crew) {
      if (!crewReady(c) || c.standby) continue;
      if (++n > MAX_DEPLOYED) c.standby = true;
    }
  }

  /** 名冊切換出戰／待命 */
  setDeployed(crewId: string, on: boolean): { ok: boolean; reason?: string } {
    const m = this.data.crew.find((c) => c.id === crewId);
    if (!m) return { ok: false, reason: '找不到隊員' };
    if (!on) {
      m.standby = true;
      return { ok: true };
    }
    if (!crewReady(m)) return { ok: false, reason: `${m.name} 還在養傷` };
    if (deployedCrew(this.data.crew).length >= MAX_DEPLOYED) return { ok: false, reason: `出戰最多 ${MAX_DEPLOYED} 人，先讓一位待命` };
    m.standby = false;
    // 排到已出戰的人後面，確保在名額內
    this.data.crew = [...this.data.crew.filter((c) => c !== m), m];
    this.normalizeDeploy();
    return { ok: true };
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
      if (!SUPPLIES[s]) continue; // 已移除的用品（舊存檔背包裡的手榴彈）
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

  /** 槍帶上／卸下（至少留一把）。已經配給隊員的槍不能直接拿走，要先到名冊收回 */
  toggleLoadout(id: string): void {
    const a = this.data.armory;
    if (!getFirearm(id) || !this.owns(id)) return;
    if (a.loadout.includes(id)) {
      if (a.loadout.length > 1) a.loadout = a.loadout.filter((g) => g !== id);
    } else if (a.loadout.length < MAX_GUNS && !this.crewHolder(id)) {
      a.loadout.push(id);
    }
  }

  equipMelee(id: string): void {
    if (getMelee(id) && this.owns(id) && !this.crewHolder(id)) this.data.armory.melee = id;
  }

  /** 拿著這把武器的隊員（主角或沒人拿就是 undefined） */
  crewHolder(id: string): CrewMember | undefined {
    return this.data.crew.find((c) => c.weaponId === id);
  }

  // ── 隊員配槍：一把武器同時只在一個人手上 ──────────────

  /** 誰拿著這把武器（主角回傳 'player'） */
  weaponHolder(id: string): 'player' | CrewMember | null {
    const a = this.data.armory;
    if (a.loadout.includes(id) || a.melee === id) return 'player';
    return this.data.crew.find((c) => c.weaponId === id) ?? null;
  }


  /**
   * 把武器配給隊員（null = 收回，改用隨身手槍）。
   * 主角身上的會從主角那裡拿走（主角至少要留一把槍、一把近戰）；別的隊員手上的會換手。
   */
  assignWeapon(crewId: string, id: string | null): { ok: boolean; reason?: string } {
    const m = this.data.crew.find((c) => c.id === crewId);
    if (!m) return { ok: false, reason: '找不到隊員' };
    if (id === null) {
      delete m.weaponId;
      return { ok: true };
    }
    if (!this.owns(id)) return { ok: false, reason: '還沒有這把武器' };
    const can = canWield(m, id);
    if (!can.ok) return can;
    // 一把武器同時只在一個人手上：別人拿著的不能直接搶過來
    const holder = this.weaponHolder(id);
    if (holder === 'player') return { ok: false, reason: '主角正帶著這把，先到軍械庫卸下' };
    if (holder && holder !== m) return { ok: false, reason: `已經配給 ${holder.name}，先收回` };
    m.weaponId = id;
    return { ok: true };
  }

  /** 這位隊員能拿的武器：擁有、會用、而且沒在別人（主角或其他隊員）手上 */
  wieldableFor(crewId: string): string[] {
    const m = this.data.crew.find((c) => c.id === crewId);
    if (!m) return [];
    return this.data.armory.owned.filter((id) => {
      const holder = this.weaponHolder(id);
      return canWield(m, id).ok && (holder === null || holder === m);
    });
  }

  /** 夥伴永久陣亡：從隊伍移除（手上的武器由大家撿回軍械庫） */
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
        parsed.armory = freshArmory('soldier');
        parsed.version = SAVE_VERSION;
      }
      if (parsed.version !== SAVE_VERSION) return false;
      if (!parsed.armory) parsed.armory = freshArmory('soldier');
      parsed.hero ??= 'soldier';
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
      // 手榴彈已移除：舊存檔裡的數量直接丟掉
      for (const k of Object.keys(parsed.supplies)) if (!(k in SUPPLIES)) delete (parsed.supplies as Record<string, number>)[k];
      parsed.dayTime ??= EXPLORE_TIME.slotsPerDay;
      parsed.exploredToday ??= [];
      this.data = parsed;
      this.normalizeDeploy();
      return true;
    } catch {
      return false;
    }
  }
}

export const GameState = new GameStateStore();
