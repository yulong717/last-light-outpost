import Phaser from 'phaser';
import { AudioManager } from '../audio/AudioManager';
import { pixelText } from '../utils/text';
import { GAME_WIDTH } from '../config';
import { PAL, PixelBar, drawPanel, drawPlate, type PanelTone } from '../ui/theme';

export interface ButtonOpts {
  fill?: number;
  enabled?: boolean;
  size?: number;
  /** 按鈕下方第二行小字 */
  sub?: string;
  subColor?: string;
  /** 邊框強調色（選中狀態） */
  accent?: number;
}

/**
 * 全遊戲共用的按鈕：鐵片斜面底板（src/ui/theme.ts），滑過變亮、按下往下沉。
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
  const fill = o.fill === undefined || o.fill === 0x2a2f3a ? PAL.plate : o.fill;
  const g = scene.add.graphics().setDepth(100);
  const draw = (state: 0 | 1 | 2) => drawPlate(g.clear(), x, y, w, h, { fill, state, enabled, accent: o.accent });
  draw(0);
  const objs: Phaser.GameObjects.GameObject[] = [g];
  const ty = o.sub ? y + h / 2 - 6 : y + h / 2;
  const main = pixelText(scene, x + w / 2, ty, label, o.size ?? 8, enabled ? '#f2ece0' : '#5e5850').setOrigin(0.5);
  objs.push(main);
  const sub = o.sub ? pixelText(scene, x + w / 2, y + h / 2 + 7, o.sub, 7, enabled ? o.subColor ?? '#b8ab98' : '#4a453f').setOrigin(0.5) : undefined;
  if (sub) objs.push(sub);
  if (enabled) {
    const hit = scene.add.zone(x, y, w, h).setOrigin(0).setDepth(100).setInteractive({ useHandCursor: true });
    objs.push(hit);
    const sink = (d: number) => {
      main.y = ty - 0.5 + d;
      if (sub) sub.y = y + h / 2 + 6.5 + d;
    };
    hit.on('pointerover', () => draw(1));
    hit.on('pointerout', () => {
      draw(0);
      sink(0);
    });
    hit.on('pointerup', () => {
      draw(1);
      sink(0);
    });
    hit.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      draw(2);
      sink(1);
      AudioManager.ui('tap');
      // 等這次點擊處理完再動作：動作可能會重建畫面
      scene.time.delayedCall(0, onPress);
    });
  }
  return objs;
}

/** 依舊的描邊色挑面板的標記色 */
function toneFor(stroke: number): PanelTone {
  if (stroke === 0xff8a6a || stroke === 0xef5350) return 'danger';
  if (stroke === 0x9ad17a) return 'ok';
  return 'amber';
}

/** 鏽鐵框面板（對話框、資訊卡） */
export function uiPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, stroke = 0xf5d76e): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(99);
  drawPanel(g, x, y, w, h, { tone: toneFor(stroke), alpha: 0.94 });
  return g;
}

/** 頂端資訊列：深色底＋下緣鐵條 */
export function uiTopBar(scene: Phaser.Scene, h = 26, depth = 98): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(depth);
  const W = GAME_WIDTH;
  g.fillStyle(PAL.fill, 0.88).fillRect(0, 0, W, h - 3);
  g.fillStyle(PAL.frameHi, 1).fillRect(0, h - 3, W, 1);
  g.fillStyle(PAL.frame, 1).fillRect(0, h - 2, W, 1);
  g.fillStyle(PAL.ink, 1).fillRect(0, h - 1, W, 1);
  return g;
}

/** 分格橫條（血量、噪音），會自己跑掉血殘影 */
export function uiBar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number): (ratio: number) => void {
  const bar = new PixelBar(scene, x, y, w, h, { color, seg: 6, depth: 101 });
  const tick = (_t: number, dt: number) => bar.update(dt / 1000);
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
  return (r: number) => bar.set(r);
}

/** 風險星星 */
export function stars(n: number, max = 5): string {
  return '★'.repeat(Math.min(n, max)) + '☆'.repeat(Math.max(0, max - n));
}
