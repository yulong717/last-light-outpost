import type { CompanionRole } from './companions';
import type { AttrKey } from './crewTraits';
import type { AmmoType } from './weapons';

/**
 * 白天探索的所有數值與內容：區域、隨機事件、掉落表、輔助用品。
 * 玩法流程見 docs/EXPLORATION.md；邏輯在 src/explore/，畫面在 src/scenes/Explore*.ts。
 */

// ── 時間 ───────────────────────────────────────────────

export const EXPLORE_TIME = {
  /** 每天白天的時段數 */
  slotsPerDay: 3,
  /** 沒用完的時段入夜時換成：免費修路障（佔上限的比例）＋廢料 */
  idleRepairRatio: 0.15,
  idleScrap: 4,
  /** 一趟最多帶幾名隊員 */
  maxSquad: 2,
  /** 隊員在探索中倒下：休養幾天（不能出戰、不能探索） */
  injuryDays: 1,
};

// ── 輔助用品 ───────────────────────────────────────────

export type SupplyId = 'medkit' | 'lockpick' | 'decoy';

export interface SupplyDef {
  id: SupplyId;
  name: string;
  desc: string;
  max: number;
  /** 新遊戲送的數量 */
  start: number;
}

export const SUPPLIES: Record<SupplyId, SupplyDef> = {
  medkit: { id: 'medkit', name: '醫療包', desc: '回復 45 生命（探索中或夜裡 H 鍵）', max: 5, start: 1 },
  lockpick: { id: 'lockpick', name: '開鎖工具', desc: '直接打開上鎖的櫃子和門，或在開鎖小遊戲裡讓這次變簡單', max: 3, start: 0 },
  decoy: { id: 'decoy', name: '噪音誘餌', desc: '引開屍群：跳過一場戰鬥，或讓噪音歸零', max: 3, start: 0 },
};

export const MEDKIT_HEAL = 45;

/** 軍械庫商店的物資價格（廢料）。商店只賣彈藥和物資，武器要自己去撿 */
export const SUPPLY_PRICE: Record<SupplyId, number> = { medkit: 25, lockpick: 15, decoy: 12 };

// ── 掉落 ───────────────────────────────────────────────

/** 一份戰利品（探索背包、事件獎勵都用這個） */
export interface Loot {
  scrap?: number;
  ammo?: Partial<Record<AmmoType, number>>;
  supplies?: Partial<Record<SupplyId, number>>;
  /** 武器 id（還沒擁有的才會掉） */
  weapons?: string[];
  /** 救到的倖存者職業 */
  survivors?: CompanionRole[];
  /** 劇情救到的具名倖存者 */
  named?: { role: CompanionRole; name: string }[];
}

export type LootTier = 'small' | 'medium' | 'big';

export interface LootTable {
  scrap: [number, number];
  ammo: Partial<Record<AmmoType, number>>;
  supplies: Partial<Record<SupplyId, number>>;
}

/** 各級戰利品：掉幾份彈藥、幾件用品、武器與倖存者機率 */
export const LOOT_TIERS: Record<LootTier, { scrapMul: number; ammoRolls: number; supplyChance: number; weaponChance: number }> = {
  small: { scrapMul: 0.5, ammoRolls: 1, supplyChance: 0.2, weaponChance: 0 },
  medium: { scrapMul: 1, ammoRolls: 2, supplyChance: 0.45, weaponChance: 0.12 },
  big: { scrapMul: 1.8, ammoRolls: 3, supplyChance: 0.9, weaponChance: 0.6 },
};

/** 一份彈藥是一盒的幾成（隨機） */
export const AMMO_ROLL: [number, number] = [0.5, 1.2];

// ── 區域 ───────────────────────────────────────────────

export interface ZoneDef {
  id: string;
  name: string;
  blurb: string;
  /** 1 近、2 遠：要花的時段數 */
  time: 1 | 2;
  /** 風險 1～5：影響事件難度、霧屍數量與種類 */
  risk: number;
  unlockDay: number;
  /** 路線上有幾個地點（最後一個是大獎） */
  nodes: number;
  /** 地圖上的位置（640×360 邏輯座標） */
  mapX: number;
  mapY: number;
  color: number;
  /** 戰鬥／潛入時出現的敵人（職業或動物 id，權重）；還沒解鎖的不會出現，動物只出現在戰鬥 */
  zombies: Record<string, number>;
  loot: LootTable;
  /** 這區救到的倖存者職業權重 */
  survivors: Partial<Record<CompanionRole, number>>;
  /** 地圖說明用的掉落標籤 */
  tags: string[];
  /** 戰鬥場景的配色 */
  floor: number;
  wall: number;
}

