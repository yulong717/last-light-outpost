import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { AudioManager, type AudioSettings } from '../audio/AudioManager';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    pixelText(this, cx, 92, '殘光據點', 24, '#f5d76e').setOrigin(0.5);
    pixelText(this, cx, 130, 'LAST LIGHT OUTPOST', 8, '#9aa3ad').setOrigin(0.5);

    const touch = this.sys.game.device.input.touch;
    const hint = touch
      ? '點畫面瞄準射擊　右下按鈕：換彈／換槍'
      : '滑鼠瞄準、左鍵射擊　R 換彈　1／2 或 Q 換槍　M 靜音';
    pixelText(this, cx, 212, hint, 8, '#c8c8c8').setOrigin(0.5);

    const start = pixelText(this, cx, 264, touch ? '點擊開始第一夜' : '點擊或按空白鍵開始第一夜', 10, '#ffffff').setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    AudioManager.setMood('menu');
    this.buildVolumeControls();

    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      AudioManager.ui('confirm');
      GameState.reset();
      this.scene.start('Defense');
    };
    // 點到音量按鈕時不要開始遊戲
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) go();
    });
    this.input.keyboard?.once('keydown-SPACE', go);
  }

  /** 右下角：音樂／音效音量（0–10），設定會記住 */
  private buildVolumeControls(): void {
    const rows: { key: keyof Pick<AudioSettings, 'music' | 'sfx'>; label: string }[] = [
      { key: 'music', label: '音樂' },
      { key: 'sfx', label: '音效' },
    ];
    const x = GAME_WIDTH - 120;
    rows.forEach((row, i) => {
      const y = 300 + i * 22;
      pixelText(this, x, y, row.label, 8, '#9aa3ad').setOrigin(0, 0.5);
      const value = pixelText(this, x + 70, y, '', 8).setOrigin(0.5);
      const refresh = () => value.setText(`${Math.round(AudioManager.settings[row.key] * 10)}`);
      refresh();
      const btn = (bx: number, label: string, delta: number) => {
        const t = pixelText(this, bx, y, label, 10, '#ffffff').setOrigin(0.5);
        // 觸控友善：點擊範圍比字大
        t.setInteractive(new Phaser.Geom.Rectangle(-6, -6, t.width + 12, t.height + 12), Phaser.Geom.Rectangle.Contains);
        t.on('pointerdown', () => {
          AudioManager.set({ [row.key]: AudioManager.settings[row.key] + delta, muted: false });
          refresh();
          AudioManager.ui('tap');
        });
      };
      btn(x + 48, '◀', -0.1);
      btn(x + 92, '▶', 0.1);
    });
  }
}
