import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { queueAction, registerUIRect } from '../input/InputManager';
import { pixelText } from '../utils/text';
import type { HudData } from './DefenseScene';

/** HUD 疊在遊戲場景上方。手機與電腦共用，按鈕至少 24×24 邏輯像素。 */
export class UIScene extends Phaser.Scene {
  private baseBar!: Phaser.GameObjects.Rectangle;
  private barricadeBar!: Phaser.GameObjects.Rectangle;
  private reloadBar!: Phaser.GameObjects.Rectangle;
  private ammoText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private rotateHint!: Phaser.GameObjects.Container;
  private unregister: (() => void)[] = [];

  constructor() {
    super('UI');
  }

  create(): void {
    this.unregister = [];
    pixelText(this, 6, 4, '據點', 8);
    this.add.rectangle(40, 7, 80, 6, 0x000000).setOrigin(0);
    this.baseBar = this.add.rectangle(41, 8, 78, 4, 0x4caf50).setOrigin(0);

    pixelText(this, 6, 20, '路障', 8);
    this.add.rectangle(40, 23, 80, 6, 0x000000).setOrigin(0);
    this.barricadeBar = this.add.rectangle(41, 24, 78, 4, 0xbcaaa4).setOrigin(0);

    this.waveText = pixelText(this, GAME_WIDTH / 2, 4, '', 10).setOrigin(0.5, 0);
    this.killText = pixelText(this, GAME_WIDTH - 6, 4, '', 8).setOrigin(1, 0);

    this.ammoText = pixelText(this, 6, GAME_HEIGHT - 20, '', 10);
    this.add.rectangle(6, GAME_HEIGHT - 4, 60, 2, 0x000000).setOrigin(0);
    this.reloadBar = this.add.rectangle(6, GAME_HEIGHT - 4, 60, 2, 0xfff176).setOrigin(0);

    this.button(GAME_WIDTH - 38, GAME_HEIGHT - 38, '換彈', () => queueAction('reload'));
    this.button(GAME_WIDTH - 76, GAME_HEIGHT - 38, '換槍', () => queueAction('next'));

    this.buildRotateHint();
    this.scale.on(Phaser.Scale.Events.ORIENTATION_CHANGE, this.checkOrientation, this);
    this.checkOrientation();

    const defense = this.scene.get('Defense');
    defense.events.on('hud', this.onHud, this);
    defense.events.on('wave-start', this.onWaveStart, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      defense.events.off('hud', this.onHud, this);
      defense.events.off('wave-start', this.onWaveStart, this);
      this.scale.off(Phaser.Scale.Events.ORIENTATION_CHANGE, this.checkOrientation, this);
      this.unregister.forEach((fn) => fn());
    });
  }

  private button(x: number, y: number, label: string, onPress: () => void): void {
    const size = 32;
    const bg = this.add
      .rectangle(x, y, size, size, 0x000000, 0.45)
      .setOrigin(0)
      .setStrokeStyle(1, 0xffffff, 0.5)
      .setInteractive();
    pixelText(this, x + size / 2, y + size / 2, label, 8).setOrigin(0.5);
    bg.on('pointerdown', () => {
      bg.setFillStyle(0xffffff, 0.3);
      onPress();
    });
    bg.on('pointerup', () => bg.setFillStyle(0x000000, 0.45));
    bg.on('pointerout', () => bg.setFillStyle(0x000000, 0.45));
    this.unregister.push(registerUIRect({ x, y, w: size, h: size }));
  }

  private onHud(h: HudData): void {
    this.baseBar.width = 78 * (h.baseHp / h.baseMaxHp);
    this.barricadeBar.width = 78 * (h.barricadeHp / h.barricadeMaxHp);
    this.ammoText.setText(h.reloading ? `${h.weaponName}  換彈中…` : `${h.weaponName}  ${h.ammo} / ${h.magazine}`);
    this.reloadBar.width = 60 * (h.reloading ? h.reloadProgress : h.ammo / h.magazine);
    this.waveText.setText(`第一夜　第 ${h.wave} / ${h.totalWaves} 波`);
    this.killText.setText(`擊殺 ${h.kills}`);
  }

  private onWaveStart(wave: number, total: number): void {
    const t = pixelText(this, GAME_WIDTH / 2, 120, wave === total ? '最後一波！' : `第 ${wave} 波來襲`, 16, '#ff8a80').setOrigin(0.5);
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 600, onComplete: () => t.destroy() });
  }

  private buildRotateHint(): void {
    const bg = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.9).setOrigin(0);
    const text = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, '請將手機轉為橫向', 16).setOrigin(0.5);
    this.rotateHint = this.add.container(0, 0, [bg, text]).setDepth(1000);
  }

  private checkOrientation(): void {
    const portrait = this.sys.game.device.input.touch && window.innerHeight > window.innerWidth;
    this.rotateHint.setVisible(portrait);
    const defense = this.scene.get('Defense');
    if (portrait && defense.scene.isActive()) defense.scene.pause();
    else if (!portrait && defense.scene.isPaused()) defense.scene.resume();
  }
}
