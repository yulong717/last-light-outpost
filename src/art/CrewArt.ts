import Phaser from 'phaser';
import type { CrewMember } from '../data/companions';
import { paintCrewSheet, type Pixels } from './crewPaint';

/**
 * 把隊員的外觀畫成專屬精靈圖（Phaser 貼圖 crew_<id>），並建立對應的射擊動畫。
 * 原圖：主角射擊圖 'player' + 部位遮罩 'player_regions'（BootScene 載入）。
 * 同一位隊員只畫一次，之後重複使用。
 */
const FRAME = 64;
const cache = new WeakMap<Phaser.Textures.TextureManager, { src: Pixels; mask: Pixels }>();

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

function sources(scene: Phaser.Scene): { src: Pixels; mask: Pixels } | null {
  const tm = scene.textures;
  const hit = cache.get(tm);
  if (hit) return hit;
  if (!tm.exists('player') || !tm.exists('player_regions')) return null;
  if (tm.get('player').frameTotal <= 2) return null; // 只有色塊佔位圖
  const src = readPixels(tm.get('player'));
  const mask = readPixels(tm.get('player_regions'));
  if (!src || !mask || src.width !== mask.width || src.height !== mask.height) return null;
  const pair = { src, mask };
  cache.set(tm, pair);
  return pair;
}

export const crewTextureKey = (m: CrewMember): string => `crew_${m.id}`;
export const crewShootAnim = (m: CrewMember): string => `${crewTextureKey(m)}_shoot`;

/** 產生（或取用已產生的）隊員貼圖；原圖不存在時回傳 null，呼叫端改用染色的主角圖 */
export function ensureCrewTexture(scene: Phaser.Scene, m: CrewMember): string | null {
  const key = crewTextureKey(m);
  if (scene.textures.exists(key)) return key;
  const s = sources(scene);
  if (!s || !m.look) return null;
  const out = paintCrewSheet(s.src, s.mask, m.look, { frameSize: FRAME });
  const tex = scene.textures.createCanvas(key, out.width, out.height);
  if (!tex) return null;
  const ctx = tex.getContext();
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
  const frames = Math.floor(out.width / FRAME);
  for (let i = 0; i < frames; i++) tex.add(i, 0, i * FRAME, 0, FRAME, FRAME);
  tex.refresh();
  if (frames > 2 && !scene.anims.exists(crewShootAnim(m))) {
    scene.anims.create({ key: crewShootAnim(m), frames: scene.anims.generateFrameNumbers(key, { frames: [1, 2, 0] }), frameRate: 20 });
  }
  return key;
}
