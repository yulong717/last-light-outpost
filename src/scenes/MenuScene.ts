import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    pixelText(this, cx, 70, '殘光據點', 24, '#f5d76e').setOrigin(0.5);
    pixelText(this, cx, 100, 'LAST LIGHT OUTPOST', 8, '#9aa3ad').setOrigin(0.5);

    const touch = this.sys.game.device.input.touch;
    const hint = touch
      ? '點畫面瞄準射擊　右下按鈕：換彈／換槍'
      : '滑鼠瞄準、左鍵射擊　R 換彈　1／2 或 Q 換槍';
    pixelText(this, cx, 160, hint, 8, '#c8c8c8').setOrigin(0.5);

    const start = pixelText(this, cx, 200, touch ? '點擊開始第一夜' : '點擊或按空白鍵開始第一夜', 10, '#ffffff').setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    const go = () => {
      GameState.reset();
      this.scene.start('Defense');
    };
    this.input.once('pointerdown', go);
    this.input.keyboard?.once('keydown-SPACE', go);
  }
}
