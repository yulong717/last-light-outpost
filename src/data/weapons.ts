/**
 * 武器資料：槍械與近戰。數值都集中在這裡調整，平衡說明與比較表見 docs/WEAPONS.md。
 *
 * 設計原則：
 * - 每把槍都以真實型號為原型，射速（RPM）、彈匣容量、裝填方式照實物；
 *   傷害與穿透依口徑相對大小換算成遊戲數值（霧屍 30 血為基準）。
 * - 手感差異來自「操作方式」而不只是數字：泵動要拉、栓動要拉栓、
 *   管狀彈倉一顆一顆塞（可以隨時開火打斷）、彈匣槍膛內留一發換彈較快。
 * - 平衡靠三件事：彈藥成本（白天用廢料買）、解鎖天數、負重（移動速度、換槍時間）。
 *   起始手槍備彈無限、近戰不耗彈，玩家永遠不會卡死。
 */
import type { CompanionGunDef } from './companions';
import type { DamageType } from '../combat/Damage';

/** 彈藥種類（實際口徑做了簡化合併，見 AMMO） */
export type AmmoType = '9mm' | '357' | '556' | '762' | '12ga';

export interface AmmoDef {
  id: AmmoType;
  name: string;
  /** 一盒幾發 */
  box: number;
  /** 一盒多少廢料 */
  price: number;
  /** 新遊戲送的數量 */
  start: number;
  /** 最多能囤多少 */
  max: number;
}

export const AMMO: Record<AmmoType, AmmoDef> = {
  '9mm': { id: '9mm', name: '9mm 手槍彈', box: 30, price: 6, start: 0, max: 360 },
  '357': { id: '357', name: '.357 麥格農', box: 12, price: 8, start: 0, max: 96 },
  '556': { id: '556', name: '5.56 步槍彈', box: 30, price: 12, start: 0, max: 400 },
  '762': { id: '762', name: '7.62 步槍彈', box: 20, price: 12, start: 0, max: 200 },
  '12ga': { id: '12ga', name: '12 號霰彈', box: 10, price: 10, start: 24, max: 80 },
};

/**
 * 擊發方式
 * - semi：半自動，每按一下一發
 * - auto：全自動，按住連射
 * - pump：泵動，每發之間要拉一下護木（射速 = 拉動節奏）
 * - bolt：栓動，每發之間要拉栓（期間不能開火）
 */
export type FireAction = 'semi' | 'auto' | 'pump' | 'bolt';

/**
 * 裝填方式
 * - magazine：換彈匣。膛內還有一發時是「戰術換彈」，較快且多一發（彈匣 + 1）
 * - single：一顆一顆塞（管狀彈倉、栓動槍）；途中按開火會中斷，已塞的子彈保留
 * - whole：一次裝滿、固定時間（左輪快速裝填器、雙管折開、機槍彈鏈）
 */
export type ReloadStyle = 'magazine' | 'single' | 'whole';

export type WeaponClass = 'pistol' | 'revolver' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'lmg';

export interface FirearmDef {
  kind: 'firearm';
  id: string;
  /** 遊戲內顯示名 */
  name: string;
  /** 真實型號與口徑 */
  model: string;
  cls: WeaponClass;
  /** 一句話特色，顯示在軍械庫 */
  desc: string;
  ammo: AmmoType;
  /** 起始手槍：備彈無限 */
  infiniteReserve?: boolean;

  // ── 傷害 ──
  /** 每顆彈丸傷害 */
  damage: number;
  /** 一次射出幾顆（霰彈） */
  pellets: number;
  damageType: DamageType;
  /** 穿甲 0..1，見 src/combat/Damage.ts */
  penetration: number;
  /** 最多打穿幾隻 */
  pierce: number;
  /** 每打穿一隻，傷害剩下多少比例 */
  pierceFalloff: number;
  /** 傷害從這個距離開始衰減（像素），到 falloffEnd 剩 falloffMin 倍 */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  /** 最遠射程（像素） */
  range: number;
  /** 爆頭倍率 */
  headshotMul: number;
  /** 每顆命中的擊退（像素） */
  knockback: number;
  /** 每顆命中的硬直（秒） */
  stagger: number;

