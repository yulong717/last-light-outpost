import type { CompanionRole } from './companions';

/**
 * 隊員外觀的零件表：膚色、髮色、布料顏色、髮型、帽子、臉部配件、身上配件。
 * 實際畫法在 src/art/crewPaint.ts；這裡只放「有哪些」與「各職業多常出現」。
 *
 * 顏色都是 4 階色帶（暗 → 亮），換色時依原圖明暗對應過去，保留 PixelLab 原圖的髒污與陰影細節。
 */
export type Ramp = readonly [number, number, number, number];

export const SKIN_TONES: Ramp[] = [
  [0x5a3020, 0x9a5a3a, 0xd89a72, 0xf2c6a4], // 原圖
  [0x4a2a1c, 0x86503a, 0xc4865e, 0xe2ae86],
  [0x3a1f14, 0x6a3a24, 0x9e6440, 0xc48a62],
  [0x2a1610, 0x4e2a1a, 0x7a4a30, 0x9c6a4a],
  [0x6a4030, 0xb07a5a, 0xecc0a0, 0xfde2cc],
];

export const HAIR_COLORS: { name: string; ramp: Ramp; weight: number }[] = [
  { name: '黑', ramp: [0x0e0e10, 0x1c1c1e, 0x2e2e30, 0x48484a], weight: 6 },
  { name: '深棕', ramp: [0x1e120a, 0x3a2414, 0x5a3a22, 0x7a5434], weight: 5 },
  { name: '棕', ramp: [0x2e1a0c, 0x5c3618, 0x8a5a2c, 0xb07c44], weight: 3 },
  { name: '紅', ramp: [0x3a120a, 0x7a2a12, 0xb0461e, 0xd8703a], weight: 1 },
  { name: '金', ramp: [0x5a4018, 0x9a7a34, 0xd2b25a, 0xf0dc94], weight: 1.5 },
  { name: '灰白', ramp: [0x3a3a3e, 0x6e6e74, 0xa6a6ac, 0xd8d8dc], weight: 1.5 },
  { name: '染藍', ramp: [0x0e1a3a, 0x1e3a7a, 0x3a64b4, 0x6a98e0], weight: 0.4 },
  { name: '染粉', ramp: [0x4a1a32, 0x8a3462, 0xc85a92, 0xee94c0], weight: 0.3 },
];

/** 衣服、帽子、背心共用的布料色 */
export const CLOTH: { name: string; ramp: Ramp }[] = [
  { name: '鏽橘', ramp: [0x3e1c0e, 0x6e3418, 0x9c5632, 0xc07a4e] }, // 0 原圖夾克
  { name: '橄欖綠', ramp: [0x1e2414, 0x384426, 0x56663a, 0x7a8a54] }, // 1
  { name: '海軍藍', ramp: [0x10162a, 0x1e2a4a, 0x34466e, 0x50648e] }, // 2
  { name: '炭灰', ramp: [0x161618, 0x2a2a2e, 0x44444a, 0x62626a] }, // 3
  { name: '丹寧', ramp: [0x142036, 0x26406a, 0x3e6096, 0x6688b8] }, // 4
  { name: '黑皮', ramp: [0x0c0a0a, 0x1c1816, 0x302a26, 0x4a423c] }, // 5
  { name: '格紋紅', ramp: [0x2e0a0a, 0x621818, 0x942a24, 0xbc4a3a] }, // 6
  { name: '卡其', ramp: [0x3a3020, 0x66563a, 0x928058, 0xb8a87c] }, // 7
  { name: '酒紅', ramp: [0x220a12, 0x441424, 0x6a2236, 0x8e3a4e] }, // 8
  { name: '墨綠', ramp: [0x0c1e1a, 0x18382e, 0x285446, 0x407462] }, // 9
  { name: '米白', ramp: [0x5a564c, 0x8e887a, 0xbab4a4, 0xe0dccc] }, // 10
  { name: '芥末黃', ramp: [0x3e300a, 0x6e5614, 0xa07e22, 0xc8a43a] }, // 11
  { name: '螢光橘', ramp: [0x6a2a00, 0xc25200, 0xf47a10, 0xffa040] }, // 12（反光背心）
  { name: '醫療白', ramp: [0x6a6e72, 0xa4a8ac, 0xd4d8da, 0xf4f6f6] }, // 13
  { name: '工地黃', ramp: [0x5a4000, 0xa07400, 0xe0aa10, 0xffd24a] }, // 14
];

export const JACKET_COLORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const PANTS_COLORS = [1, 2, 3, 4, 5, 7, 9];
export const BOOT_COLORS: Ramp[] = [
  [0x120c08, 0x2a1c14, 0x46302a, 0x5e463a], // 棕
  [0x0a0a0a, 0x18181a, 0x2a2a2c, 0x3e3e42], // 黑
  [0x2a1c0c, 0x5a3c1c, 0x86602e, 0xa88048], // 沙色
];

export type JacketPattern = 'plain' | 'plaid' | 'camo';
export type HairStyle = 'messy' | 'short' | 'long' | 'ponytail' | 'mohawk' | 'shaved';
export type HeadGearId = 'cap' | 'beanie' | 'helmet' | 'hardhat' | 'bucket' | 'cowboy';
export type FaceGearId = 'glasses' | 'sunglasses' | 'goggles' | 'eyepatch' | 'mask' | 'beard' | 'stubble' | 'bandage' | 'cigarette';
export type BodyGearId = 'vest' | 'hivis' | 'armband' | 'toolbelt' | 'bandolier' | 'backpack' | 'scarf';

