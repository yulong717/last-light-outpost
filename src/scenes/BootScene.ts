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
    // PixelLab 產生的像素圖；之後有動畫時改用 this.load.aseprite(...)
    // 主角：3 格 64×64（0 待機瞄準、1 開火火光、2 後座力上揚）
    this.load.spritesheet('player', 'assets/sprites/player_shoot.png', { frameWidth: 64, frameHeight: 64 });
    // 霧屍走路：4 格 64×64 橫排精靈圖（PixelLab 以選定角色為參考生成的姿勢）
    this.load.spritesheet('zombie_basic', 'assets/sprites/zombie_walk.png', { frameWidth: 64, frameHeight: 64 });
  }

  create(): void {
    this.placeholder('player', 20, 44, PLACEHOLDER_COLORS.player, true);
    this.placeholder('barricade', 16, 56, PLACEHOLDER_COLORS.barricade);
    for (const e of Object.values(ENEMIES)) {
      this.placeholder(e.texture, e.width, e.height, e.color, true);
    }
    if (this.textures.get('player').frameTotal > 2) {
      this.anims.create({
        key: 'player_shoot',
        frames: this.anims.generateFrameNumbers('player', { frames: [1, 2, 0] }),
        frameRate: 20,
      });
    }
    if (this.textures.get('zombie_basic').frameTotal > 2) {
      this.anims.create({
        key: 'zombie_walk',
        frames: this.anims.generateFrameNumbers('zombie_basic', { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
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
