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

export type SupplyId = 'medkit' | 'grenade' | 'lockpick' | 'decoy';

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
  grenade: { id: 'grenade', name: '手榴彈', desc: '丟向準星，範圍爆炸（夜裡或探索戰鬥 G 鍵）', max: 4, start: 1 },
  lockpick: { id: 'lockpick', name: '開鎖工具', desc: '直接打開上鎖的櫃子和門，不必 QTE', max: 3, start: 0 },
  decoy: { id: 'decoy', name: '噪音誘餌', desc: '引開屍群：跳過一場戰鬥，或讓噪音歸零', max: 3, start: 0 },
};

export const MEDKIT_HEAL = 45;
export const GRENADE = { radius: 64, damage: 140, fuse: 0.55, cooldown: 0.8 };

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
}

export type LootTier = 'small' | 'medium' | 'big';

export interface LootTable {
  scrap: [number, number];
  ammo: Partial<Record<AmmoType, number>>;
  supplies: Partial<Record<SupplyId, number>>;
  /** 可能掉的武器（依序越後面越稀有） */
  weapons: string[];
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
    loot: { scrap: [14, 22], ammo: { '9mm': 4, '12ga': 2 }, supplies: { grenade: 1, decoy: 2, lockpick: 1 }, weapons: ['bat', 'machete'] },
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
    loot: { scrap: [16, 26], ammo: { '9mm': 3, '12ga': 3, '357': 1 }, supplies: { medkit: 3, decoy: 1 }, weapons: ['bat', 'coach'] },
    survivors: { medic: 1, engineer: 1, shooter: 1 },
    tags: ['醫療包', '霰彈', '綜合'],
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
    loot: { scrap: [12, 20], ammo: { '9mm': 2, '357': 2, '12ga': 2 }, supplies: { medkit: 2, lockpick: 2 }, weapons: ['machete', 'axe', 'python'] },
    survivors: { shooter: 2, medic: 2, engineer: 2 },
    tags: ['倖存者', '近戰武器', '.357'],
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
    loot: { scrap: [20, 32], ammo: { '9mm': 3, '556': 1 }, supplies: { medkit: 5, grenade: 1 }, weapons: ['mp5', 'axe'] },
    survivors: { medic: 4, shooter: 1 },
    tags: ['大量醫療包', '醫護', 'MP5'],
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
    loot: { scrap: [24, 36], ammo: { '9mm': 3, '357': 2, '12ga': 3, '556': 1 }, supplies: { grenade: 2, lockpick: 2 }, weapons: ['python', 'm1014', 'mp5', 'm4a1'] },
    survivors: { shooter: 4, engineer: 1 },
    tags: ['槍械', '霰彈', '射手'],
    floor: 0x272b34,
    wall: 0x353c4c,
  },
  {
    id: 'checkpoint',
    name: '軍方檢查站',
    blurb: '撤離失敗的檢查站。步槍彈、手榴彈，還有穿全套裝備的士兵霧屍。',
    time: 2,
    risk: 5,
    unlockDay: 5,
    nodes: 4,
    mapX: 570,
    mapY: 140,
    color: 0x9a9a50,
    zombies: { soldier: 4, runner: 2, brute: 2, firefighter: 1, dog: 2, bear: 0.6 },
    loot: { scrap: [30, 44], ammo: { '556': 4, '762': 3, '12ga': 1 }, supplies: { grenade: 4, medkit: 2 }, weapons: ['ak47', 'm4a1', 'mosin', 'm249'] },
    survivors: { shooter: 3, engineer: 2 },
    tags: ['步槍彈', '手榴彈', '重武器'],
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
}

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
}

export type EventAction =
  | { type: 'outcome'; outcome: Outcome }
  | { type: 'qte'; qte: QteSpec; success: Outcome; fail: Outcome }
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
        label: '撬開它',
        hint: 'QTE 連打・失敗很吵',
        action: {
          type: 'qte',
          qte: mash('連打把鎖撬開！', 16, 3.2),
          success: { text: '鎖頭被你硬生生扭斷。', loot: 'medium', noise: 10 },
          fail: { text: '撬棍滑掉，砸在鐵櫃上發出巨響。你只來得及抓一點東西。', loot: 'small', noise: 30 },
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
  // ── QTE ──
  {
    id: 'floor',
    title: '腐朽的樓板',
    text: '往前的路只剩幾根橫樑，下面是一層樓高的黑洞，傳來低吼聲。',
    weight: 3,
    options: [
      {
        label: '抓準時機跳過去',
        hint: 'QTE 時機條',
        action: {
          type: 'qte',
          qte: timing('指針進到綠區時按下！', 3, 1.1),
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
        hint: 'QTE 方向鍵',
        action: {
          type: 'qte',
          qte: sequence('照順序按方向鍵掙脫！', 5, 3),
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
        hint: 'QTE 連打',
        action: {
          type: 'qte',
          qte: mash('連打把門抬起來！', 18, 3.4),
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
    text: '「救命！」一個人爬上了公車頂，下面圍滿了霧屍。',
    weight: 3,
    options: [
      {
        label: '救他下來',
        hint: '條件戰鬥：保護倖存者 25 秒',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'protect', title: '保護倖存者，撐過 25 秒', zombies: 4, seconds: 25 },
          success: { text: '倖存者跳下車頂，決定跟你回據點。', survivor: true, noise: 10 },
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
        hint: '條件戰鬥：禁止開槍',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'clear', title: '只能用近戰，別讓整條街醒過來', zombies: 4, meleeOnly: true },
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
        hint: 'QTE 時機條・成功拿到手榴彈',
        action: {
          type: 'qte',
          qte: timing('穩住手，在綠區剪線', 2, 1.4),
          success: { text: '拆下來了，這顆還能用。', bonus: { supplies: { grenade: 1 } } },
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
    text: '一扇用家具堵住的門後傳來人聲。外面的霧屍正在撞門。',
    weight: 2,
    finale: true,
    options: [
      {
        label: '幫他們守住',
        hint: '條件戰鬥：撐 30 秒',
        action: {
          type: 'field',
          field: { mode: 'fight', goal: 'protect', title: '守住避難所的門 30 秒', zombies: 5, seconds: 30 },
          success: { text: '他們打開門，一位倖存者決定跟你走，還分了你一些物資。', survivor: true, loot: 'medium' },
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
        label: '先清場再撬',
        hint: '條件戰鬥＋QTE',
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
      hint: '條件戰鬥：撐 25 秒',
      action: {
        type: 'field',
        field: { mode: 'fight', goal: 'survive', title: '屍潮來襲！撐 25 秒找到退路', zombies: 6, seconds: 25 },
        success: { text: '你們甩掉了屍潮。' },
      },
    },
    { label: '丟誘餌引開', consume: 'decoy', hint: '噪音歸零', action: { type: 'outcome', outcome: { text: '誘餌把屍潮引向了另一條街。' } } },
  ],
};
