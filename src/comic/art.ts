import Phaser from 'phaser';
import { ensureComicPanel, type PanelSlot } from '../art/ComicArt';
import { ensureCinemaArt, hasCinemaArt } from '../art/CinemaArt';

/**
 * 漫畫畫格的插圖 id → 貼圖 key。
 *
 * - `qte/<事件>/<格>`：探索招牌事件的分鏡（src/art/ComicArt.ts，依區域換配色）
 * - 其他：src/art/CinemaArt.ts 的劇情插圖（序章、過場、角色介紹）
 *
 * 之後換成本地模型生成的像素插圖時：把 PNG 放進 public/ 並在 BootScene 預載成同名 key，
 * 這裡偵測到貼圖已存在就直接用，程式畫的占位圖自動退場。
 */
export function resolveComicArt(scene: Phaser.Scene, id: string, zone = 'school'): string {
  if (scene.textures.exists(id)) return id;
  if (id.startsWith('qte/')) {
    const [, comic, slot] = id.split('/');
    return ensureComicPanel(scene, comic, slot as PanelSlot, zone);
  }
  if (hasCinemaArt(id)) return ensureCinemaArt(scene, id);
  return ensureCinemaArt(scene, 'missing');
}