export const ZONES: ZoneDef[] = [
  // ── 主角的開局地點（只有選到那位主角時才會開放，見 src/data/heroes.ts） ──
  {
    id: 'school',
    name: '市立高中',
    blurb: '阿凱的學校。走廊上的置物櫃東倒西歪，體育館裡還困著穿制服的霧屍。',
    time: 1,
    risk: 1,
    unlockDay: 1,
    nodes: 3,
    mapX: 50,
    mapY: 160,
    color: 0x5a8ae0,
    zombies: { basic: 7, runner: 3 },
    loot: { scrap: [10, 18], ammo: { '9mm': 3 }, supplies: { medkit: 2, decoy: 1 } },
    survivors: { medic: 1, engineer: 1 },
    tags: ['醫療包', '廢料', '9mm'],
    floor: 0x2e3236,
    wall: 0x4a5058,
  },
  {
    id: 'downtown',
    name: '鬧區爆發點',
    blurb: '霧最早湧出來的十字路口。翻覆的警車、燒毀的公車，還有成群的上班族霧屍。',
    time: 1,
    risk: 2,
    unlockDay: 1,
    nodes: 3,
    mapX: 330,
    mapY: 265,
    color: 0x7a8a4a,
    zombies: { basic: 8, runner: 3, police: 1 },
    loot: { scrap: [14, 22], ammo: { '556': 2, '9mm': 3 }, supplies: { medkit: 1 } },
    survivors: { shooter: 2, medic: 1 },
    tags: ['5.56', '9mm'],
    floor: 0x2c2a2a,
    wall: 0x463c38,
  },
  {
    id: 'nightmarket',
    name: '夜市彩券行',
    blurb: '好運姐的彩券行就在夜市口。攤車翻倒一地，霓虹燈還在閃。',
    time: 1,
    risk: 1,
    unlockDay: 1,
    nodes: 3,
    mapX: 300,
    mapY: 95,
    color: 0xd05a8a,
    zombies: { basic: 8, runner: 2 },
    loot: { scrap: [16, 24], ammo: { '357': 2, '9mm': 2 }, supplies: { lockpick: 2, medkit: 1, decoy: 1 } },
    survivors: { engineer: 1, medic: 1 },
    tags: ['廢料', '開鎖工具', '.357'],
    floor: 0x2e2830,
    wall: 0x4a3a48,
  },
  {
    id: 'gas',
    name: '廢棄加油站',
    blurb: '公路邊的加油站，貨架早被翻過，但修車間可能還有東西。',
    time: 1,
    risk: 1,
    unlockDay: 1,
    nodes: 3,
    mapX: 120,
    mapY: 250,
    color: 0xe0a040,
    zombies: { basic: 6, worker: 3, runner: 1, dog: 1.5 },
    loot: { scrap: [14, 22], ammo: { '9mm': 4, '12ga': 2 }, supplies: { decoy: 2, lockpick: 1 } },
    survivors: { engineer: 3, shooter: 1 },
    tags: ['廢料', '9mm', '誘餌'],
    floor: 0x34302a,
    wall: 0x4a4236,
  },
  {
    id: 'market',
    name: '社區超市',
    blurb: '收銀台後面還有倉庫，屍群常在這裡遊蕩。',
    time: 1,
    risk: 2,
    unlockDay: 1,
    nodes: 3,
    mapX: 250,
    mapY: 190,
    color: 0x7ac060,
    zombies: { basic: 6, runner: 2, worker: 1, crow: 1 },
    loot: { scrap: [16, 26], ammo: { '9mm': 3, '12ga': 3, '357': 1, bolt: 2 }, supplies: { medkit: 3, decoy: 1 } },
    survivors: { medic: 1, engineer: 1, shooter: 1 },
    tags: ['醫療包', '霰彈', '十字弓箭'],
    floor: 0x2c3330,
    wall: 0x3c4840,
  },
  {
    id: 'homes',
    name: '住宅區',
    blurb: '一排排的透天厝，偶爾能聽見有人在敲窗。',
    time: 1,
    risk: 2,
    unlockDay: 1,
    nodes: 3,
    mapX: 180,
    mapY: 110,
    color: 0x80a0e0,
    zombies: { basic: 7, runner: 2, nurse: 1, dog: 1.5, crow: 1 },
    loot: { scrap: [12, 20], ammo: { '9mm': 2, '357': 2, '12ga': 2 }, supplies: { medkit: 2, lockpick: 2 } },
    survivors: { shooter: 2, medic: 2, engineer: 2 },
    tags: ['倖存者', '.357'],
    floor: 0x2e2c34,
    wall: 0x403c4a,
  },
  {
    id: 'hospital',
    name: '市立醫院',
    blurb: '藥品庫存豐富，但走廊上擠滿了穿病人服的霧屍。',
    time: 2,
    risk: 3,
    unlockDay: 2,
    nodes: 4,
    mapX: 400,
    mapY: 120,
    color: 0xe06a6a,
    zombies: { basic: 4, nurse: 3, runner: 2, brute: 1, dog: 1 },
    loot: { scrap: [20, 32], ammo: { '9mm': 3, '556': 1 }, supplies: { medkit: 5 } },
    survivors: { medic: 4, shooter: 1 },
    tags: ['大量醫療包', '醫護', '9mm'],
    floor: 0x2a3034,
    wall: 0x48545a,
  },
  {
    id: 'police',
    name: '警察局',
    blurb: '證物室和槍械櫃都還鎖著，警員霧屍穿著防彈背心。',
    time: 2,
    risk: 4,
    unlockDay: 3,
    nodes: 4,
    mapX: 470,
    mapY: 230,
    color: 0x5a80d0,
    zombies: { police: 4, basic: 3, prisoner: 2, runner: 1 },
    loot: { scrap: [24, 36], ammo: { '9mm': 3, '357': 2, '12ga': 3, '556': 1 }, supplies: { lockpick: 2 } },
    survivors: { shooter: 4, engineer: 1 },
    tags: ['槍械', '霰彈', '射手'],
    floor: 0x272b34,
    wall: 0x353c4c,
  },
  {
    id: 'checkpoint',
    name: '軍方檢查站',
    blurb: '撤離失敗的檢查站。步槍彈、重武器，還有穿全套裝備的士兵霧屍。',
    time: 2,
    risk: 5,
    unlockDay: 5,
    nodes: 4,
    mapX: 570,
    mapY: 140,
    color: 0x9a9a50,
    zombies: { soldier: 4, runner: 2, brute: 2, firefighter: 1, dog: 2, bear: 0.6 },
    loot: { scrap: [30, 44], ammo: { '556': 4, '762': 3, '12ga': 1, '50': 1 }, supplies: { medkit: 2 } },
    survivors: { shooter: 3, engineer: 2 },
    tags: ['步槍彈', '.50'],
    floor: 0x2e2f28,
    wall: 0x44463a,
  },
];