  // ── 擊發與裝填 ──
  action: FireAction;
  /** 每秒射擊次數（全自動 = RPM / 60；泵動／栓動 = 上膛節奏） */
  fireRate: number;
  magazine: number;
  /** 彈匣槍：膛內能多一發（戰術換彈 +1） */
  chamber: boolean;
  reload: ReloadStyle;
  /** magazine：膛內還有子彈時的換彈秒數；whole：固定秒數；single：開始塞之前的準備時間 */
  reloadTime: number;
  /** magazine：打空時的換彈秒數（要多拉一次滑套／槍機） */
  reloadEmptyTime: number;
  /** single：每塞一顆的秒數 */
  perRound?: number;
  /** single：打空時，最後要拉一下泵動／槍栓的秒數 */
  rackTime?: number;
  /** single：打空時改用彈夾一次壓滿（莫辛納甘的橋夾），一次壓幾發 */
  clip?: number;

  // ── 手感 ──
  /** 基礎散射（度） */
  spread: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  /** 全速移動時額外散射（度） */
  moveSpread: number;
  /** 槍口上揚：每發往上抬幾度、最多抬幾度、每秒回正幾度 */
  climbPerShot: number;
  climbMax: number;
  climbRecover: number;
  /** 每發左右亂跳的幅度（度） */
  yawJitter: number;
  cameraKick: number;
  trauma: number;
  selfKnockback: number;
  rumbleMs: number;
  /** 拿著它的移動速度倍率（負重） */
  moveMul: number;
  /** 換到這把槍要幾秒 */
  swapTime: number;

  // ── 取得 ──
  /** 軍械庫價格（廢料），0 = 開局就有 */
  price: number;
  /** 第幾天起軍械庫才會進貨 */
  unlockDay: number;

  // ── 聲音 ──
  /** 槍聲配方（SfxBank 的 key） */
  sound: string;
  /** 每發之後的上膛聲 */
  cycleSound?: 'pump' | 'bolt';
}

export interface MeleeDef {
  kind: 'melee';
  id: string;
  name: string;
  desc: string;
  damage: number;
  damageType: DamageType;
  penetration: number;
  /** 觸及距離（腳底水平距離，像素） */
  reach: number;
  /** 揮擊的扇形角度（度）：越大越容易一次掃到好幾隻 */
  arc: number;
  /** 一次最多打中幾隻 */
  maxTargets: number;
  /** 起手、判定、收招秒數；判定期間打到才算 */
  windup: number;
  active: number;
  recovery: number;
  /** 每揮一次耗多少體力（滿 100） */
  stamina: number;
  knockback: number;
  stagger: number;
  /** 打中已經硬直的霧屍時的倍率（處決） */
  staggerBonus: number;
  /** 連段：連續揮擊時第幾下有加成（0 = 沒有連段） */
  comboEvery: number;
  comboMul: number;
  /** 命中時的卡肉（毫秒）與鏡頭震動 */
  hitStop: number;
  trauma: number;
  /** 揮擊時往前踏步（像素 / 秒） */
  lunge: number;
  price: number;
  unlockDay: number;
  /** 揮擊軌跡顏色 */
  trailColor: number;
  /** 揮擊音：輕／重 */
  swing: 'light' | 'heavy';
}

export type WeaponDef = FirearmDef | MeleeDef;

// 小工具：大部分槍共用的預設值，個別型號只寫不同的地方
const base = {
  kind: 'firearm' as const,
  pellets: 1,
  damageType: 'ballistic' as DamageType,
  pierceFalloff: 0.7,
  headshotMul: 2.5,
  stagger: 0,
  chamber: true,
  selfKnockback: 0,
  rumbleMs: 0,
  yawJitter: 0.4,
};

