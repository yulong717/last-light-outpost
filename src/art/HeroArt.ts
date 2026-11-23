import Phaser from 'phaser';
import type { HeroId } from '../data/heroes';
import type { CrewLook, Ramp } from '../data/crewLooks';
import { paintLookTexture, paintedArmColors } from './CrewArt';
import { Part, type Decorator } from './crewPaint';
import { stripArms } from './WeaponArt';
import type { RigColors } from '../entities/WeaponRig';

/**
 * 三位主角各自的像素形象（不再共用同一張圖染色）。
 * 用隊員底圖（PixelLab 重畫的不同人）當身體，固定外觀，再加上只有主角才有的細節：
 * - 阿凱：棒球隊白色條紋球衣、背號 7、深藍球帽、紅色護腕
 * - 馬克：迷彩軍裝、戰術背心、夜視鏡座、無線電天線、臂章
 * - 好運姐：酒紅大波浪長髮、豹紋外套、金耳環金項鍊、紅唇
 * 圖在開場（BootScene）畫一次，key 是 hero_<id>，擦掉手臂的身體是 hero_<id>_body。
 */

interface HeroLook {
  look: CrewLook;
  extraHair?: boolean;
  decorate?: (d: Decorator) => void;
}

const base = (o: Partial<CrewLook>): CrewLook => ({
  skin: 0,
  hair: 0,
  hairStyle: 'short',
  band: null,
  jacket: 0,
  pattern: 'plain',
  pants: 2,
  boots: 0,
  kneePads: true,
  head: null,
  headColor: 2,
  face: [],
  body: [],
  gearColor: 3,
  build: { w: 1, h: 1 },
  ...o,
});

const RED: Ramp = [0x4a0a0e, 0x8e1a1e, 0xc8302e, 0xee5a4a];
const GOLD: Ramp = [0x5a3a08, 0xa07418, 0xe0b22e, 0xfff0a0];
const WINE: Ramp = [0x3a0a12, 0x6e1626, 0xa02a3a, 0xd05060];
const LEOPARD: Ramp = [0x6a4214, 0xa06a24, 0xd09a3a, 0xf0c66a];
const OD: Ramp = [0x101408, 0x22280e, 0x3a4220, 0x5a6236];