export function getZone(id: string): ZoneDef | undefined {
  return ZONES.find((z) => z.id === id);
}

// ── 每日情報 ───────────────────────────────────────────

export type IntelKind = 'sos' | 'horde' | 'airdrop' | 'quiet';

export const INTEL: Record<IntelKind, { name: string; desc: string; riskAdd: number; lootMul: number; survivor?: boolean; bigBonus?: boolean; noiseMul?: number }> = {
  sos: { name: '求救訊號', desc: '無線電收到求救：大獎一定有倖存者', riskAdd: 0, lootMul: 1, survivor: true },
  horde: { name: '屍潮經過', desc: '霧屍變多（風險 +1），但戰利品 ×1.5', riskAdd: 1, lootMul: 1.5 },
  airdrop: { name: '補給空投', desc: '有架飛機丟了箱子：大獎額外多一份', riskAdd: 0, lootMul: 1, bigBonus: true },
  quiet: { name: '霧很濃', desc: '能見度低，霧屍比較難發現你（噪音增加 -40%）', riskAdd: 0, lootMul: 1, noiseMul: 0.6 },
};

// ── 噪音 ───────────────────────────────────────────────

export const NOISE = {
  max: 100,
  /** 每 25 點噪音，戰鬥多 1 隻霧屍 */
  perExtraZombie: 25,
  /** 探索戰鬥裡每開一槍（消音武器之後可以調低） */
  perShot: 3,
  /** 噪音滿了：下一步之前屍潮來襲（強制戰鬥，打完歸零到這個值） */
  afterHorde: 40,
};

// ── 隨機事件 ───────────────────────────────────────────

export type QteKind = 'timing' | 'sequence' | 'mash';

/** QTE 的評等：great 大成功（一次都沒失誤／剩很多時間）、ok 成功、fail 失敗 */
export type QteGrade = 'great' | 'ok' | 'fail';

/** 開鎖小遊戲的鎖：外觀不同（掛鎖、門鎖、櫃鎖、保險箱），裡面都是真的彈子鎖芯；fusebox 是電箱接線（旋轉接頭把電接通） */
export type LockModel = 'padlock' | 'door' | 'cabinet' | 'safe' | 'fusebox';

export interface LockSpec {
  model: LockModel;
  /** 難度 1～3：彈子數（3～5）、彈簧多硬、剪切線判定多窄 */
  tier: 1 | 2 | 3;
  /** 開鎖畫面上方的說明 */
  prompt: string;
}

/** 圍困救援：小場景、大量霧屍、倒數計時（見 src/scenes/SiegeScene.ts） */
export interface SiegeSpec {
  /** bus：公車頂撐到引擎發動；store：便利店裡守住窗門，撐到後門撬開 */
  layout: 'bus' | 'store';
  /** 撐幾秒（目標進度條跑滿的時間） */
  seconds: number;
  title: string;
}

export interface QteSpec {
  kind: QteKind;
  /** 題目說明（例如「抓準時機跳過去」） */
  prompt: string;
  /** timing：要命中幾次；sequence：幾個方向；mash：要按幾下 */
  count: number;
  /** 限時（秒），timing 是每次的指針週期 */
  time: number;
}

export type FieldGoal = 'reach' | 'clear' | 'survive' | 'protect';

