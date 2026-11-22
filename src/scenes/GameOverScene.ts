import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import type { DefenseSceneData } from './DefenseScene';
import { AudioManager } from '../audio/AudioManager';

export interface GameOverData {
  survived: boolean;
  /** 失敗原因：據點被攻破，或主角倒下 */
  reason?: 'base' | 'player';
  kills: number;
  headshots: number;
  /** 這一夜賺到的廢料 */
  scrapEarned?: number;
}

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  create(data: GameOverData): void {
    const cx = GAME_WIDTH / 2;
    this.add.rectangle(cx, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75);
    // 撐過的那一夜是 day - 1（finish 時已經把天數加一）
    const night = GameState.data.day - 1;
    pixelText(this, cx, 106, data.survived ? `天亮了，你撐過了第 ${night} 夜` : data.reason === 'player' ? '你倒在了霧裡' : '據點失守', 16, data.survived ? '#f5d76e' : '#ff6b6b').setOrigin(0.5);
    pixelText(this, cx, 160, `擊殺 ${data.kills}　爆頭 ${data.headshots}`, 10).setOrigin(0.5);
    if (data.survived) {
      pixelText(this, cx, 184, `賺到廢料 ${data.scrapEarned ?? 0}　現有 ${GameState.data.scrap}`, 10, '#f5d76e').setOrigin(0.5);
    }
    const again = pixelText(this, cx, 266, data.survived ? `點擊進入第 ${GameState.data.day} 天，修補據點` : '點擊回到標題', 10, '#ffffff').setOrigin(0.5);
    this.tweens.add({ targets: again, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });
    const next = (): void => {
      if (data.survived) {
        AudioManager.ui('confirm');
        const d: DefenseSceneData = { newDay: true };
        this.scene.start('Defense', d);
      } else {
        AudioManager.ui('back');
        this.scene.start('Menu');
      }
    };
    this.time.delayedCall(500, () => {
      this.input.once('pointerdown', next);
      this.input.keyboard?.once('keydown-SPACE', next);
    });
  }
}