/** 簡單雜湊：豹紋斑點、迷彩用 */
const hash = (x: number, y: number, s: number): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export const HERO_LOOKS: Record<HeroId, HeroLook> = {
  // ── 阿凱：高中棒球隊 ─────────────────────────
  student: {
    look: base({
      base: 'teen',
      recolor: { hair: true, top: true, bottom: true },
      hair: 0,
      skin: 0,
      jacket: 13, // 白色球衣
      pants: 2,
      head: 'cap',
      headColor: 2,
      widen: -1,
      build: { w: 0.96, h: 0.97 },
    }),
    decorate: (d) => {
      // 球衣深藍細條紋
      d.eachPart(Part.Jacket, (x, _y, lum) => (x % 3 === 0 && lum > 70 ? 0x7a8cc0 : null));
      // 胸前背號 7（紅字白底）
      d.draw({ x: 25, y: 31, rows: ['44444', '....4', '...4.', '..4..', '..4..'] }, RED);
      // 紅色腰帶
      d.eachPart(Part.Pants, (_x, y, lum) => (y === 45 ? (lum > 60 ? RED[2] : RED[1]) : null));
      // 帽子上的白色隊徽
      d.draw({ x: 30, y: 7, rows: ['44', '44'] }, [0xffffff, 0xffffff, 0xffffff, 0xf4f4f4]);
    },
  },
  // ── 馬克：特種兵 ────────────────────────────
  soldier: {
    look: base({
      base: 'soldier',
      recolor: { hair: false, top: false, bottom: false },
      skin: 1,
      body: ['vest', 'bandolier'],
      gearColor: 5,
      face: ['stubble'],
      widen: 1,
      build: { w: 1.04, h: 1.04 },
    }),
    decorate: (d) => {
      // 夜視鏡座（頭盔正面）
      d.draw({ x: 33, y: 6, rows: ['oooo.', 'o12oo', 'o1221', 'oooo.'] }, OD);
      // 背後的無線電天線
      d.draw({ x: 17, y: 12, rows: ['o', 'o', 'o', 'o', 'o', 'o', 'o', 'o', 'o', 'o', 'o', 'o', 'oo', 'oo'] }, OD, 'behind');
      // 臂章（肩膀）
      d.draw({ x: 21, y: 29, rows: ['oooo', 'o34o', 'o43o', 'oooo'] }, RED);
    },
  },
  // ── 好運姐：夜市彩券行老闆娘 ──────────────────
  lucky: {
    look: base({
      base: 'punk',
      recolor: { hair: true, top: true, bottom: true },
      hair: 3, // 之後在 decorate 裡把挑染也改成酒紅
      hairStyle: 'long',
      skin: 4,
      jacket: 11, // 芥末黃，再印豹紋
      pants: 5,
      widen: -1,
      build: { w: 0.95, h: 0.95 },
    }),
    extraHair: true,
    decorate: (d) => {
      // 皮衣上原本的桃紅挑染、粉紅眼影改成酒紅髮色／深棕
      d.eachPart(Part.Detail, (x, y, lum) => {
        if (y < 17 || x < 26) return WINE[Math.min(3, Math.floor(lum / 64))];
        return 0x3a1a10;
      });
      // 豹紋外套：先把皮衣提亮成金棕色，再印深色斑點
      d.eachPart(Part.Jacket, (x, y, lum) => {
        const cx = x >> 2;
        const cy = y >> 2;
        const ox = (cx << 2) + Math.floor(hash(cx, cy, 3) * 2);
        const oy = (cy << 2) + Math.floor(hash(cx, cy, 5) * 2);
        const dx = x - ox;
        const dy = y - oy;
        const spot = hash(cx, cy, 7) > 0.2 && dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
        if (spot) return (dx + dy) % 2 === 0 ? 0x2a1606 : 0x4a2a0c;
        return LEOPARD[Math.min(3, Math.floor(lum / 30))];
      });
      // 金項鍊
      for (let x = 26; x <= 32; x++) d.dot(x, 27 + (x === 29 ? 1 : 0), x % 2 ? GOLD[2] : GOLD[3]);
      d.dot(29, 29, GOLD[2]);
      // 金耳環（大圈）
      d.draw({ x: 22, y: 21, rows: ['.3.', '3.3', '.3.'] }, GOLD);
      // 紅唇
      d.dot(33, 25, 0xd0283a);
      d.dot(34, 25, 0xb01c2e);
      // 髮上的紅色髮夾（招財）
      d.draw({ x: 30, y: 7, rows: ['oo', '34', 'oo'] }, RED);
    },
  },
};

export const heroTextureKey = (id: HeroId): string => `hero_${id}`;

/** 畫好三位主角（BootScene 呼叫一次） */
export function createHeroTextures(scene: Phaser.Scene): void {
  for (const id of Object.keys(HERO_LOOKS) as HeroId[]) ensureHeroTexture(scene, id);
}

/** 主角的完整圖（含原本的手，選角畫面用）；畫不出來時回傳 null */
export function ensureHeroTexture(scene: Phaser.Scene, id: HeroId): string | null {
  const key = heroTextureKey(id);
  const h = HERO_LOOKS[id];
  if (!h) return null;
  return paintLookTexture(scene, key, h.look, { extraHair: h.extraHair, decorate: h.decorate }) ? key : null;
}

/** 主角的身體圖（擦掉手臂，手與武器由 WeaponRig 畫） */
export function heroBodyTexture(scene: Phaser.Scene, id: HeroId): string | null {
  const key = ensureHeroTexture(scene, id);
  return key ? stripArms(scene, key) : null;
}

/** 主角手臂的袖子與膚色 */
export function heroRigColors(id: HeroId): RigColors | undefined {
  return paintedArmColors(heroTextureKey(id));
}

/** 主角的體型縮放 */
export function heroBuild(id: HeroId): { w: number; h: number } {
  return HERO_LOOKS[id]?.look.build ?? { w: 1, h: 1 };
}
