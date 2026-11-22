import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { DefenseScene } from './scenes/DefenseScene';
import { UIScene } from './scenes/UIScene';
import { BuildUIScene } from './scenes/BuildUIScene';
import { ArmoryScene } from './scenes/ArmoryScene';
import { GameOverScene } from './scenes/GameOverScene';
import { BestiaryScene } from './scenes/BestiaryScene';
import { ExploreMapScene } from './scenes/ExploreMapScene';
import { ExpeditionScene } from './scenes/ExpeditionScene';
import { QteScene } from './scenes/QteScene';
import { ExploreFieldScene } from './scenes/ExploreFieldScene';
import { GameState } from './state/GameState';
import { AudioManager } from './audio/AudioManager';
import { HiResPlugin, RENDER_SCALE, syncCanvasSmoothing } from './render/RenderScale';

// 音效：第一次點擊／按鍵時解鎖（手機瀏覽器的自動播放限制），M 鍵靜音
AudioManager.install();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // 畫布用整數倍的實際像素繪製，鏡頭再放大回來：版面仍是 640×360，但文字與像素都更清晰
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: '#111318',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { activePointers: 3 },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  plugins: {
    scene: [{ key: 'HiResPlugin', plugin: HiResPlugin, mapping: 'hiRes' }],
  },
  scene: [BootScene, MenuScene, DefenseScene, UIScene, BuildUIScene, ArmoryScene, GameOverScene, BestiaryScene, ExploreMapScene, ExpeditionScene, QteScene, ExploreFieldScene],
});

syncCanvasSmoothing(game);

// 開發模式下掛到 window，方便在主控台或自動化測試裡操作場景
if (import.meta.env.DEV) Object.assign(window, { __game: game, __state: GameState });
