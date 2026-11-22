import type { BodyType } from './crewBody';

/**
 * 隊員底圖：每張都是 PixelLab 依主角姿勢重畫的不同人（臉、髮型、服裝都不一樣）。
 * 圖在 public/assets/sprites/crew_bases.png（橫排 64×64），部位遮罩在 crew_bases_regions.png，
 * 由 tools/art/make_crew_bases.py 產生。這裡的順序必須和腳本裡的 BASES 一致。
 *
 * 換色：膚色一定換；頭髮、上衣、褲子視底圖與個人隨機決定要不要換（制服類保留原色才認得出來）。
 * 體型：底圖輪廓都一樣，胖瘦、啤酒肚、駝背、高矮由 crewPaint.ts 用像素位移做。
 */
export interface CrewBaseDef {
  id: string;
  name: string;
  /** 頭上本來就戴帽子（警帽、工地帽、軍盔）：不換髮色、不再疊帽子 */
  hat?: boolean;
  /** 招牌髮色（龐克頭）：不換 */
  keepHair?: boolean;
  /** 制服：上衣褲子都保留原色 */
  uniform?: boolean;
  /** 長者：會駝背 */
  old?: boolean;
  /** 出身的出現權重倍率（沒寫 = 1） */
  bg?: Record<string, number>;
  /** 體型的出現權重倍率（胖子底圖偏壯碩、巨漢） */
  body?: Partial<Record<BodyType, number>>;
  /** 本身就是胖子：再加一點啤酒肚 */
  belly?: number;
  /** 無袖（背心）：手臂畫成皮膚 */
  bareArms?: boolean;
}

export const CREW_BASES: CrewBaseDef[] = [
  { id: 'trench', name: '長大衣', old: true, bg: { hunter: 2, clerk: 1.5, doctor: 1.2 } },
  { id: 'hoodie', name: '紅帽T', bg: { student: 3, athlete: 1.5, nurse: 1.2 } },
  { id: 'bruiser', name: '刺青背心', bareArms: true, bg: { gangster: 3, fighter: 2.5, laborer: 2 }, body: { stocky: 2, hulk: 2, slim: 0.3 } },
  { id: 'teen', name: '綠帽T短褲', bg: { student: 4, athlete: 1.5 }, body: { slim: 2, hulk: 0.2 } },
  { id: 'doctor', name: '白袍', uniform: true, bg: { doctor: 8, nurse: 4 } },
  { id: 'police', name: '警察制服', hat: true, uniform: true, bg: { police: 10, veteran: 0.5 } },
  { id: 'worker', name: '工地反光背心', hat: true, uniform: true, bg: { laborer: 8, mechanic: 3 } },
  { id: 'granny', name: '毛衣長者', old: true, bg: { nurse: 1.5, clerk: 1.2, doctor: 1.2 }, body: { hulk: 0.2, athletic: 0.4 } },
  { id: 'punk', name: '龐克皮衣', keepHair: true, bg: { gangster: 4, student: 1.5, fighter: 1.2 } },
  { id: 'soldier', name: '迷彩軍裝', hat: true, uniform: true, bg: { veteran: 10, hunter: 1 } },
  { id: 'office', name: '襯衫領帶', uniform: true, bg: { clerk: 8, doctor: 1.2 } },
  { id: 'track', name: '運動外套', bg: { athlete: 6, student: 2, fighter: 1.5 }, body: { athletic: 2 } },
  { id: 'overalls', name: '吊帶工作褲', bg: { mechanic: 5, laborer: 3 }, body: { stocky: 1.5 } },
  { id: 'oldcoat', name: '舊外套', bg: { clerk: 1.5, hunter: 1.2, mechanic: 1.2 } },
  { id: 'fatman', name: '黃T胖子', belly: 2, bg: { mechanic: 1.5, clerk: 1.5, laborer: 1.2 }, body: { stocky: 3, hulk: 2, slim: 0, athletic: 0.3 } },
  { id: 'tinyold', name: '開襟衫長者', old: true, bg: { nurse: 1.5, hunter: 1.2, clerk: 1.2 }, body: { hulk: 0.1, athletic: 0.3 } },
  { id: 'tall', name: '棕夾克', bg: { hunter: 2.5, student: 1.2, mechanic: 1.2 }, body: { slim: 2 } },
  { id: 'muscle', name: '迷彩肌肉', bareArms: true, bg: { veteran: 3, fighter: 4, laborer: 1.5 }, body: { athletic: 2, hulk: 2.5, slim: 0 } },
];

export const CREW_BASE_INDEX: Record<string, number> = Object.fromEntries(CREW_BASES.map((b, i) => [b.id, i]));

export function crewBase(id: string | undefined): CrewBaseDef | undefined {
  return id === undefined ? undefined : CREW_BASES[CREW_BASE_INDEX[id]];
}

/** 依出身與體型挑底圖的權重 */
export function baseWeight(b: CrewBaseDef, background: string | undefined, body: BodyType | undefined): number {
  // 制服只給對應出身的人（護理師不會穿警察制服）
  const bg = background ? b.bg?.[background] ?? (b.uniform ? 0.05 : 1) : 1;
  const bd = body ? b.body?.[body] ?? 1 : 1;
  return bg * bd;
}