export const FIREARMS: FirearmDef[] = [
  {
    ...base,
    id: 'm1911',
    name: 'M1911',
    model: 'M1911A1・.45 ACP',
    cls: 'pistol',
    desc: '老兵的配槍。7 發大口徑，備彈無限，永遠的退路',
    ammo: '9mm',
    infiniteReserve: true,
    damage: 13,
    penetration: 0.15,
    pierce: 1,
    falloffStart: 200,
    falloffEnd: 420,
    falloffMin: 0.6,
    range: 480,
    knockback: 3,
    stagger: 0.05,
    action: 'semi',
    fireRate: 4.5,
    magazine: 7,
    reload: 'magazine',
    reloadTime: 1.1,
    reloadEmptyTime: 1.45,
    spread: 1.5,
    bloomPerShot: 1.4,
    bloomMax: 5,
    bloomRecover: 9,
    moveSpread: 2.2,
    climbPerShot: 1.6,
    climbMax: 5,
    climbRecover: 16,
    cameraKick: 2,
    trauma: 0.1,
    moveMul: 1,
    swapTime: 0.25,
    price: 0,
    unlockDay: 1,
    sound: 'shot_m1911',
  },
  {
    ...base,
    id: 'python',
    name: '.357 左輪',
    model: 'Colt Python・.357 Magnum',
    cls: 'revolver',
    desc: '一發一個。雙動扳機較慢、後座猛，子彈能打穿兩隻',
    ammo: '357',
    damage: 30,
    penetration: 0.45,
    pierce: 2,
    pierceFalloff: 0.75,
    falloffStart: 260,
    falloffEnd: 520,
    falloffMin: 0.7,
    range: 560,
    knockback: 8,
    stagger: 0.25,
    action: 'semi',
    fireRate: 2.2,
    magazine: 6,
    chamber: false,
    reload: 'whole',
    reloadTime: 2.1,
    reloadEmptyTime: 2.1,
    spread: 0.9,
    bloomPerShot: 2.4,
    bloomMax: 6,
    bloomRecover: 7,
    moveSpread: 2.6,
    climbPerShot: 4.5,
    climbMax: 9,
    climbRecover: 14,
    yawJitter: 0.8,
    cameraKick: 4.5,
    trauma: 0.24,
    selfKnockback: 25,
    rumbleMs: 30,
    moveMul: 1,
    swapTime: 0.3,
    price: 70,
    unlockDay: 1,
    sound: 'shot_python',
  },
  {
    ...base,
    id: 'mp5',
    name: 'MP5',
    model: 'H&K MP5A3・9mm',
    cls: 'smg',
    desc: '每分鐘 800 發但幾乎不跳，邊退邊掃最穩',
    ammo: '9mm',
    damage: 7,
    penetration: 0.1,
    pierce: 1,
    falloffStart: 160,
    falloffEnd: 380,
    falloffMin: 0.55,
    range: 440,
    knockback: 1.5,
    action: 'auto',
    fireRate: 13.3,
    magazine: 30,
    reload: 'magazine',
    reloadTime: 2.0,
    reloadEmptyTime: 2.6,
    spread: 2,
    bloomPerShot: 0.35,
    bloomMax: 4,
    bloomRecover: 10,
    moveSpread: 1,
    climbPerShot: 0.35,
    climbMax: 3,
    climbRecover: 14,
    yawJitter: 0.5,
    cameraKick: 1,
    trauma: 0.04,
    moveMul: 0.98,
    swapTime: 0.35,
    price: 90,
    unlockDay: 1,
    sound: 'shot_mp5',
  },
  {
    ...base,
    id: 'r870',
    name: '雷明頓 870',
    model: 'Remington 870・12 號',
    cls: 'shotgun',
    desc: '泵動霰彈。近距離一槍清一排；子彈一顆顆塞，隨時能開火打斷',
    ammo: '12ga',
    damage: 7,
    pellets: 8,
    damageType: 'buckshot',
    penetration: 0.05,
    pierce: 1,
    falloffStart: 80,
    falloffEnd: 260,
    falloffMin: 0.3,
    range: 320,
    headshotMul: 1.8,
    knockback: 3,
    stagger: 0.08,
    action: 'pump',
    fireRate: 1.25,
    magazine: 6,
    reload: 'single',
    reloadTime: 0.25,
    reloadEmptyTime: 0,
    perRound: 0.5,
    rackTime: 0.45,
    spread: 8,
    bloomPerShot: 2,
    bloomMax: 4,
    bloomRecover: 6,
    moveSpread: 2.5,
    climbPerShot: 5,
    climbMax: 8,
    climbRecover: 10,
    yawJitter: 1,
    cameraKick: 5,
    trauma: 0.32,
    selfKnockback: 70,
    rumbleMs: 40,
    moveMul: 0.95,
    swapTime: 0.45,
    price: 0,
    unlockDay: 1,
    sound: 'shot_r870',
    cycleSound: 'pump',
  },
  {
    ...base,
    id: 'coach',
    name: '雙管獵槍',
    model: '並排雙管・12 號',
    cls: 'shotgun',
    desc: '兩發連續轟出去，折開槍管一次裝兩發。貼臉爆發最高',
    ammo: '12ga',
    damage: 8,
    pellets: 10,
    damageType: 'buckshot',
    penetration: 0.05,
    pierce: 1,
    falloffStart: 60,
    falloffEnd: 220,
    falloffMin: 0.25,
    range: 280,
    headshotMul: 1.8,
    knockback: 4,
    stagger: 0.1,
    action: 'semi',
    fireRate: 5,
    magazine: 2,
    chamber: false,
    reload: 'whole',
    reloadTime: 1.8,
    reloadEmptyTime: 1.8,
    spread: 11,
    bloomPerShot: 2,
    bloomMax: 4,
    bloomRecover: 6,
    moveSpread: 2.5,
    climbPerShot: 7,
    climbMax: 10,
    climbRecover: 12,
    yawJitter: 1.4,
    cameraKick: 6.5,
    trauma: 0.42,
    selfKnockback: 95,
    rumbleMs: 60,
    moveMul: 0.96,
    swapTime: 0.4,
    price: 75,
    unlockDay: 1,
    sound: 'shot_coach',
  },
  {
    ...base,
    id: 'ak47',
    name: 'AK-47',
    model: 'AKM・7.62×39',
    cls: 'rifle',
    desc: '每分鐘 600 發，子彈重、穿得透，但槍口上跳很兇，要點放',
    ammo: '762',
    damage: 13,
    penetration: 0.5,
    pierce: 2,
    pierceFalloff: 0.75,
    falloffStart: 320,
    falloffEnd: 640,
    falloffMin: 0.8,
    range: 640,
    knockback: 3,
    stagger: 0.06,
    action: 'auto',
    fireRate: 10,
    magazine: 30,
    reload: 'magazine',
    reloadTime: 2.3,
    reloadEmptyTime: 2.9,
    spread: 1.6,
    bloomPerShot: 0.9,
    bloomMax: 7,
    bloomRecover: 8,
    moveSpread: 3,
    climbPerShot: 1.3,
    climbMax: 11,
    climbRecover: 9,
    yawJitter: 1.1,
    cameraKick: 2.5,
    trauma: 0.1,
    rumbleMs: 15,
    moveMul: 0.92,
    swapTime: 0.5,
    price: 140,
    unlockDay: 2,
    sound: 'shot_ak47',
  },
  {
    ...base,
    id: 'm4a1',
    name: 'M4A1',
    model: 'Colt M4A1・5.56×45',
    cls: 'rifle',
    desc: '射速快、後座小、準度高，全能但單發不如 AK',
    ammo: '556',
    damage: 10,
    penetration: 0.4,
    pierce: 2,
    falloffStart: 300,
    falloffEnd: 640,
    falloffMin: 0.75,
    range: 640,
    knockback: 2,
    stagger: 0.04,
    action: 'auto',
    fireRate: 14,
    magazine: 30,
    reload: 'magazine',
    reloadTime: 2.1,
    reloadEmptyTime: 2.6,
    spread: 0.9,
    bloomPerShot: 0.5,
    bloomMax: 4.5,
    bloomRecover: 10,
    moveSpread: 2.2,
    climbPerShot: 0.6,
    climbMax: 5,
    climbRecover: 12,
    yawJitter: 0.5,
    cameraKick: 1.6,
    trauma: 0.06,
    rumbleMs: 10,
    moveMul: 0.94,
    swapTime: 0.45,
    price: 150,
    unlockDay: 2,
    sound: 'shot_m4a1',
  },
  {
    ...base,
    id: 'mosin',
    name: '莫辛納甘',
    model: 'Mosin-Nagant M91/30・7.62×54R',
    cls: 'sniper',
    desc: '一槍貫穿整排。每發要拉栓，打空用橋夾一次壓 5 發；移動時很不準',
    ammo: '762',
    damage: 75,
    penetration: 0.85,
    pierce: 6,
    pierceFalloff: 0.85,
    falloffStart: 9999,
    falloffEnd: 10000,
    falloffMin: 1,
    range: 900,
    headshotMul: 3,
    knockback: 10,
    stagger: 0.35,
    action: 'bolt',
    fireRate: 0.9,
    magazine: 5,
    chamber: false,
    reload: 'single',
    reloadTime: 0.3,
    reloadEmptyTime: 0,
    perRound: 0.55,
    rackTime: 0.4,
    clip: 5,
    spread: 0.15,
    bloomPerShot: 3,
    bloomMax: 3,
    bloomRecover: 4,
    moveSpread: 7,
    climbPerShot: 6,
    climbMax: 6,
    climbRecover: 8,
    yawJitter: 0.2,
    cameraKick: 6,
    trauma: 0.3,
    selfKnockback: 40,
    rumbleMs: 45,
    moveMul: 0.9,
    swapTime: 0.6,
    price: 160,
    unlockDay: 3,
    sound: 'shot_mosin',
    cycleSound: 'bolt',
  },
  {
    ...base,
    id: 'm1014',
    name: 'M1014',
    model: 'Benelli M4 (M1014)・12 號',
    cls: 'shotgun',
    desc: '半自動霰彈，不用拉就能連轟；單顆彈丸較弱',
    ammo: '12ga',
    damage: 6,
    pellets: 8,
    damageType: 'buckshot',
    penetration: 0.05,
    pierce: 1,
    falloffStart: 90,
    falloffEnd: 280,
    falloffMin: 0.3,
    range: 340,
    headshotMul: 1.8,
    knockback: 2.5,
    stagger: 0.06,
    action: 'semi',
    fireRate: 3.6,
    magazine: 7,
    reload: 'single',
    reloadTime: 0.2,
    reloadEmptyTime: 0,
    perRound: 0.4,
    rackTime: 0.35,
    spread: 7.5,
    bloomPerShot: 1.6,
    bloomMax: 5,
    bloomRecover: 7,
    moveSpread: 2.5,
    climbPerShot: 4,
    climbMax: 9,
    climbRecover: 12,
    yawJitter: 1,
    cameraKick: 4.5,
    trauma: 0.26,
    selfKnockback: 50,
    rumbleMs: 35,
    moveMul: 0.94,
    swapTime: 0.45,
    price: 220,
    unlockDay: 4,
    sound: 'shot_m1014',
  },
  {
    ...base,
    id: 'm249',
    name: 'M249',
    model: 'FN M249 SAW・5.56×45',
    cls: 'lmg',
    desc: '100 發彈鏈壓制整波屍潮。很重、換彈要 5 秒多，越打越散',
    ammo: '556',
    damage: 10,
    penetration: 0.4,
    pierce: 2,
    falloffStart: 300,
    falloffEnd: 640,
    falloffMin: 0.75,
    range: 640,
    knockback: 2.5,
    stagger: 0.05,
    action: 'auto',
    fireRate: 12.5,
    magazine: 100,
    chamber: false,
    reload: 'whole',
    reloadTime: 5.5,
    reloadEmptyTime: 5.5,
    spread: 1.8,
    bloomPerShot: 0.3,
    bloomMax: 8,
    bloomRecover: 4,
    moveSpread: 6,
    climbPerShot: 0.5,
    climbMax: 6,
    climbRecover: 8,
    yawJitter: 0.9,
    cameraKick: 2,
    trauma: 0.08,
    rumbleMs: 12,
    moveMul: 0.75,
    swapTime: 0.9,
    price: 320,
    unlockDay: 5,
    sound: 'shot_m249',
  },
];

