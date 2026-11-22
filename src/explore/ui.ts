import Phaser from 'phaser';
import { AudioManager } from '../audio/AudioManager';
import { pixelText } from '../utils/text';

export interface ButtonOpts {
  fill?: number;
  enabled?: boolean;
  size?: number;
  /** 按鈕下方第二行小字 */
  sub?: string;
  subColor?: string;
}

/**
 * 探索畫面共用的按鈕：和白天布置介面同樣的樣式。
 * 回傳所有物件，呼叫端可以放進 container 一起清掉。
 */
export function uiButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onPress: () => void,
  o: ButtonOpts = {},
): Phaser.GameObjects.GameObject[] {
  const enabled = o.enabled ?? true;
  const fill = o.fill ?? 0x2a2f3a;
  const bg = scene.add
    .rectangle(x, y, w, h, enabled ? fill : 0x1a1c22, 0.95)
    .setOrigin(0)
    .setStrokeStyle(1, 0xffffff, enabled ? 0.5 : 0.15)
    .setDepth(100);
  const objs: Phaser.GameObjects.GameObject[] = [bg];
  const ty = o.sub ? y + h / 2 - 6 : y + h / 2;
  objs.push(pixelText(scene, x + w / 2, ty, label, o.size ?? 8, enabled ? '#ffffff' : '#6b7280').setOrigin(0.5));
  if (o.sub) objs.push(pixelText(scene, x + w / 2, y + h / 2 + 7, o.sub, 7, enabled ? o.subColor ?? '#b0bec5' : '#555b66').setOrigin(0.5));
  if (enabled) {
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x4a5262, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(fill, 0.95));
    bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      AudioManager.ui('tap');
      // 等這次點擊處理完再動作：動作可能會重建畫面
      scene.time.delayedCall(0, onPress);
    });
  }
  return objs;
}

/** 深色半透明面板 */
export function uiPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, stroke = 0xf5d76e): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, w, h, 0x0d0f14, 0.9).setOrigin(0).setStrokeStyle(1, stroke, 0.6).setDepth(99);
}

/** 橫條（血量、噪音） */
export function uiBar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number): (ratio: number) => void {
  scene.add.rectangle(x, y, w, h, 0x000000).setOrigin(0).setDepth(100);
  const bar = scene.add.rectangle(x + 1, y + 1, w - 2, h - 2, color).setOrigin(0).setDepth(101);
  return (r: number) => {
    bar.width = (w - 2) * Phaser.Math.Clamp(r, 0, 1);
  };
}

/** 風險星星 */
export function stars(n: number, max = 5): string {
  return '★'.repeat(Math.min(n, max)) + '☆'.repeat(Math.max(0, max - n));
}