export interface FieldSpec {
  mode: 'stealth' | 'fight';
  goal: FieldGoal;
  /** 說明（顯示在戰鬥畫面上方） */
  title: string;
  /** 基礎霧屍數（再依風險、噪音加） */
  zombies: number;
  /** survive / protect：撐幾秒 */
  seconds?: number;
  /** 條件：不准開槍 */
  meleeOnly?: boolean;
  /** 單軸空間：橫向捲軸，所有人都在同一條線上，只能左右移動（窄走廊、街道） */
  axis?: 'single';
  /** 沿街前進：兩站之間的橫向推進段，走到右邊的下一站才結束；exitLabel 是終點牌子上的字 */
  walk?: boolean;
  exitLabel?: string;
}

/** 沿街前進：街道長度與霧屍數 */
export const WALK = {
  worldW: 1600,
  /** 基礎霧屍數（再依風險、噪音加，見 Expedition.zombieCount） */
  zombies: 2,
  /** 霧屍離主角多遠以內才開始動（前方的先站著，走近了才撲過來） */
  wakeRange: 380,
  /** 路邊可以打開的箱子、車子數 */
  extras: 6,
};

/** 事件的結果：獎勵、代價、說明 */
export interface Outcome {
  text: string;
  loot?: LootTier;
  /** 額外固定獎勵 */
  bonus?: Loot;
  noise?: number;
  /** 主角受傷 */
  hurt?: number;
  /** 隊員受傷（隨機一位，平均分攤） */
  crewHurt?: number;
  /** 救到倖存者（職業依區域） */
  survivor?: boolean;
  /** 付出廢料 */
  scrapCost?: number;
  /** 主線劇情事件成功：發這章的固定獎勵，平安回家後完成這一章（見 src/data/story.ts） */
  story?: boolean;
}

export type EventAction =
  | { type: 'outcome'; outcome: Outcome }
  /** comic：有漫畫分鏡的招牌事件（src/data/comics.ts）；great：大成功的結果（沒填就跟 success 一樣） */
  | { type: 'qte'; qte: QteSpec; success: Outcome; fail: Outcome; great?: Outcome; comic?: string }
  /** 開鎖小遊戲 */
  | { type: 'lock'; lock: LockSpec; success: Outcome; fail: Outcome }
  /** 圍困救援 */
  | { type: 'siege'; siege: SiegeSpec; success: Outcome; fail: Outcome }
  | { type: 'field'; field: FieldSpec; success: Outcome; /** 潛入沒被發現 */ clean?: Outcome }
  /** 屬性檢定：成功率 = base + 隊伍最高該屬性 × perPoint；有指定職業同行直接成功 */
  | { type: 'check'; attr: AttrKey; base: number; perPoint: number; role?: CompanionRole; success: Outcome; fail: Outcome };

export interface EventOption {
  label: string;
  /** 按鈕下方的小字說明 */
  hint?: string;
  /** 需要消耗的用品 */
  consume?: SupplyId;
  /** 需要多少廢料（不夠就不能選） */
  scrap?: number;
  action: EventAction;
}

export interface ExploreEvent {
  id: string;
  title: string;
  text: string;
  weight: number;
  /** 風險至少多少才會出現 */
  minRisk?: number;
  /** 只在這些區域出現（不填 = 全部） */
  zones?: string[];
  /** 只當大獎（路線最後一站） */
  finale?: boolean;
  options: EventOption[];
}

const timing = (prompt: string, count = 3, time = 1.2): QteSpec => ({ kind: 'timing', prompt, count, time });
const sequence = (prompt: string, count = 5, time = 3.2): QteSpec => ({ kind: 'sequence', prompt, count, time });
const mash = (prompt: string, count = 14, time = 3): QteSpec => ({ kind: 'mash', prompt, count, time });

