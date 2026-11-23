/**
 * 傷害與護甲的共用介面：槍械、近戰、砲塔、陷阱打到霧屍時都用這套規則。
 *
 * - 武器提供 DamageInfo（多少傷害、什麼類型、穿甲多少、擊退與硬直）
 * - 霧屍個體身上有 ArmorProfile（頭盔、防彈背心……由霧屍職業／隨機配件產生）
 * - resolveDamage() 算出實際扣血
 *
 * 平衡原則：穿甲（penetration）抵銷護甲；鈍器會震傷，無視部分護甲；
 * 刀刃砍在護甲上會被擋掉更多。所以重甲霧屍要用步槍彈、狙擊或鈍器處理。
 */

export type DamageType =
  /** 一般子彈（手槍、步槍、機槍） */
  | 'ballistic'
  /** 霰彈彈丸：近距離很痛，護甲效果加倍 */
  | 'buckshot'
  /** 刀刃：開山刀、斧頭、刀 */
  | 'slash'
  /** 鈍器：球棒、大鎚；無視部分護甲、擊退與硬直強 */
  | 'blunt'
  /** 爆炸（腫脹霧屍爆開）：不分頭身 */
  | 'blast';

export type DamageSource = 'player' | 'ally' | 'turret' | 'trap';

export interface DamageInfo {
  /** 基礎傷害（已乘上爆頭、距離衰減等武器端的倍率） */
  amount: number;
  type: DamageType;
  /** 穿甲 0..1：抵銷同等數值的護甲 */
  penetration: number;
  /** 擊退距離（像素） */
  knockback: number;
  /** 硬直秒數：期間霧屍不能移動、不能攻擊 */
  stagger: number;
  headshot: boolean;
  /** 攻擊方向的 x 分量（-1..1） */
  dirX: number;
  source: DamageSource;
  weaponId?: string;
  /** 打中的高度（世界 y）：決定斷手還是斷腳；不填就隨機 */
  hitY?: number;
  /** 重擊（近戰收尾、衝刺打、處決）：斷肢機率提高、擊殺時可能炸頭 */
  heavy?: boolean;
}

/** 霧屍個體的護甲（0..1 = 減傷比例） */
export interface ArmorProfile {
  /** 身體護甲（防彈背心、消防衣） */
  body: number;
  /** 頭部護甲（頭盔）；沒有就用 body */
  head?: number;
}

/** 各傷害類型對護甲的係數：>1 代表護甲對它更有效 */
const ARMOR_FACTOR: Record<DamageType, number> = {
  ballistic: 1,
  buckshot: 1.5,
  slash: 1.25,
  blunt: 0.7,
  blast: 0.5,
};

/**
 * 單一護甲部位（頭盔、背心、天生減傷）實際擋下的比例：
 * 原始護甲 × 傷害類型係數 − 穿甲，夾在 0..0.9。霧屍的 mitigate() 與子彈穿透判定都用它。
 */
export function armorAfter(raw: number, type: string | undefined, penetration = 0): number {
  const k = ARMOR_FACTOR[(type ?? 'ballistic') as DamageType] ?? 1;
  return Math.max(0, Math.min(0.9, Math.min(1, raw * k) - penetration));
}

/** 這一擊打到的部位實際有多少護甲（已扣掉穿甲），0..1 */
export function effectiveArmor(info: Pick<DamageInfo, 'type' | 'penetration' | 'headshot'>, armor?: ArmorProfile): number {
  if (!armor) return 0;
  const raw = info.headshot ? (armor.head ?? armor.body) : armor.body;
  return armorAfter(raw, info.type, info.penetration);
}

/** 實際扣血。護甲最多擋 90%，永遠至少扣 1 點。 */
export function resolveDamage(info: Pick<DamageInfo, 'amount' | 'type' | 'penetration' | 'headshot'>, armor?: ArmorProfile): number {
  const a = effectiveArmor(info, armor);
  return Math.max(1, info.amount * (1 - a));
}

/**
 * 子彈打穿這個目標後還能不能繼續飛：剩餘護甲太高就停住。
 * 穿甲高的步槍彈可以一路穿過好幾隻；手槍彈碰到防彈背心就停。
 */
export function bulletStops(info: Pick<DamageInfo, 'type' | 'penetration' | 'headshot'>, armor?: ArmorProfile): boolean {
  return effectiveArmor(info, armor) >= 0.3;
}
