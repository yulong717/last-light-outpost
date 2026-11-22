import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { pixelText } from '../utils/text';

export interface GameOverData {
  survived: boolean;
  /** 失敗原因：據點被攻破，或主角倒下 */
  reason?: 'base' | 'player';
  kills: number;
  headshots: number;
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  create(data: GameOverData): void {
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75);
    pixelText(this, cx, 106, data.survived ? '天亮了，你撐過了第一夜' : data.reason === 'player' ? '你倒在了霧裡' : '據點失守', 16, data.survived ? '#f5d76e' : '#ff6b6b').setOrigin(0.5);
    pixelText(this, cx, 160, `擊殺 ${data.kills}　爆頭 ${data.headshots}`, 10).setOrigin(0.5);
    pixelText(this, cx, 266, '（白天探索與據點升級會在 M2 加入）', 8, '#9aa3ad').setOrigin(0.5);
    const again = pixelText(this, cx, 266, '點擊回到標題', 10, '#ffffff').setOrigin(0.5);
    this.tweens.add({ targets: again, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    this.time.delayedCall(500, () => {
      this.input.once('pointerdown', () => this.scene.start('Menu'));
      this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Menu'));
    });
  }
}
