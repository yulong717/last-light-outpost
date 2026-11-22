import Phaser from 'phaser';
import { createWeaponTextures, stripArms } from '../art/WeaponArt';
import { PLACEHOLDER_COLORS } from '../config';
import { ENEMIES } from '../data/enemies';
import { createBarricadeTexture, registerHeadFrames } from '../art/ProceduralArt';
import { createBuildingTextures } from '../art/BuildingArt';
import { createGearTexture } from '../art/ZombieComposer';
import { ZOMBIE_NECK_ROW, ZOMBIE_SHEETS } from '../art/sprites';
import { createFxTextures } from '../fx/FxTextures';

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
    // 主角換彈：9 格（PixelLab PixMiniMax 以射擊第 0 格為起始影格生成）
    // 主角射擊圖的部位遮罩（tools/art/make_player_regions.py 產生）：NPC 隊員換裝用
    this.load.image('player_regions', 'assets/sprites/player_shoot_regions.png');
    // 隊員底圖：PixelLab 依主角姿勢重畫的 18 個不同的人＋部位遮罩（tools/art/make_crew_bases.py）
    this.load.image('crew_bases', 'assets/sprites/crew_bases.png');
    this.load.image('crew_bases_regions', 'assets/sprites/crew_bases_regions.png');
    this.load.spritesheet('player_reload', 'assets/sprites/player_reload.png', { frameWidth: 64, frameHeight: 64 });
    // 霧屍：PixelLab 走路圖經程式換色、加寬、做出攻擊影格的三種變體
    for (const key of ZOMBIE_SHEETS) {
      this.load.spritesheet(key, `assets/sprites/${key}.png`, { frameWidth: 64, frameHeight: 64 });
    }
  }

  create(): void {
    createFxTextures(this);
    createBarricadeTexture(this);
    createBuildingTextures(this);
    // 霧屍頭飾與變異標記（身體外觀在出怪時才依職業合成，見 ZombieComposer）
    createGearTexture(this);
    // 武器像素圖（手持部件、圖示、彈殼、槍口火光），見 src/art/weaponMaps.ts
    createWeaponTextures(this);
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
    if (this.textures.get('player_reload').frameTotal > 2) {
      this.anims.create({
        key: 'player_reload',
        frames: this.anims.generateFrameNumbers('player_reload', { start: 0, end: 8 }),
        frameRate: 9,
      });
    }
    // 主角身體：擦掉手臂和槍，手與武器改由 WeaponRig 即時畫
    if (this.textures.get('player').frameTotal > 2) stripArms(this, 'player');
    for (const key of ZOMBIE_SHEETS) {
      if (this.textures.get(key).frameTotal < 7) continue; // 沒載到圖時用色塊
      this.anims.create({
        key: `${key}_walk`,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
      // 攻擊：蓄力停一下 → 前撲 → 回到站姿
      this.anims.create({
        key: `${key}_attack`,
        frames: this.anims.generateFrameNumbers(key, { frames: [4, 4, 5, 5, 0] }),
        frameRate: 14,
      });
      // 倒地：PixelLab 生成的 9 格（中槍後退、膝蓋一軟、倒地）
      if (this.textures.get(key).frameTotal > 15) {
        this.anims.create({
          key: `${key}_death`,
          frames: this.anims.generateFrameNumbers(key, { start: 6, end: 14 }),
          frameRate: 16,
        });
      }
      registerHeadFrames(this, key, ZOMBIE_NECK_ROW);
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
