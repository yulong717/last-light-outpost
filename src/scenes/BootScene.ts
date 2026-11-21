import Phaser from 'phaser';
import { PLACEHOLDER_COLORS } from '../config';
import { ENEMIES } from '../data/enemies';

/**
 * 載入資源。目前沒有美術素材，所以用程式產生「色塊佔位圖」。
 * 之後把真正的像素圖放進 public/assets/，在 preload() 用同一個 key 載入，
 * 下面的佔位圖就會自動略過，遊戲程式不用改。
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    // 範例：this.load.aseprite('player', 'assets/sprites/player.png', 'assets/sprites/player.json');
  }

  create(): void {
    this.placeholder('player', 20, 44, PLACEHOLDER_COLORS.player, true);
    this.placeholder('barricade', 16, 56, PLACEHOLDER_COLORS.barricade);
    for (const e of Object.values(ENEMIES)) {
      this.placeholder(e.texture, e.width, e.height, e.color, true);
    }
    this.scene.start('Menu');
  }

  /** 產生一張純色矩形貼圖；withHead 會畫出較亮的頭部區塊，方便看爆頭位置 */
  private placeholder(key: string, w: number, h: number, color: number, withHead = false): void {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x000000, 1).fillRect(0, 0, w, h);
    g.fillStyle(color, 1).fillRect(1, 1, w - 2, h - 2);
    if (withHead) {
      const head = Phaser.Display.Color.IntegerToColor(color).lighten(25).color;
      g.fillStyle(head, 1).fillRect(1, 1, w - 2, Math.round(h * 0.3) - 1);
    }
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
