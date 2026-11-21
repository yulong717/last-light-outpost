import Phaser from 'phaser';

/**
 * 統一的像素風文字樣式；之後換成點陣字型只要改這裡。
 * size 以 480×270 時的大小撰寫，這裡依 640×360 等比放大。
 */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 8,
  color = '#e8e8e8',
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, {
      fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", monospace',
      fontSize: `${Math.round(size * 4 / 3)}px`,
      color,
      resolution: 4,
    })
    .setDepth(100);
}