export const EVENTS: ExploreEvent[] = [
  // ── 搜刮 ──
  {
    id: 'stash',
    title: '沒人碰過的儲物間',
    text: '門半掩著，裡面堆滿紙箱。仔細翻會比較久，也比較吵。',
    weight: 5,
    options: [
      { label: '快速翻一下', hint: '少量物資・噪音 +5', action: { type: 'outcome', outcome: { text: '你抓了幾樣看起來有用的東西就走。', loot: 'small', noise: 5 } } },
      { label: '仔細搜刮', hint: '較多物資・噪音 +20', action: { type: 'outcome', outcome: { text: '你把每個箱子都翻過一遍，收穫不錯，但弄出了不少聲響。', loot: 'medium', noise: 20 } } },
    ],
  },
  {
    id: 'locked',
    title: '上鎖的鐵櫃',
    text: '一個掛著大鎖的鐵櫃，裡面傳來東西滾動的聲音。',
    weight: 4,
    options: [
      { label: '用開鎖工具', consume: 'lockpick', hint: '安靜打開', action: { type: 'outcome', outcome: { text: '喀一聲，鎖開了。', loot: 'big' } } },
      {
        label: '自己開鎖',
        hint: '開鎖小遊戲・失敗會弄出聲響',
        action: {
          type: 'lock',
          lock: { model: 'padlock', tier: 1, prompt: '撬開鐵櫃上的掛鎖' },
          success: { text: '最後一根彈子卡進去，鎖頭彈開了。', loot: 'big' },
          fail: { text: '鎖芯卡死了。你只好拿撬棍硬撬，砸出好大一聲，只來得及抓一點東西。', loot: 'small', noise: 25 },
        },
      },
      {
        label: '讓工兵處理',
        hint: '屬性：手速・有工兵必成功',
        action: {
          type: 'check',
          attr: 'hand',
          base: 0.25,
          perPoint: 0.12,
          role: 'engineer',
          success: { text: '隊員三兩下就把鎖撥開了。', loot: 'big' },
          fail: { text: '試了半天打不開，只好放棄。', noise: 5 },
        },
      },
    ],
  },
  {
    id: 'safe',
    title: '辦公室的保險箱',
    text: '經理室角落有一個舊式保險箱，轉盤早就壞了，但下面還有一個備用鑰匙孔。',
    weight: 2,
    options: [
      {
        label: '撬備用鑰匙孔',
        hint: '開鎖小遊戲',
        action: {
          type: 'lock',
          lock: { model: 'safe', tier: 2, prompt: '撬開保險箱的備用鑰匙孔' },
          success: { text: '鎖芯一轉，門把一壓就開了。裡面是有人藏起來的家當。', loot: 'big', bonus: { scrap: 10 } },
          fail: { text: '撥片斷在鎖孔裡，警報器嗶嗶亂叫。你踹了箱子一腳，悻悻離開。', noise: 30 },
        },
      },
      { label: '用開鎖工具', consume: 'lockpick', hint: '直接打開', action: { type: 'outcome', outcome: { text: '專業的工具就是不一樣，喀、喀、喀，門開了。', loot: 'big' } } },
      { label: '不浪費時間', action: { type: 'outcome', outcome: { text: '你順手拿了桌上的零錢罐就走。', bonus: { scrap: 4 } } } },
    ],
  },
  {
    id: 'fusebox',
    title: '斷電的倉庫門',
    text: '電動鐵捲門沒電了，旁邊的電箱蓋子被扯開，線路亂成一團。接通的話門就會自己升起來。',
    weight: 3,
    options: [
      {
        label: '重新接線',
        hint: '小遊戲：電箱接線',
        action: {
          type: 'lock',
          lock: { model: 'fusebox', tier: 2, prompt: '轉動接頭，把電從左邊接到右邊' },
          success: { text: '電箱啪一聲亮起，鐵捲門緩緩升了上去。', loot: 'medium', bonus: { scrap: 6 } },
          fail: { text: '火花一閃，你被電得整隻手發麻。門紋風不動。', hurt: 12, noise: 10 },
        },
      },
      { label: '讓工兵處理', hint: '屬性：手速・有工兵必成功', action: { type: 'check', attr: 'hand', base: 0.2, perPoint: 0.12, role: 'engineer', success: { text: '隊員接了兩條線，門就升起來了。', loot: 'medium' }, fail: { text: '保險絲燒了，門再也開不了。', noise: 5 } } },
      { label: '放棄', action: { type: 'outcome', outcome: { text: '你轉頭走向下一個地方。' } } },
    ],
  },
  // ── QTE ──
  {
    id: 'floor',
    title: '腐朽的樓板',
    text: '往前的路只剩幾根橫樑，下面是一層樓高的黑洞，傳來低吼聲。',
    weight: 3,
    options: [
      {
        label: '抓準時機跳過去',
        hint: 'QTE 時機條・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'floor',
          qte: timing('指針進到綠區時按下！', 3, 1.1),
          great: { text: '你一口氣跳過三根橫樑，還在對面撿到一個沒人碰過的背包。', loot: 'medium' },
          success: { text: '你穩穩落在對面，順手撿起地上的背包。', loot: 'small' },
          fail: { text: '橫樑斷了，你摔了下去，狼狽地爬回來。', hurt: 22, noise: 15 },
        },
      },
      { label: '繞遠路', hint: '安全，但一無所獲', action: { type: 'outcome', outcome: { text: '你繞了一大圈，什麼都沒找到。' } } },
    ],
  },
  {
    id: 'ambush',
    title: '櫃子裡衝出來的霧屍！',
    text: '你一打開衣櫃，一隻霧屍就撲了上來！',
    weight: 4,
    options: [
      {
        label: '推開牠！',
        hint: 'QTE 方向鍵・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'ambush',
          qte: sequence('照順序按方向鍵掙脫！', 5, 3),
          great: { text: '你反手把牠壓進衣櫃，一棒了結，連衣櫃裡的東西都歸你。', loot: 'medium' },
          success: { text: '你把牠推倒，一刀了結。牠身上還掛著一個腰包。', loot: 'small', noise: 5 },
          fail: { text: '牠在你手臂上咬了一口才被甩開。', hurt: 18, noise: 15 },
        },
      },
    ],
  },
  {
    id: 'door',
    title: '卡住的鐵捲門',
    text: '倉庫的鐵捲門卡在半空，後面看得到成箱的物資。',
    weight: 3,
    options: [
      {
        label: '硬抬上去',
        hint: 'QTE 連打・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'door',
          qte: mash('連打把門抬起來！', 18, 3.4),
          great: { text: '你一口氣把門推到頂，卡榫喀一聲扣住，裡面的箱子全都搬得出來。', loot: 'big', noise: 10 },
          success: { text: '鐵捲門嘎嘎作響地升了上去。', loot: 'medium', noise: 15 },
          fail: { text: '門砸了下來，差點壓到手。', hurt: 10, noise: 20 },
        },
      },
      {
        label: '從縫裡鑽進去',
        hint: '屬性：腳程',
        action: {
          type: 'check',
          attr: 'agi',
          base: 0.3,
          perPoint: 0.12,
          success: { text: '身手靈活的隊員鑽了進去，把東西一箱箱推出來。', loot: 'medium' },
          fail: { text: '卡在半路，被刮得滿身是傷才退出來。', crewHurt: 20 },
        },
      },
    ],
  },
  {
    id: 'chase',
    title: '樓梯間的跑者',
    text: '樓梯間上方傳來急促的腳步聲。一隻跑者發現你了，正從樓上衝下來！',
    weight: 3,
    options: [
      {
        label: '閃開牠！',
        hint: 'QTE 方向鍵・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'chase',
          qte: sequence('照順序按方向鍵閃身！', 4, 2.4),
          great: { text: '你側身一讓，牠整個摔下樓梯折斷了脖子。牠口袋裡還有東西。', loot: 'small', bonus: { scrap: 6 } },
          success: { text: '你閃過牠的撲咬，回身一棒把牠打下樓梯。' },
          fail: { text: '牠撞上你，一人一屍滾下半層樓，你被抓得滿身血痕。', hurt: 20, noise: 15 },
        },
      },
      { label: '往回跑', hint: '屬性：腳程', action: { type: 'check', attr: 'agi', base: 0.45, perPoint: 0.1, success: { text: '你們甩掉了牠，躲進一間辦公室。' }, fail: { text: '牠追上了殿後的隊員。', crewHurt: 22, noise: 10 } } },
    ],
  },
  {
    id: 'dogs',
    title: '野狗',
    text: '停車場的車底下傳來低吼。一隻皮肉翻開的大狗慢慢爬了出來，盯著你的喉嚨。',
    weight: 2,
    options: [
      {
        label: '等牠撲過來再打',
        hint: 'QTE 時機條・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'dogs',
          qte: timing('牠撲過來的瞬間揮下去！', 2, 0.95),
          great: { text: '一棒正中鼻樑。牠在地上抽了兩下就不動了，車裡還有人留下的補給。', loot: 'medium' },
          success: { text: '你把牠打退，牠夾著尾巴鑽回車底。', loot: 'small' },
          fail: { text: '牠咬住你的小腿死不放口，好不容易才甩開。', hurt: 24, noise: 10 },
        },
      },
      { label: '丟誘餌引開', consume: 'decoy', hint: '安全通過', action: { type: 'outcome', outcome: { text: '鬧鐘一響，牠衝向另一頭。', loot: 'small' } } },
    ],
  },
  // ── 潛入 ──
  {
    id: 'sleepers',
    title: '沉睡的屍群',
    text: '大廳裡站著一群一動也不動的霧屍，後面就是你要的物資。',
    weight: 4,
    options: [
      {
        label: '無聲潛入',
        hint: '潛入關卡・從背後暗殺',
        action: {
          type: 'field',
          field: { mode: 'stealth', goal: 'reach', title: '潛到右邊的出口，別被發現', zombies: 4 },
          clean: { text: '你像影子一樣穿過大廳，物資一件不少。', loot: 'big' },
          success: { text: '被發現了，但你還是殺出一條路。', loot: 'medium' },
        },
      },
      {
        label: '丟誘餌引開',
        consume: 'decoy',
        hint: '直接拿到物資',
        action: { type: 'outcome', outcome: { text: '鬧鐘一響，屍群全擠到另一頭去了。', loot: 'medium' } },
      },
      { label: '放棄，換條路', action: { type: 'outcome', outcome: { text: '你悄悄退了出去。' } } },
    ],
  },
  {
    id: 'patrol',
    title: '巡邏的霧屍',
    text: '幾隻霧屍在停車場來回遊蕩，好像在找什麼。',
    weight: 3,
    minRisk: 2,
    options: [
      {
        label: '潛行通過',
        hint: '潛入關卡',
        action: {
          type: 'field',
          field: { mode: 'stealth', goal: 'reach', title: '躲在陰影裡，穿過停車場', zombies: 5 },
          clean: { text: '沒有一隻發現你。你在車裡找到一些東西。', loot: 'medium' },
          success: { text: '一番纏鬥後你衝了過去。', loot: 'small' },
        },
      },
      {
        label: '正面清場',
        hint: '條件戰鬥：消滅全部',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '清掉停車場的霧屍', zombies: 6 },
          success: { text: '停車場安靜了。你翻了翻車子。', loot: 'medium', noise: 10 },
        },
      },
    ],
  },
  // ── 條件戰鬥 ──
  {
    id: 'trapped',
    title: '被包圍的倖存者',
    text: '「救命！」一台公車被屍群團團圍住，司機縮在駕駛座上猛轉鑰匙，引擎一直發不動。',
    weight: 3,
    options: [
      {
        label: '爬上車頂掩護他',
        hint: '圍困救援：撐到引擎發動',
        action: {
          type: 'siege',
          siege: { layout: 'bus', seconds: 40, title: '把爬上來的霧屍打下去，撐到引擎發動' },
          success: { text: '引擎轟一聲發動，公車輾開屍群衝了出去。司機決定跟你回據點。', survivor: true, noise: 15 },
          fail: { text: '車窗被撞破，司機被拖了下去。你只能從車頂跳到旁邊的雨遮上逃走。', hurt: 10, noise: 20 },
        },
      },
      { label: '太危險了，離開', action: { type: 'outcome', outcome: { text: '你轉身離開，背後的呼救聲越來越小。' } } },
    ],
  },
  {
    id: 'quiet',
    title: '睡在門口的大傢伙',
    text: '一隻巨大的霧屍堵著門，旁邊還有幾隻在打盹。開槍一定會把整條街吵醒。',
    weight: 3,
    minRisk: 2,
    options: [
      {
        label: '只用近戰解決',
        hint: '單軸近戰・禁止開槍',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '霧屍排成一列：只能用近戰，別讓整條街醒過來', zombies: 4, meleeOnly: true, axis: 'single' },
          success: { text: '沒有一聲槍響。門後是一間沒人碰過的房間。', loot: 'big' },
        },
      },
      {
        label: '開槍硬幹',
        hint: '條件戰鬥・噪音 +35',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '把門口清乾淨', zombies: 6 },
          success: { text: '門開了，但遠處開始傳來回應的吼聲。', loot: 'medium', noise: 35 },
        },
      },
    ],
  },
  {
    id: 'hold',
    title: '倉庫裡的補給',
    text: '整箱的彈藥！但搬出去要時間，四周的霧屍已經被驚動了。',
    weight: 2,
    minRisk: 3,
    options: [
      {
        label: '邊搬邊守',
        hint: '條件戰鬥：撐 30 秒',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'survive', title: '撐 30 秒，等隊員把彈藥搬完', zombies: 5, seconds: 30 },
          success: { text: '隊員扛著彈藥箱跟你撤出來。', loot: 'big', noise: 15 },
        },
      },
      { label: '抓一盒就走', hint: '少量物資', action: { type: 'outcome', outcome: { text: '你只拿得動一盒。', loot: 'small' } } },
    ],
  },
  // ── 選擇／檢定 ──
  {
    id: 'trader',
    title: '陌生的拾荒者',
    text: '一個戴防毒面具的人舉起雙手：「別開槍，我只是想換點東西。」',
    weight: 2,
    options: [
      { label: '用 25 廢料換補給', scrap: 25, hint: '換一份物資＋用品', action: { type: 'outcome', outcome: { text: '他從大背包裡掏出一包東西，點點頭就走了。', scrapCost: 25, loot: 'medium', bonus: { supplies: { medkit: 1 } } } } },
      {
        label: '說服他加入',
        hint: '屬性：膽識',
        action: {
          type: 'check',
          attr: 'nerve',
          base: 0.15,
          perPoint: 0.1,
          success: { text: '他考慮了一下：「好吧，一個人在外面也撐不久。」', survivor: true },
          fail: { text: '他搖搖頭，消失在霧裡。' },
        },
      },
      { label: '各走各的', action: { type: 'outcome', outcome: { text: '你們互相看著對方，慢慢退開。' } } },
    ],
  },
  {
    id: 'wounded',
    title: '受傷的倖存者',
    text: '角落裡躺著一個腿受傷的人，臉色發白，但還有意識。',
    weight: 3,
    options: [
      {
        label: '急救後帶回去',
        hint: '屬性：手速・有醫護必成功',
        action: {
          type: 'check',
          attr: 'hand',
          base: 0.3,
          perPoint: 0.1,
          role: 'medic',
          success: { text: '止住血之後，他咬著牙站了起來，願意跟你走。', survivor: true },
          fail: { text: '傷口太深，他沒撐過去。你收下了他的背包。', loot: 'small' },
        },
      },
      { label: '用醫療包', consume: 'medkit', hint: '必定救回', action: { type: 'outcome', outcome: { text: '包紮好之後，他感激地加入了你們。', survivor: true } } },
      { label: '拿走他的物資', hint: '…', action: { type: 'outcome', outcome: { text: '你拿走了他的背包。身後傳來微弱的咒罵。', loot: 'small' } } },
    ],
  },
  {
    id: 'trap',
    title: '可疑的絆線',
    text: '走廊上拉著一條細線，連到一顆生鏽的手榴彈。',
    weight: 2,
    options: [
      {
        label: '小心拆除',
        hint: 'QTE 時機條・漫畫分鏡',
        action: {
          type: 'qte',
          comic: 'trap',
          qte: timing('穩住手，在綠區剪線', 2, 1.4),
          great: { text: '引信完整拆下，連手榴彈的鐵罐都能拆成好零件。', bonus: { scrap: 16 } },
          success: { text: '拆下來了，引信和鐵罐都能拆成零件。', bonus: { scrap: 8 } },
          fail: { text: '轟！你被炸飛了出去。', hurt: 30, noise: 40 },
        },
      },
      { label: '跨過去', hint: '屬性：腳程', action: { type: 'check', attr: 'agi', base: 0.5, perPoint: 0.08, success: { text: '大家小心翼翼地跨了過去。' }, fail: { text: '有人勾到了線！', crewHurt: 25, noise: 40 } } },
    ],
  },
  // ── 大獎（最後一站） ──
  {
    id: 'cache',
    title: '藏匿點',
    text: '前一批倖存者留下的藏匿點，但入口被一群霧屍占據了。',
    weight: 3,
    finale: true,
    options: [
      {
        label: '潛進去',
        hint: '潛入關卡',
        action: {
          type: 'field',
          field: { mode: 'stealth', goal: 'reach', title: '溜進最右邊的藏匿點', zombies: 5 },
          clean: { text: '你一槍未發就拿到了全部物資。', loot: 'big', bonus: { scrap: 15 } },
          success: { text: '一場硬仗，但藏匿點是你的了。', loot: 'big' },
        },
      },
      {
        label: '強攻',
        hint: '條件戰鬥：消滅全部',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '清空藏匿點入口', zombies: 7 },
          success: { text: '清完了。藏匿點裡的東西都歸你。', loot: 'big', noise: 15 },
        },
      },
    ],
  },
  {
    id: 'shelter',
    title: '倖存者的避難所',
    text: '便利店裡擠著一家人，玻璃門外的霧屍越聚越多。後門被貨架堵死了，有人正拚命把它撬開。',
    weight: 2,
    finale: true,
    options: [
      {
        label: '衝進去幫他們守',
        hint: '圍困救援：撐到後門撬開',
        action: {
          type: 'siege',
          siege: { layout: 'store', seconds: 45, title: '守住窗門，別讓霧屍碰到倖存者，撐到後門撬開' },
          success: { text: '後門終於撬開了。一家人跟著你從後巷逃出來，其中一位決定跟你走，還分了你一些物資。', survivor: true, loot: 'medium' },
          fail: { text: '玻璃整片碎了，屍群湧進店裡。你拉著還活著的人從後門擠出去，什麼也沒帶走。', hurt: 15, noise: 25 },
        },
      },
      { label: '敲門交易', scrap: 30, hint: '30 廢料換大量物資', action: { type: 'outcome', outcome: { text: '門縫裡塞出一大袋東西。', scrapCost: 30, loot: 'big' } } },
    ],
  },
  {
    id: 'armory',
    title: '上鎖的槍械櫃',
    text: '一整排槍械櫃，鎖得死死的。旁邊站著幾隻穿制服的霧屍。',
    weight: 3,
    finale: true,
    minRisk: 3,
    options: [
      { label: '用開鎖工具', consume: 'lockpick', hint: '安靜打開', action: { type: 'outcome', outcome: { text: '櫃門一個個彈開。', loot: 'big', bonus: { scrap: 10 } } } },
      {
        label: '撬開槍櫃的鎖',
        hint: '開鎖小遊戲・最難',
        action: {
          type: 'lock',
          lock: { model: 'door', tier: 3, prompt: '撬開槍械櫃的鎖（五根彈子）' },
          success: { text: '最後一根彈子卡上去，櫃門鬆開了，一排槍安安靜靜地掛在裡面。', loot: 'big', bonus: { scrap: 10 } },
          fail: { text: '警報大作！穿制服的霧屍全轉過頭來。你搶了一盒子彈就跑。', loot: 'small', noise: 35 },
        },
      },
      {
        label: '先清場再撬',
        hint: '條件戰鬥',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '清掉槍械櫃旁的霧屍', zombies: 6 },
          success: { text: '你把櫃子一個個撬開。', loot: 'big', noise: 20 },
        },
      },
    ],
  },
];

/** 噪音滿了：屍潮來襲（強制事件） */
export const HORDE_EVENT: ExploreEvent = {
  id: 'horde',
  title: '屍潮被引來了！',
  text: '太吵了。四面八方都傳來吼聲，霧裡的影子越來越多。',
  weight: 0,
  options: [
    {
      label: '殺出重圍',
      hint: '單軸夾擊：撐 25 秒',
      action: {
        type: 'field',
        field: { mode: 'fight', goal: 'survive', title: '屍潮來襲！前後夾擊，撐 25 秒找到退路', zombies: 6, seconds: 25, axis: 'single' },
        success: { text: '你們甩掉了屍潮。' },
      },
    },
    { label: '丟誘餌引開', consume: 'decoy', hint: '噪音歸零', action: { type: 'outcome', outcome: { text: '誘餌把屍潮引向了另一條街。' } } },
  ],
};
