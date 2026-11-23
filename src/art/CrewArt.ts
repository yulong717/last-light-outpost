import Phaser from 'phaser';
import type { CrewMember } from '../data/companions';
import { CREW_BASE_INDEX } from '../data/crewBases';
import { cropFrame, paintCrewSheet, type PaintOptions, type PaintedCrew, type Pixels } from './crewPaint';
import type { CrewLook } from '../data/crewLooks';

/**
 * 把隊員的外觀畫成專屬精靈圖（Phaser 貼圖 crew_<id>）。
 * 有底圖（look.base）：從 'crew_bases' 取那個人的那一格，依 'crew_bases_regions' 換色、疊配件。
 * 沒有底圖（極舊的存檔還沒升級時）：用主角射擊圖 'player' + 'player_regions' 換裝。
 * 同一位隊員只畫一次，之後重複使用。
 */
const FRAME = 64;
interface Sources {
  player: { src: Pixels; mask: Pixels } | null;
  bases: { src: Pixels; mask: Pixels } | null;
}
const cache = new WeakMap<Phaser.Textures.TextureManager, Sources>();
const armColors = new Map<string, PaintedCrew['colors']>();

function readPixels(tex: Phaser.Textures.Texture): Pixels | null {
  const img = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  if (!img || !img.width) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  return { width: d.width, height: d.height, data: d.data };
}

function pair(tm: Phaser.Textures.TextureManager, srcKey: string, maskKey: string): { src: Pixels; mask: Pixels } | null {
  if (!tm.exists(srcKey) || !tm.exists(maskKey)) return null;
  const src = readPixels(tm.get(srcKey));
  const mask = readPixels(tm.get(maskKey));
  if (!src || !mask || src.width !== mask.width || src.height !== mask.height || src.width < FRAME) return null;
  return { src, mask };
}

function sources(scene: Phaser.Scene): Sources {
  const tm = scene.textures;
  const hit = cache.get(tm);
  if (hit) return hit;
  const playerOk = tm.exists('player') && tm.get('player').frameTotal > 2; // 只有色塊佔位圖時不用
  const s: Sources = {
    player: playerOk ? pair(tm, 'player', 'player_regions') : null,
    bases: pair(tm, 'crew_bases', 'crew_bases_regions'),
  };
  cache.set(tm, s);
  return s;
}

export const crewTextureKey = (m: CrewMember): string => `crew_${m.id}`;
export const crewShootAnim = (m: CrewMember): string => `${crewTextureKey(m)}_shoot`;

/** 隊員手臂（WeaponRig）用的袖子與膚色；要先 ensureCrewTexture */
export function crewArmColors(m: CrewMember): PaintedCrew['colors'] | undefined {
  return armColors.get(crewTextureKey(m));
}

/** 產生（或取用已產生的）隊員貼圖；原圖不存在時回傳 null，呼叫端改用染色的主角圖 */
export function ensureCrewTexture(scene: Phaser.Scene, m: CrewMember): string | null {
  const key = crewTextureKey(m);
  if (scene.textures.exists(key)) return key;
  if (!m.look) return null;
  const ok = paintLookTexture(scene, key, m.look);
  if (ok && !scene.anims.exists(crewShootAnim(m)) && scene.textures.get(key).frameTotal > 3) {
    scene.anims.create({ key: crewShootAnim(m), frames: scene.anims.generateFrameNumbers(key, { frames: [1, 2, 0] }), frameRate: 20 });
  }
  return ok ? key : null;
}

/** 依外觀畫一張橫排 64×64 精靈圖（隊員、主角共用）；成功回傳 true */
export function paintLookTexture(scene: Phaser.Scene, key: string, look: CrewLook, opt: Omit<PaintOptions, 'frameSize'> = {}): boolean {
  if (scene.textures.exists(key)) return true;
  const s = sources(scene);
  const bi = look.base !== undefined ? CREW_BASE_INDEX[look.base] : undefined;
  let out: PaintedCrew;
  if (bi !== undefined && s.bases && (bi + 1) * FRAME <= s.bases.src.width) {
    out = paintCrewSheet(cropFrame(s.bases.src, bi), cropFrame(s.bases.mask, bi), look, { ...opt, frameSize: FRAME });
  } else if (s.player) {
    out = paintCrewSheet(s.player.src, s.player.mask, { ...look, base: undefined }, { ...opt, frameSize: FRAME });
  } else return false;
  armColors.set(key, out.colors);
  const tex = scene.textures.createCanvas(key, out.width, out.height);
  if (!tex) return false;
  const ctx = tex.getContext();
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  const frames = Math.floor(out.width / FRAME);
  for (let i = 0; i < frames; i++) tex.add(i, 0, i * FRAME, 0, FRAME, FRAME);
  tex.refresh();
  return true;
}

/** paintLookTexture 畫好的圖的袖子與膚色（WeaponRig 用） */
export function paintedArmColors(key: string): PaintedCrew['colors'] | undefined {
  return armColors.get(key);
}