export const MELEE: MeleeDef[] = [
  {
    kind: 'melee',
    id: 'knife',
    name: '軍用刀',
    desc: '出手最快、耗體力最少，只能一次刺一隻',
    damage: 14,
    damageType: 'slash',
    penetration: 0.2,
    reach: 22,
    arc: 60,
    maxTargets: 1,
    windup: 0.04,
    active: 0.07,
    recovery: 0.17,
    stamina: 7,
    knockback: 2,
    stagger: 0.18,
    staggerBonus: 1.8,
    comboEvery: 3,
    comboMul: 1.6,
    hitStop: 25,
    trauma: 0.05,
    lunge: 40,
    price: 0,
    unlockDay: 1,
    trailColor: 0xdfe6ee,
    swing: 'light',
  },
  {
    kind: 'melee',
    id: 'machete',
    name: '開山刀',
    desc: '快又利，左右來回砍，第三刀加重',
    damage: 24,
    damageType: 'slash',
    penetration: 0.15,
    reach: 28,
    arc: 100,
    maxTargets: 2,
    windup: 0.07,
    active: 0.09,
    recovery: 0.26,
    stamina: 13,
    knockback: 4,
    stagger: 0.3,
    staggerBonus: 1.5,
    comboEvery: 3,
    comboMul: 1.5,
    hitStop: 35,
    trauma: 0.08,
    lunge: 50,
    price: 30,
    unlockDay: 1,
    trailColor: 0xc9d3dc,
    swing: 'light',
  },
  {
    kind: 'melee',
    id: 'bat',
    name: '鋁棒',
    desc: '一棒把整排打飛、打暈，傷害普通但最好控場',
    damage: 18,
    damageType: 'blunt',
    penetration: 0,
    reach: 30,
    arc: 130,
    maxTargets: 3,
    windup: 0.12,
    active: 0.12,
    recovery: 0.32,
    stamina: 18,
    knockback: 26,
    stagger: 0.75,
    staggerBonus: 1.3,
    comboEvery: 0,
    comboMul: 1,
    hitStop: 50,
    trauma: 0.14,
    lunge: 30,
    price: 25,
    unlockDay: 1,
    trailColor: 0xb8c4cf,
    swing: 'heavy',
  },
  {
    kind: 'melee',
    id: 'axe',
    name: '消防斧',
    desc: '起手慢，一斧劈開頭盔；打暈的霧屍直接處決',
    damage: 48,
    damageType: 'slash',
    penetration: 0.5,
    reach: 30,
    arc: 90,
    maxTargets: 2,
    windup: 0.2,
    active: 0.1,
    recovery: 0.42,
    stamina: 26,
    knockback: 10,
    stagger: 0.55,
    staggerBonus: 2,
    comboEvery: 0,
    comboMul: 1,
    hitStop: 70,
    trauma: 0.2,
    lunge: 45,
    price: 60,
    unlockDay: 2,
    trailColor: 0xff8a65,
    swing: 'heavy',
  },
  {
    kind: 'melee',
    id: 'sledge',
    name: '大鐵鎚',
    desc: '最慢最重，掄一圈震飛五隻，連腫脹霧屍都打得退',
    damage: 55,
    damageType: 'blunt',
    penetration: 0.3,
    reach: 32,
    arc: 160,
    maxTargets: 5,
    windup: 0.36,
    active: 0.14,
    recovery: 0.58,
    stamina: 38,
    knockback: 42,
    stagger: 1.2,
    staggerBonus: 1.3,
    comboEvery: 0,
    comboMul: 1,
    hitStop: 95,
    trauma: 0.35,
    lunge: 25,
    price: 110,
    unlockDay: 3,
    trailColor: 0x90a4ae,
    swing: 'heavy',
  },
];

