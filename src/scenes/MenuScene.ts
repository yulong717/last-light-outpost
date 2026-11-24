import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager, type AudioSettings } from '../audio/AudioManager';
import { pixelText } from '../utils/text';
import { GameState } from '../state/GameState';
import type { PrologueData } from './PrologueScene';
import { ensureMenuBackdrop } from '../art/IllustrationArt';
import { ensureHeroTexture, heroBuild } from '../art/HeroArt';
import { HERO_ORDER } from '../data/heroes';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    // 標題插畫：夜裡的據點、亮著的燈、霧裡走來的屍群，三位主角站在牆前（src/art/IllustrationArt.ts）
    this.add.image(0, 0, ensureMenuBackdrop(this)).setOrigin(0).setScale(2);
    HERO_ORDER.forEach((id, i) => {
      const key = ensureHeroTexture(this, id);
      if (!key) return;
      const b = heroBuild(id);
      const x = 150 + i * 50;
      const y = 326 + (i % 2) * 6;
      this.add.ellipse(x, y - 1, 30, 5, 0x000000, 0.55);
      const img = this.add.image(x, y, key, 0).setOrigin(0.5, 1).setScale(b.w, b.h);
      this.tweens.add({ targets: img, scaleY: b.h * 1.02, duration: 900 + i * 130, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    });
    // 文字底下壓一條暗帶，插畫上也讀得清楚
    const band = this.add.graphics();
    band.fillStyle(0x000000, 0.4).fillRect(0, 60, GAME_WIDTH, 108);
    band.fillStyle(0x000000, 0.2).fillRect(0, 56, GAME_WIDTH, 4).fillRect(0, 168, GAME_WIDTH, 4);
    band.fillStyle(0x000000, 0.5).fillRect(0, GAME_HEIGHT - 30, GAME_WIDTH, 30);
    pixelText(this, cx + 2, 94, '殘光據點', 24, '#3a1a0a').setOrigin(0.5);
    pixelText(this, cx, 92, '殘光據點', 24, '#f5d76e').setOrigin(0.5);
    pixelText(this, cx, 130, 'LAST LIGHT OUTPOST', 8, '#c8b88a').setOrigin(0.5);

    const touch = this.sys.game.device.input.touch;
    const hint = touch
      ? '點畫面瞄準射擊　右下按鈕：換彈／換槍／夥伴指令'
      : '滑鼠瞄準、左鍵射擊　R 換彈　1／2 或 Q 換槍　F 夥伴固守／跟隨　M 靜音';
    pixelText(this, cx, 154, hint, 8, '#c8c8c8').setOrigin(0.5);

    const start = pixelText(this, cx + 20, GAME_HEIGHT - 15, touch ? '點擊開始：白天布置據點，晚上守住它' : '點擊或按空白鍵開始：白天布置據點，晚上守住它', 10, '#ffffff').setOrigin(0.5);
    this.tweens.add({ targets: start, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    AudioManager.setMood('menu');
    this.buildVolumeControls();

    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      AudioManager.ui('confirm');
      start.destroy();
      this.newGame();
    };
    // 點到音量按鈕時不要開始遊戲
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) go();
    });
    this.input.keyboard?.once('keydown-SPACE', go);
    // 霧屍圖鑑：看各職業的外觀、能力，點擊測試護甲
    pixelText(this, 16, GAME_HEIGHT - 16, 'B　霧屍圖鑑', 8, '#9aa3ad').setOrigin(0, 1);
    this.input.keyboard?.once('keydown-B', () => {
      if (started) return;
      started = true;
      this.scene.start('Bestiary');
    });
  }

  /**
   * 開新遊戲：不選角、不選據點，直接以阿凱進入序章（學校＝第一夜）。
   * 其他兩位主角之後在劇情裡會合（見 docs/PROLOGUE.md）。
   * 開發用：網址加 ?floor=N（1～5）可以直接從第 N 層開始。
   */
  private newGame(): void {
    GameState.reset('student');
    // 逃出學校後的第一個落腳處（之後由路線圖決定）
    GameState.data.outpostMap = 'street';
    const floor = Number(new URLSearchParams(window.location.search).get('floor'));
    const data: PrologueData = floor > 0 ? { from: floor - 1 } : {};
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Prologue', data));
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