/** 一個人的完整外觀（存進存檔，之後調整零件表也不會讓老隊員變臉） */
export interface CrewLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** 頭帶顏色（CLOTH 索引）；null = 不綁頭帶 */
  band: number | null;
  jacket: number;
  pattern: JacketPattern;
  pants: number;
  boots: number;
  kneePads: boolean;
  head: HeadGearId | null;
  headColor: number;
  face: FaceGearId[];
  body: BodyGearId[];
  /** 背心、背包、圍巾等配件的顏色 */
  gearColor: number;
  /** 體型：寬、高的縮放（1 = 原圖） */
  build: { w: number; h: number };
  /** 體格：軀幹加寬幾格像素（負數變窄）；舊存檔沒有就是 0 */
  widen?: number;
  /** 底圖（src/data/crewBases.ts 的 id）；沒有 = 用主角圖換裝（最早的存檔） */
  base?: string;
  /** 底圖上哪些部位要換色（沒換就保留底圖原本的顏色） */
  recolor?: { hair: boolean; top: boolean; bottom: boolean };
  /** 啤酒肚：肚子往前凸幾格（0～4） */
  belly?: number;
  /** 駝背：頭往前低幾格（0～2） */
  hunch?: number;
}

type RoleWeights = Partial<Record<CompanionRole, number>>;

export interface GearDef<T extends string> {
  id: T;
  name: string;
  /** 基本出現權重 */
  weight: number;
  /** 各職業的額外權重倍率 */
  roles?: RoleWeights;
  /** 預設顏色候選（CLOTH 索引） */
  colors?: number[];
}

export const HAIR_STYLES: GearDef<HairStyle>[] = [
  { id: 'messy', name: '亂髮', weight: 4 },
  { id: 'short', name: '短髮', weight: 4 },
  { id: 'shaved', name: '平頭', weight: 2 },
  { id: 'long', name: '長髮', weight: 2.5 },
  { id: 'ponytail', name: '馬尾', weight: 2.5 },
  { id: 'mohawk', name: '龐克頭', weight: 0.8 },
];

export const HEAD_GEAR: GearDef<HeadGearId>[] = [
  { id: 'cap', name: '棒球帽', weight: 3, roles: { shooter: 1.5 }, colors: [1, 2, 3, 6, 7, 11] },
  { id: 'beanie', name: '毛帽', weight: 3, colors: [1, 2, 3, 6, 8, 9, 11] },
  { id: 'helmet', name: '軍盔', weight: 1.5, roles: { shooter: 2.5, medic: 0.5 }, colors: [1, 3, 7] },
  { id: 'hardhat', name: '工地帽', weight: 0.6, roles: { engineer: 8 }, colors: [14, 12, 10] },
  { id: 'bucket', name: '漁夫帽', weight: 1.5, colors: [1, 7, 10, 9] },
  { id: 'cowboy', name: '牛仔帽', weight: 0.8, colors: [7, 5, 0] },
];
/** 不戴帽子的權重 */
export const NO_HAT_WEIGHT = 7;

export const FACE_GEAR: GearDef<FaceGearId>[] = [
  { id: 'glasses', name: '眼鏡', weight: 1.2, roles: { medic: 2, engineer: 1.5 } },
  { id: 'sunglasses', name: '墨鏡', weight: 1, roles: { shooter: 1.5 } },
  { id: 'goggles', name: '護目鏡', weight: 0.8, roles: { engineer: 3 } },
  { id: 'eyepatch', name: '眼罩', weight: 0.3 },
  { id: 'mask', name: '面巾', weight: 1, colors: [3, 6, 2, 1, 10] },
  { id: 'beard', name: '落腮鬍', weight: 1.2 },
  { id: 'stubble', name: '鬍渣', weight: 1.5 },
  { id: 'bandage', name: '貼布', weight: 1 },
  { id: 'cigarette', name: '香菸', weight: 0.4 },
];
export const NO_FACE_WEIGHT = 6;

export const BODY_GEAR: GearDef<BodyGearId>[] = [
  { id: 'vest', name: '戰術背心', weight: 1.5, roles: { shooter: 3 }, colors: [1, 3, 5, 7] },
  { id: 'hivis', name: '反光背心', weight: 0.4, roles: { engineer: 6 }, colors: [12, 14] },
  { id: 'armband', name: '紅十字臂章', weight: 0, roles: { medic: 1 } },
  { id: 'toolbelt', name: '工具腰帶', weight: 0.5, roles: { engineer: 5 } },
  { id: 'bandolier', name: '子彈帶', weight: 0.8, roles: { shooter: 2 } },
  { id: 'backpack', name: '背包', weight: 1.5, colors: [1, 2, 6, 7, 9, 11] },
  { id: 'scarf', name: '圍巾', weight: 1.2, colors: [6, 8, 11, 2, 10, 9] },
];

/** 互斥的身體配件（同時只能有一件） */
export const BODY_EXCLUSIVE: BodyGearId[][] = [['vest', 'hivis']];

export function roleWeight<T extends string>(g: GearDef<T>, role: CompanionRole): number {
  return g.weight * (g.roles?.[role] ?? 1) + (g.weight === 0 ? (g.roles?.[role] ?? 0) : 0);
}