/** 體力（近戰用） */
export const STAMINA = {
  max: 100,
  /** 每秒回復 */
  regen: 30,
  /** 揮完多久才開始回 */
  regenDelay: 0.6,
  /** 體力不夠時照樣能揮，但變慢、變弱 */
  tiredSpeed: 1.5,
  tiredDamage: 0.5,
};

/** 爆頭傷害倍率（舊介面：夥伴、砲塔仍在用） */
export const HEADSHOT_MULTIPLIER = 2.5;

/** 開局的武器 */
export const START_LOADOUT = { guns: ['m1911', 'r870'], melee: 'knife' };
/** 最多帶幾把槍上場（1/2/3 鍵切換） */
export const MAX_GUNS = 3;

const ALL: Record<string, WeaponDef> = Object.fromEntries([...FIREARMS, ...MELEE].map((w) => [w.id, w]));

export function getWeapon(id: string): WeaponDef | undefined {
  return ALL[id];
}

export function getFirearm(id: string): FirearmDef | undefined {
  const w = ALL[id];
  return w?.kind === 'firearm' ? w : undefined;
}

export function getMelee(id: string): MeleeDef | undefined {
  const w = ALL[id];
  return w?.kind === 'melee' ? w : undefined;
}

/** 完整換彈大約要多久（HUD、換彈動畫用） */
export function fullReloadTime(def: FirearmDef, loaded: number): number {
  if (def.reload !== 'single') return loaded > 0 && def.chamber ? def.reloadTime : def.reloadEmptyTime;
  if (loaded === 0 && def.clip) return def.reloadTime + def.perRound! * 2 + def.rackTime!;
  return def.reloadTime + def.perRound! * (def.magazine - loaded) + (loaded === 0 ? def.rackTime ?? 0 : 0);
}

/**
 * 夥伴拿這把槍時的數值。夥伴不吃彈藥、不會打斷換彈，所以把操作細節攤平成平均值；
 * 傷害略低於玩家（打折 0.8），避免 AI 比玩家還會打。
 */
export function companionGunFor(id: string): CompanionGunDef {
  const d = getFirearm(id) ?? FIREARMS[0];
  return {
    weaponId: d.id,
    damage: Math.round(d.damage * d.pellets * 0.8 * 10) / 10,
    // 全自動 AI 打短點放，射速打 6 折
    fireRate: d.action === 'auto' ? d.fireRate * 0.6 : d.fireRate * 0.85,
    magazine: d.magazine,
    reloadTime: fullReloadTime(d, 0),
    range: Math.min(d.range, d.cls === 'shotgun' ? 160 : d.cls === 'sniper' ? 420 : 320),
    spread: d.spread + d.bloomMax * 0.4,
    headChance: d.cls === 'sniper' ? 0.45 : d.cls === 'shotgun' ? 0.05 : 0.18,
    knockback: d.knockback * Math.min(3, d.pellets),
  };
}
