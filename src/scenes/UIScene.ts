import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { JOYSTICK_RADIUS, JOYSTICK_ZONE, joystick, queueAction, registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import { AudioManager } from '../audio/AudioManager';
import type { HudData } from './DefenseScene';

/** HUD 疊在遊戲場景上方。手機與電腦共用，按鈕至少 24×24 邏輯像素。 */
export class UIScene extends Phaser.Scene {
  private playerBar!: Phaser.GameObjects.Rectangle;
  private baseBar!: Phaser.GameObjects.Rectangle;
  private stick!: Phaser.GameObjects.Graphics;
  private touchUI = false;
  private barricadeBar!: Phaser.GameObjects.Rectangle;
  private reloadBar!: Phaser.GameObjects.Rectangle;
  private ammoText!: Phaser.GameObjects.Text;
  private reserveText!: Phaser.GameObjects.Text;
  private slotText!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Rectangle;
  private staminaFlash = 0;
  private waveText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;
  private rotateHint!: Phaser.GameObjects.Container;
  private unregister: (() => void)[] = [];
  /** 夥伴名單：每列一個色塊＋名字職業＋血條＋狀態 */
  private crewRows: {
    mark: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    bar: Phaser.GameObjects.Rectangle;
    status: Phaser.GameObjects.Text;
  }[] = [];
  private orderLabel?: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    this.unregister = [];
    pixelText(this, 6, 4, '生命', 8);
    this.add.rectangle(40, 7, 80, 6, 0x000000).setOrigin(0);
    this.playerBar = this.add.rectangle(41, 8, 78, 4, 0xef5350).setOrigin(0);

    pixelText(this, 6, 20, '據點', 8);
    this.add.rectangle(40, 23, 80, 6, 0x000000).setOrigin(0);
    this.baseBar = this.add.rectangle(41, 24, 78, 4, 0x4caf50).setOrigin(0);

    pixelText(this, 6, 36, '路障', 8);
    this.add.rectangle(40, 39, 80, 6, 0x000000).setOrigin(0);
    this.barricadeBar = this.add.rectangle(41, 40, 78, 4, 0xbcaaa4).setOrigin(0);

    // 觸控裝置才顯示虛擬搖桿（左下角）；電腦用 WASD／方向鍵
    this.touchUI = this.sys.game.device.input.touch;
    this.stick = this.add.graphics().setDepth(90);

    this.waveText = pixelText(this, GAME_WIDTH / 2, 4, '', 10).setOrigin(0.5, 0);
    this.killText = pixelText(this, GAME_WIDTH - 6, 4, '', 8).setOrigin(1, 0);
    this.buildMuteButton();

    // 體力（近戰用）
    pixelText(this, 6, 49, '體力', 7, '#81d4fa');
    this.add.rectangle(40, 52, 80, 4, 0x000000).setOrigin(0);
    this.staminaBar = this.add.rectangle(41, 53, 78, 2, 0x4fc3f7).setOrigin(0);

    // 左下：武器欄（觸控時搖桿在左下，武器資訊改放中下）
    const wx = this.sys.game.device.input.touch ? 210 : 6;
    this.slotText = pixelText(this, wx, GAME_HEIGHT - 44, '', 7, '#90a4ae');
    this.ammoText = pixelText(this, wx, GAME_HEIGHT - 30, '', 10);
    this.reserveText = pixelText(this, wx, GAME_HEIGHT - 15, '', 7, '#b0bec5');
    this.add.rectangle(wx, GAME_HEIGHT - 4, 80, 2, 0x000000).setOrigin(0);
    this.reloadBar = this.add.rectangle(wx, GAME_HEIGHT - 4, 80, 2, 0xfff176).setOrigin(0);

    this.button(GAME_WIDTH - 38, GAME_HEIGHT - 38, '換彈', () => queueAction('reload'));
    this.button(GAME_WIDTH - 76, GAME_HEIGHT - 38, '換槍', () => queueAction('next'));
    this.button(GAME_WIDTH - 38, GAME_HEIGHT - 76, '近戰', () => queueAction('melee'));

    this.crewRows = [];
    this.orderLabel = undefined;

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

  /** 右上角喇叭：點一下靜音／取消（電腦也可按 M） */
  private buildMuteButton(): void {
    const size = 24;
    const x = GAME_WIDTH - size - 6;
    const y = 20;
    const bg = this.add.rectangle(x, y, size, size, 0x000000, 0.35).setOrigin(0).setInteractive();
    const icon = pixelText(this, x + size / 2, y + size / 2, '', 8).setOrigin(0.5);
    const refresh = () => icon.setText(AudioManager.settings.muted ? '靜' : '♪').setAlpha(AudioManager.settings.muted ? 0.5 : 1);
    refresh();
    bg.on('pointerdown', () => AudioManager.toggleMute());
    const off = AudioManager.onChange(refresh);
    this.unregister.push(off, registerUIRect({ x, y, w: size, h: size }));
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

  update(): void {
    const g = this.stick;
    g.clear();
    if (!this.touchUI) return;
    // 沒按時在固定位置顯示淡淡的搖桿，提示「這裡可以移動」
    const bx = joystick.active ? joystick.baseX : JOYSTICK_ZONE.x + 52;
    const by = joystick.active ? joystick.baseY : JOYSTICK_ZONE.y + JOYSTICK_ZONE.h - 52;
    const kx = joystick.active ? joystick.knobX : bx;
    const ky = joystick.active ? joystick.knobY : by;
    const a = joystick.active ? 0.5 : 0.22;
    g.lineStyle(1, 0xffffff, a).strokeCircle(bx, by, JOYSTICK_RADIUS);
    g.fillStyle(0xffffff, a * 0.8).fillCircle(kx, ky, 10);
  }

  /** 第一次收到 HUD 資料時才建夥伴名單（人數依存檔而定）；沒有夥伴就不顯示 */
  private buildCrew(count: number): void {
    const defense = this.scene.get('Defense');
    for (let i = 0; i < count; i++) {
      const y = 64 + i * 14;
      const mark = this.add.rectangle(8, y + 4, 5, 5, 0xffffff).setOrigin(0).setStrokeStyle(1, 0x000000);
      const label = pixelText(this, 16, y, '', 8);
      this.add.rectangle(72, y + 3, 32, 4, 0x000000).setOrigin(0);
      const bar = this.add.rectangle(73, y + 4, 30, 2, 0x81c784).setOrigin(0);
      const status = pixelText(this, 108, y, '', 8, '#b0bec5');
      this.crewRows.push({ mark, label, bar, status });
    }
    // 指令按鈕：切換固守／跟隨（鍵盤 F）
    const x = GAME_WIDTH - 114;
    const y = GAME_HEIGHT - 38;
    const size = 32;
    const bg = this.add
      .rectangle(x, y, size, size, 0x000000, 0.45)
      .setOrigin(0)
      .setStrokeStyle(1, 0xfff59d, 0.6)
      .setInteractive();
    this.orderLabel = pixelText(this, x + size / 2, y + size / 2, '', 8, '#fff59d').setOrigin(0.5);
    if (!this.touchUI) pixelText(this, x + size / 2, y - 2, 'F', 7, '#90a4ae').setOrigin(0.5, 1);
    bg.on('pointerdown', () => {
      bg.setFillStyle(0xffffff, 0.3);
      defense.events.emit('companion-order');
    });
    bg.on('pointerup', () => bg.setFillStyle(0x000000, 0.45));
    bg.on('pointerout', () => bg.setFillStyle(0x000000, 0.45));
    this.unregister.push(registerUIRect({ x, y, w: size, h: size }));
  }

  private updateCrew(h: HudData): void {
    if (h.companions.length === 0) return;
    if (this.crewRows.length === 0) this.buildCrew(h.companions.length);
    h.companions.forEach((c, i) => {
      const row = this.crewRows[i];
      if (!row) return;
      const ratio = c.hp / c.maxHp;
      row.mark.setFillStyle(c.alive ? c.color : 0x555555);
      row.label.setText(`${c.name} ${c.title}`).setColor(c.alive ? '#e8e8e8' : '#757575');
      row.bar.width = 30 * ratio;
      row.bar.setFillStyle(ratio > 0.5 ? 0x81c784 : ratio > 0.25 ? 0xffd54f : 0xe57373);
      row.status.setText(c.status).setColor(c.alive ? '#b0bec5' : '#ef5350');
    });
    this.orderLabel?.setText(h.companionOrder === 'hold' ? '固守' : '跟隨');
  }

  private onHud(h: HudData): void {
    this.updateCrew(h);
    this.playerBar.width = 78 * (h.playerHp / h.playerMaxHp);
    this.baseBar.width = 78 * (h.baseHp / h.baseMaxHp);
    this.barricadeBar.width = 78 * (h.barricadeHp / h.barricadeMaxHp);
    const reserve = h.reserve === Infinity ? '∞' : `${h.reserve}`;
    this.ammoText.setText(h.reloading ? `${h.weaponName}  換彈中…  ${h.ammo}` : `${h.weaponName}  ${h.ammo}`);
    this.ammoText.setColor(h.ammo === 0 && !h.reloading ? '#ff6b6b' : '#e8e8e8');
    this.reserveText.setText(`${h.weaponModel}　備彈 ${reserve}`).setColor(h.reserve === 0 ? '#ff6b6b' : '#b0bec5');
    this.reloadBar.width = 80 * Math.min(1, h.reloading ? h.reloadProgress : h.ammo / h.magazine);
    const keys = this.touchUI ? '' : '1/2/3 ';
    const melee = this.touchUI ? h.meleeName : `右鍵/V ${h.meleeName}`;
    this.slotText.setText(`${keys}${h.slots.map((n, i) => (i === h.slot ? `[${n}]` : n)).join(' ')}　${melee}`);
    this.staminaBar.width = 78 * h.stamina;
    // 體力見底時閃紅
    this.staminaFlash += 1;
    this.staminaBar.setFillStyle(h.stamina < 0.25 ? (this.staminaFlash % 20 < 10 ? 0xef5350 : 0x4fc3f7) : 0x4fc3f7);
    this.waveText.setText(`第 ${GameState.data.day} 夜　第 ${h.wave} / ${h.totalWaves} 波`);
    this.killText.setText(`廢料 ${GameState.data.scrap}　擊殺 ${h.kills}`);
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
