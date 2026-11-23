import Phaser from 'phaser';
import { RENDER_SCALE } from '../render/RenderScale';

/** 最小字級（邏輯像素）：再小在手機上中文筆畫會擠成一團。 */
const MIN_FONT_PX = 9;

/** 全遊戲共用的字型。 */
export const UI_FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", "Heiti TC", sans-serif';

/** 依 size 換算實際字級（邏輯像素）。 */
export function fontPx(size: number): number {
  return Math.max(MIN_FONT_PX, Math.round((size * 4) / 3));
}

/**
 * 全遊戲共用的文字樣式：所有 UI 文字都應該經由這裡建立，之後換字型只要改這裡。
 * size 以 480×270 時的大小撰寫，這裡依 640×360 等比放大。
 *
 * 清晰度：文字以 RENDER_SCALE 倍解析度繪製（畫布本身也是 RENDER_SCALE 倍），
 * 每個字形像素都對到畫布的實際像素；再加一道 1 像素的硬陰影，壓在霧、火光上也讀得清楚。
 */
export function textStyle(size = 8, color = '#e8e8e8'): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: UI_FONT,
    fontSize: `${fontPx(size)}px`,
    color,
    resolution: RENDER_SCALE,
    shadow: { offsetX: 0, offsetY: 1, color: 'rgba(0,0,0,0.7)', blur: 0, fill: true, stroke: true },
  };
}

export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 8,
  color = '#e8e8e8',
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, textStyle(size, color)).setDepth(100);
}

/**
 * 中文換行：Phaser 的自動換行只在空白處斷，中英混排的長句會斷在奇怪的地方或超出欄寬。
 * 這裡逐字量寬度，超過就斷行（英數字串不拆開）。
 */
export function wrapCJK(t: Phaser.GameObjects.Text, width: number): Phaser.GameObjects.Text {
  const src = t.text;
  const tokens = src.match(/[A-Za-z0-9.+\-×%/]+|\s+|./gu) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (tok === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    t.setText(line + tok);
    // 句尾標點不單獨換到下一行（避頭點）：寧可這行稍微超出一點
    if (t.width > width && line.trim() && !/^[。，、！？」』）….：；]$/u.test(tok)) {
      lines.push(line.trimEnd());
      line = tok.trimStart();
    } else line += tok;
  }
  lines.push(line);
  return t.setText(lines.join('\n'));
}
