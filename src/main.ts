import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { DefenseScene } from './scenes/DefenseScene';
import { UIScene } from './scenes/UIScene';
import { BuildUIScene } from './scenes/BuildUIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameState } from './state/GameState';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
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
  scene: [BootScene, MenuScene, DefenseScene, UIScene, BuildUIScene, GameOverScene],
});

// 開發模式下掛到 window，方便在主控台或自動化測試裡操作場景
if (import.meta.env.DEV) Object.assign(window, { __game: game, __state: GameState });
