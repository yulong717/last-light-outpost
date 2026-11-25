import { getFirearm } from '../data/weapons';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { heroTouch } from '../systems/HeroSystem';
import { JOYSTICK_RADIUS, JOYSTICK_ZONE, joystick, queueAction, registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { GameEvents } from '../systems/GameEvents';
import { pixelText } from '../utils/text';
import { isPortraitNow, watchOrientation } from '../utils/orientation';
import { AudioManager } from '../audio/AudioManager';
import { PAL, PixelBar, drawPanel, drawPlate, ensureUiTextures, icon, iconKey, type IconName } from '../ui/theme';
import type { HudData } from './DefenseScene';
import type { TutorialHud } from '../systems/Tutorial';
import type { TutorialFocus } from '../data/tutorial';

type Rect = { x: number; y: number; w: number; h: number };

/** 觸控按鈕平時的不透明度：看得到，但不搶戰場 */
const KEY_ALPHA = 0.7;

/** 觸控動作鍵（右下角） */
interface ActionKey {
  g: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  badge?: Phaser.GameObjects.Text;
  key?: Phaser.GameObjects.Text;
  rect: Rect;
  pressed: boolean;
  enabled: boolean;
  accent?: number;
  chamfer: number;
}

/**
 * 夜晚戰鬥 HUD，疊在 DefenseScene 上（docs/UI_THEME.md）。
 *
 * 戰鬥畫面不放面板，狀態回到角色身上：
 * - 生命、體力畫在主角腳下（src/ui/HeroStatus.ts），彈藥跟著準星（src/ui/AimReadout.ts），都在 DefenseScene 的世界裡
 * - 路障、夥伴受損時頭上才出現小血條；據點被打時那一側的畫面邊緣泛紅
 * - 這裡只剩：上方一行夜數與波次、右上暫停鈕、觸控的幾顆半透明按鈕、教學提示、波次橫幅
 * - 完整資訊（主角、武器、小隊、據點、廢料、擊殺、音效）收進暫停畫面（Esc／Tab，觸控點右上 ❚❚）
 */
export class UIScene extends Phaser.Scene {
  private touchUI = false;
  private stick!: Phaser.GameObjects.Graphics;
  private rotateHint!: Phaser.GameObjects.Container;
  private pausedForRotate = false;
  private unregister: (() => void)[] = [];
  private last?: HudData;

  // 上方一行
  private waveText!: Phaser.GameObjects.Text;
  private wavePips!: Phaser.GameObjects.Graphics;
  private toast!: Phaser.GameObjects.Text;
  private lastOrder?: string;

  // 據點危險：畫面邊緣泛紅
  private edgeG!: Phaser.GameObjects.Graphics;
  private baseHit = 0;
  private baseSide: -1 | 1 = -1;

  // 動作鍵
  private keys: Partial<Record<'reload' | 'stance' | 'medkit' | 'skill' | 'scope' | 'swap', ActionKey>> = {};
  /** 按鈕位置（教學時閃框提示用） */
  private buttonRects: Partial<Record<Exclude<TutorialFocus, null>, Rect>> = {};
  /** 開局教學的提示框 */
  private tut?: {
    g: Phaser.GameObjects.Graphics;
    x: number;
    y: number;
    w: number;
    head: Phaser.GameObjects.Text;
    hint: Phaser.GameObjects.Text;
    progress: Phaser.GameObjects.Text;
    focus: Phaser.GameObjects.Graphics;
    current: TutorialFocus;
    cleared: boolean;
  };

  // 暫停畫面
  private pauseLayer?: Phaser.GameObjects.Container;
  private pauseBars: PixelBar[] = [];
  private pauseRects: (() => void)[] = [];
  private tutorialMode = false;

  constructor() {
    super('UI');
  }

  create(data: { tutorial?: boolean } = {}): void {
    ensureUiTextures(this);
    this.unregister = [];
    this.buttonRects = {};
    this.keys = {};
    this.tut = undefined;
    this.last = undefined;
    this.lastOrder = undefined;
    this.pauseLayer = undefined;
    this.pauseBars = [];
    this.pauseRects = [];
    this.baseHit = 0;
    this.tutorialMode = !!data.tutorial;
    this.touchUI = this.sys.game.device.input.touch;

    this.buildTopLine();
    this.buildPauseButton();
    this.buildActions();
    this.edgeG = this.add.graphics().setDepth(94);

    // 觸控裝置才顯示虛擬搖桿（左下角）；電腦用 WASD／方向鍵
    this.stick = this.add.graphics().setDepth(90);
    this.buttonRects.joystick = {
      x: JOYSTICK_ZONE.x + 52 - JOYSTICK_RADIUS - 4,
      y: JOYSTICK_ZONE.y + JOYSTICK_ZONE.h - 52 - JOYSTICK_RADIUS - 4,
      w: JOYSTICK_RADIUS * 2 + 8,
      h: JOYSTICK_RADIUS * 2 + 8,
    };
    this.buttonRects.fire = { x: 300, y: 150, w: 180, h: 110 };

    this.buildRotateHint();
    this.pausedForRotate = false;
    const stopWatch = watchOrientation((portrait) => {
      this.scale.refresh(); // iOS 旋轉後畫布尺寸偶爾沒跟上，順便重算一次
      this.applyOrientation(portrait);
    });
    this.applyOrientation(isPortraitNow());

    const defense = this.scene.get('Defense');
    defense.events.on('hud', this.onHud, this);
    defense.events.on('wave-start', this.onWaveStart, this);
    defense.events.on('horde-warning', this.onHordeWarning, this);
    if (data.tutorial) this.buildTutorial();
    defense.events.on('tutorial', this.onTutorial, this);
    const bus = GameEvents.of(defense);
    const onBase = (e: { x?: number }) => {
      this.baseHit = 1;
      const cam = defense.cameras.main;
      if (e.x !== undefined) this.baseSide = e.x < cam.scrollX + cam.width / (2 * cam.zoom) ? -1 : 1;
    };
    bus.on('base:hit', onBase);

    // 暫停：Esc／Tab（Tab 不讓瀏覽器拿去切焦點）
    const kb = this.input.keyboard;
    kb?.addCapture('TAB');
    kb?.on('keydown-ESC', this.togglePause, this);
    kb?.on('keydown-TAB', this.togglePause, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      defense.events.off('hud', this.onHud, this);
      defense.events.off('wave-start', this.onWaveStart, this);
      defense.events.off('horde-warning', this.onHordeWarning, this);
      defense.events.off('tutorial', this.onTutorial, this);
      bus.off('base:hit', onBase);
      kb?.off('keydown-ESC', this.togglePause, this);
      kb?.off('keydown-TAB', this.togglePause, this);
      kb?.removeCapture('TAB');
      stopWatch();
      this.unregister.forEach((fn) => fn());
      this.pauseRects.forEach((fn) => fn());
    });
  }

  // ───────────────────────── 上方一行 ─────────────────────────

  private buildTopLine(): void {
    // 沒有底板：一行字＋波次格，壓在畫面最上緣，不擋任何人
    this.waveText = pixelText(this, GAME_WIDTH / 2, 3, '', 8, '#e8e0d0').setOrigin(1, 0).setStroke('#000000', 3).setDepth(99);
    this.wavePips = this.add.graphics().setDepth(99);
    // 小隊指令等短暫提示
    this.toast = pixelText(this, GAME_WIDTH / 2, 18, '', 8, '#f2c14e').setOrigin(0.5, 0).setStroke('#000000', 3).setDepth(99).setAlpha(0);
  }

  private drawWavePips(wave: number, total: number): void {
    const g = this.wavePips.clear();
    const x0 = GAME_WIDTH / 2 + 5;
    for (let i = 0; i < total; i++) {
      const x = x0 + i * 7;
      g.fillStyle(PAL.ink, 0.8).fillRect(x, 7, 6, 6);
      g.fillStyle(i < wave - 1 ? 0x6b5f52 : i === wave - 1 ? PAL.blood : 0x2a2522, 1).fillRect(x + 1, 8, 4, 4);
    }
  }

  private showToast(text: string): void {
    this.tweens.killTweensOf(this.toast);
    this.toast.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.toast, alpha: 0, delay: 1100, duration: 400 });
  }

  // ───────────────────────── 暫停鈕（右上） ─────────────────────────

  private buildPauseButton(): void {
    const s = this.touchUI ? 22 : 16;
    const x = GAME_WIDTH - s - 4;
    const y = 4;
    const g = this.add.graphics().setDepth(99);
    drawPlate(g, x, y, s, s, { chamfer: 1 });
    g.fillStyle(0xe8e0d0, 1);
    const bh = Math.round(s * 0.45);
    const by = y + Math.round((s - bh) / 2);
    g.fillRect(x + Math.round(s * 0.32), by, 2, bh).fillRect(x + Math.round(s * 0.58), by, 2, bh);
    g.setAlpha(KEY_ALPHA);
    if (!this.touchUI) pixelText(this, x - 3, y + s / 2, 'Esc', 7, '#8a8070').setOrigin(1, 0.5).setStroke('#000000', 2).setDepth(99).setAlpha(0.8);
    const hit = this.add.zone(x - 2, y - 2, s + 4, s + 4).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => this.togglePause());
    this.unregister.push(registerUIRect({ x: x - 2, y: y - 2, w: s + 4, h: s + 4 }));
  }

  // ───────────────────────── 動作鍵 ─────────────────────────

  private buildActions(): void {
    const W = GAME_WIDTH;
    const H = GAME_HEIGHT;
    const soldier = GameState.data.hero === 'soldier';
    const loadout = GameState.data.armory.loadout;
    const medkit = () => this.scene.get('Defense').events.emit('use-medkit');
    if (this.touchUI) {
      // 拇指弧線：最常按的換彈最大、最靠角落；平時半透明
      this.keys.reload = this.actionKey(W - 52, H - 52, 46, 'reload', '換彈', () => queueAction('reload'));
      this.keys.stance = this.actionKey(W - 102, H - 46, 40, 'knife', '持刀', () => queueAction('stance'));
      this.keys.medkit = this.actionKey(W - 46, H - 92, 34, 'medkit', undefined, medkit);
      // 換下一把槍（帶兩把以上才有）；原本點左上武器欄，面板拿掉後改成小按鈕
      if (loadout.length > 1) this.keys.swap = this.actionKey(W - 144, H - 40, 34, 'gun', '換槍', () => queueAction('next'));
      if (soldier) this.keys.skill = this.actionKey(W - 138, H - 82, 34, 'fist', undefined, () => (heroTouch.skill = true));
      // 狙擊鏡（只有身上帶巴雷特才出現）
      if (loadout.some((id) => getFirearm(id)?.scope)) this.keys.scope = this.actionKey(W - 94, H - 92, 34, 'scope', undefined, () => queueAction('scope'));
      this.buttonRects.reload = this.keys.reload.rect;
      this.buttonRects.stance = this.keys.stance.rect;
      this.buttonRects.melee = this.keys.stance.rect;
      this.buttonRects.swap = this.keys.swap?.rect ?? this.keys.stance.rect;
    } else {
      // 電腦：只留用品與技能的快捷格（也能點），其餘看鍵盤
      const s = 26;
      let x = W - s - 6;
      const y = H - s - 6;
      this.keys.medkit = this.actionKey(x, y, s, 'medkit', undefined, medkit, 'H');
      x -= s + 4;
      if (soldier) this.keys.skill = this.actionKey(x, y, s, 'fist', undefined, () => (heroTouch.skill = true), 'C');
    }
  }

  private actionKey(x: number, y: number, size: number, ic: IconName, label: string | undefined, onPress: () => void, hotkey?: string): ActionKey {
    const g = this.add.graphics().setDepth(99);
    const scale = 2;
    const iy = label ? y + size / 2 - 4 : y + size / 2;
    const img = this.add.image(x + size / 2, iy, iconKey(ic)).setScale(scale).setDepth(101);
    const k: ActionKey = { g, icon: img, rect: { x, y, w: size, h: size }, pressed: false, enabled: true, chamfer: size >= 34 ? 3 : 2 };
    if (label) k.label = pixelText(this, x + size / 2, y + size - 9, label, 7, '#f2ece0').setOrigin(0.5);
    if (hotkey) k.key = pixelText(this, x + size / 2, y - 1, hotkey, 7, '#f2c14e').setOrigin(0.5, 1).setDepth(102).setAlpha(KEY_ALPHA);
    if (!label) k.badge = pixelText(this, x + size - 2, y + size - 1, '', 7, '#f2ece0').setOrigin(1, 1).setDepth(102);
    const hit = this.add.zone(x, y, size, size).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => {
      if (!k.enabled || this.pauseLayer) return;
      k.pressed = true;
      this.drawKey(k);
      onPress();
    });
    const up = () => {
      k.pressed = false;
      this.drawKey(k);
    };
    hit.on('pointerup', up);
    hit.on('pointerout', up);
    this.unregister.push(registerUIRect(k.rect));
    this.drawKey(k);
    return k;
  }

  private drawKey(k: ActionKey): void {
    const { x, y, w, h } = k.rect;
    drawPlate(k.g.clear(), x, y, w, h, { state: k.pressed ? 2 : 0, enabled: true, accent: k.accent, chamfer: k.chamfer, fill: k.enabled ? PAL.plate : PAL.plateOff });
    // 按下時不透明，平時半透明
    const base = k.pressed ? 1 : KEY_ALPHA;
    const a = (k.enabled ? 1 : 0.4) * base;
    k.g.setAlpha(base);
    const sink = k.pressed ? 1 : 0;
    k.icon.setAlpha(a);
    k.icon.y = (k.label ? y + h / 2 - 4 : y + h / 2) + sink;
    k.label?.setAlpha(a);
    k.badge?.setAlpha(a);
  }

  private setKey(k: ActionKey | undefined, enabled: boolean, accent?: number): void {
    if (!k || (k.enabled === enabled && k.accent === accent)) return;
    k.enabled = enabled;
    k.accent = accent;
    this.drawKey(k);
  }

  // ───────────────────────── 暫停畫面 ─────────────────────────

  private togglePause(): void {
    if (this.pausedForRotate) return;
    if (this.pauseLayer) this.closePause();
    else this.openPause();
  }

  private openPause(): void {
    const defense = this.scene.get('Defense');
    if (!defense.scene.isActive() || !this.last) return;
    defense.scene.pause();
    AudioManager.ui('tap');
    this.buildPauseLayer(this.last);
  }

  private closePause(): void {
    this.pauseLayer?.destroy(true);
    this.pauseLayer = undefined;
    this.pauseBars.forEach((b) => b.g.destroy());
    this.pauseBars = [];
    this.pauseRects.forEach((fn) => fn());
    this.pauseRects = [];
    const defense = this.scene.get('Defense');
    if (defense.scene.isPaused() && !this.pausedForRotate) defense.scene.resume();
  }

  /**
   * 暫停畫面：左邊是選單，右邊四格依序是主角、武器、小隊、據點。
   * 畫面壓暗 80%，四格用 1px 細線分區，不再用鉚釘鐵框。
   */
  private buildPauseLayer(h: HudData): void {
    const L = this.add.container(0, 0).setDepth(300);
    this.pauseLayer = L;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      L.add(o);
      return o;
    };
    const txt = (x: number, y: number, s: string, size = 8, color = '#e8e0d0') => add(pixelText(this, x, y, s, size, color));
    add(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x08090c, 0.82).setOrigin(0).setInteractive());
    const st = GameState.data;

    // 左：標題與選單
    const lx = 24;
    txt(lx, 24, '暫停', 8, '#8a8070');
    txt(lx, 36, h.tutorial ? '開局教學' : `第 ${st.day} 夜・波 ${h.wave}/${h.totalWaves}`, 13, '#f2ece0');
    const items: { label: string; sub?: string; act: () => void; accent?: boolean }[] = [
      { label: '繼續', sub: this.touchUI ? undefined : 'Esc', act: () => this.closePause(), accent: true },
    ];
    if (h.companions.length > 0) {
      items.push({
        label: `小隊：${h.companionOrder === 'hold' ? '固守' : '跟隨'}`,
        sub: this.touchUI ? '點一下切換' : 'F',
        act: () => {
          this.scene.get('Defense').events.emit('companion-order');
          // Defense 暫停中不會送 HUD：直接翻轉顯示
          if (this.last) this.last = { ...this.last, companionOrder: this.last.companionOrder === 'hold' ? 'follow' : 'hold' };
          this.rebuildPause();
        },
      });
    }
    items.push({
      label: `音效：${AudioManager.settings.muted ? '關' : '開'}`,
      sub: this.touchUI ? undefined : 'M',
      act: () => {
        AudioManager.toggleMute();
        this.rebuildPause();
      },
    });
    if (this.tutorialMode) items.push({ label: '跳過教學', act: () => (this.closePause(), this.scene.get('Defense').events.emit('tutorial-skip')) });
    items.forEach((it, i) => {
      const y = 76 + i * 26;
      const w = 132;
      const g = add(this.add.graphics());
      drawPlate(g, lx, y, w, 22, { accent: it.accent ? PAL.amber : undefined });
      txt(lx + 10, y + 11, it.label, 8).setOrigin(0, 0.5);
      if (it.sub) txt(lx + w - 8, y + 11, it.sub, 7, '#8a8070').setOrigin(1, 0.5);
      const hit = add(this.add.zone(lx, y, w, 22).setOrigin(0).setInteractive({ useHandCursor: true }));
      hit.on('pointerdown', () => {
        AudioManager.ui('tap');
        it.act();
      });
      this.pauseRects.push(registerUIRect({ x: lx, y, w, h: 22 }));
    });

    // 右：四格
    const gx = 176;
    const gw = (GAME_WIDTH - gx - 20 - 10) / 2;
    const gh = 140;
    const cells = [
      { x: gx, y: 24, title: '主角' },
      { x: gx + gw + 10, y: 24, title: '武器' },
      { x: gx, y: 24 + gh + 10, title: '小隊' },
      { x: gx + gw + 10, y: 24 + gh + 10, title: '據點' },
    ];
    const lines = add(this.add.graphics());
    for (const c of cells) {
      lines.fillStyle(0x5a5048, 0.8).fillRect(c.x, c.y, gw, 1);
      txt(c.x, c.y + 4, c.title, 8, '#8a8070');
    }
    const bar = (x: number, y: number, w: number, r: number, color: number, dark?: number) => {
      const b = new PixelBar(this, x, y, w, 6, { color, dark, seg: 6, depth: 301 });
      b.set(r);
      b.pulseLow = false;
      this.pauseBars.push(b);
    };

    // 主角
    {
      const c = cells[0];
      const hero = GameState.hero;
      txt(c.x, c.y + 20, hero.name, 10, '#f2ece0');
      txt(c.x, c.y + 40, '生命', 7, '#b8ab98');
      bar(c.x + 30, c.y + 43, gw - 80, h.playerHp / h.playerMaxHp, PAL.hp, PAL.hpLo);
      txt(c.x + gw, c.y + 40, `${Math.ceil(h.playerHp)}/${h.playerMaxHp}`, 7).setOrigin(1, 0);
      txt(c.x, c.y + 56, '體力', 7, '#b8ab98');
      bar(c.x + 30, c.y + 59, gw - 80, h.stamina, PAL.stamina, PAL.staminaLo);
      txt(c.x + gw, c.y + 56, `${Math.round(h.stamina * 100)}%`, 7).setOrigin(1, 0);
      const hh = h.hero;
      const notes: string[] = [];
      if (hh?.skill) notes.push(`${hh.skill}：${hh.skillReady ? '就緒' : '冷卻中'}`);
      if (hh?.lastStand !== undefined) notes.push(`大難不死：${hh.lastStand ? '還在' : '用掉了'}`);
      notes.push(`醫療包 ${st.supplies.medkit}${this.touchUI ? '' : '（H）'}`);
      txt(c.x, c.y + 76, notes.join('\n'), 7, '#c8bca8').setLineSpacing(3);
    }

    // 武器
    {
      const c = cells[1];
      const reserve = h.reserve === Infinity ? '∞' : `${h.reserve}`;
      const rows: { name: string; on: boolean; info: string; key: string }[] = h.unarmed
        ? []
        : h.slots.map((n, i) => ({
            name: n,
            on: i === h.slot && !h.meleeStance,
            info: i === h.slot ? `${h.ammo}/${h.magazine}・備 ${reserve}` : '',
            key: `${i + 1}`,
          }));
      rows.push({ name: h.meleeName, on: h.meleeStance, info: '近戰', key: '4' });
      rows.forEach((r, i) => {
        const y = c.y + 22 + i * 18;
        if (r.on) lines.fillStyle(PAL.amber, 0.14).fillRect(c.x - 2, y - 2, gw + 4, 16);
        txt(c.x, y, `${this.touchUI ? '' : r.key + '  '}${r.name}`, 8, r.on ? '#f2c14e' : '#e8e0d0');
        txt(c.x + gw, y + 1, r.info, 7, '#b8ab98').setOrigin(1, 0);
      });
      if (!h.unarmed) txt(c.x, c.y + gh - 18, this.touchUI ? '換槍：右下「換槍」　近戰：「持刀」' : 'Q 換槍・R 換彈・X 持刀', 7, '#8a8070');
    }

    // 小隊
    {
      const c = cells[2];
      if (h.companions.length === 0) txt(c.x, c.y + 22, '還沒有夥伴', 8, '#6b645c');
      h.companions.forEach((m, i) => {
        const y = c.y + 22 + i * 18;
        const r = m.alive ? m.hp / m.maxHp : 0;
        add(this.add.rectangle(c.x, y + 4, 5, 5, m.alive ? m.color : 0x555555).setOrigin(0).setStrokeStyle(1, PAL.ink));
        txt(c.x + 9, y, `${m.name} ${m.title}`, 7, m.alive ? '#e8e0d0' : '#6b645c');
        bar(c.x + gw - 92, y + 4, 52, r, r > 0.5 ? PAL.base : r > 0.25 ? PAL.amber : PAL.hp);
        txt(c.x + gw, y, m.status, 7, m.alive ? '#8a8070' : '#d8402f').setOrigin(1, 0);
      });
    }

    // 據點
    {
      const c = cells[3];
      txt(c.x, c.y + 20, '據點', 7, '#b8ab98');
      bar(c.x + 30, c.y + 23, gw - 80, h.baseHp / h.baseMaxHp, PAL.base, PAL.baseLo);
      txt(c.x + gw, c.y + 20, `${Math.ceil(h.baseHp)}/${h.baseMaxHp}`, 7).setOrigin(1, 0);
      txt(c.x, c.y + 36, '路障', 7, '#b8ab98');
      bar(c.x + 30, c.y + 39, gw - 80, h.barricadeHp / h.barricadeMaxHp, PAL.wood, PAL.woodLo);
      txt(c.x + gw, c.y + 36, `${Math.ceil(h.barricadeHp)}/${h.barricadeMaxHp}`, 7).setOrigin(1, 0);
      add(icon(this, c.x, c.y + 60, 'scrap').setDepth(301).setOrigin(0));
      txt(c.x + 12, c.y + 57, `廢料 ${st.scrap}`, 8, '#f2c14e');
      add(icon(this, c.x + 90, c.y + 60, 'skull').setDepth(301).setOrigin(0));
      txt(c.x + 102, c.y + 57, `擊殺 ${h.kills}`, 8);
    }
  }

  private rebuildPause(): void {
    if (!this.pauseLayer || !this.last) return;
    this.pauseLayer.destroy(true);
    this.pauseBars.forEach((b) => b.g.destroy());
    this.pauseBars = [];
    this.pauseRects.forEach((fn) => fn());
    this.pauseRects = [];
    this.buildPauseLayer(this.last);
  }

  // ───────────────────────── 教學 ─────────────────────────

  /** 開局教學：上方提示框＋右上「跳過教學」 */
  private buildTutorial(): void {
    // 上方已經沒有面板，提示框貼著夜數那一行下面
    const w = 280;
    const x = (GAME_WIDTH - w) / 2;
    const y = 18;
    const g = this.add.graphics().setDepth(95);
    const head = pixelText(this, x + 10, y + 6, '', 10, '#f2c14e').setDepth(96);
    const progress = pixelText(this, x + w - 10, y + 7, '', 8, '#9ad17a').setOrigin(1, 0).setDepth(96);
    const hint = pixelText(this, x + 10, y + 23, '', 8, '#e8e0d0').setDepth(96).setWordWrapWidth(w - 20, true);
    const focus = this.add.graphics().setDepth(97);
    this.tut = { g, x, y, w, head, hint, progress, focus, current: null, cleared: false };
    // 跳過教學（電腦也可以從 Esc 暫停畫面跳過）
    const bw = 58;
    const bx = GAME_WIDTH - bw - (this.touchUI ? 30 : 46);
    const by = 4;
    const bg = this.add.graphics().setDepth(99);
    drawPlate(bg, bx, by, bw, 16, {});
    bg.setAlpha(KEY_ALPHA);
    pixelText(this, bx + bw / 2, by + 8, '跳過教學', 7, '#b8ab98').setOrigin(0.5).setDepth(100);
    const hit = this.add.zone(bx, by, bw, 16).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => this.scene.get('Defense').events.emit('tutorial-skip'));
    this.unregister.push(registerUIRect({ x: bx, y: by, w: bw, h: 16 }));
  }

  private onTutorial(t: TutorialHud): void {
    const u = this.tut;
    if (!u) return;
    u.head.setText(`${t.cleared ? '✓ ' : ''}${t.title}`).setColor(t.cleared ? '#9ad17a' : '#f2c14e');
    u.hint.setText(t.hint);
    u.progress.setText(`${t.progress ? t.progress + '　' : ''}${t.step}/${t.total}`);
    drawPanel(u.g.clear(), u.x, u.y, u.w, 32 + u.hint.height, { tone: t.cleared ? 'ok' : 'amber', alpha: 0.85, hazard: !t.cleared });
    // 手機才閃框提示按鈕／搖桿／射擊區（電腦版看文字的按鍵就好）
    u.current = this.touchUI && !t.cleared ? t.focus : null;
  }

  /** 教學提示：在要按的地方畫一個會呼吸的黃框 */
  private drawTutorialFocus(): void {
    const u = this.tut;
    if (!u) return;
    const g = u.focus;
    g.clear();
    const r = u.current ? this.buttonRects[u.current] : undefined;
    if (!r) return;
    const a = 0.45 + 0.45 * Math.sin(this.time.now / 160);
    const pad = 2 + 2 * Math.sin(this.time.now / 160);
    g.lineStyle(2, PAL.amber, a).strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
    if (u.current === 'fire') {
      g.fillStyle(PAL.amber, 0.08 * a).fillRect(r.x, r.y, r.w, r.h);
    }
  }

  // ───────────────────────── 每幀 ─────────────────────────

  update(_t: number, delta: number): void {
    const dt = delta / 1000;
    for (const b of this.pauseBars) b.update(dt);
    this.drawTutorialFocus();
    this.drawBaseEdge(dt);
    const g = this.stick;
    g.clear();
    if (!this.touchUI || this.pauseLayer) return;
    // 沒按時在固定位置顯示淡淡的搖桿，提示「這裡可以移動」
    const bx = joystick.active ? joystick.baseX : JOYSTICK_ZONE.x + 52;
    const by = joystick.active ? joystick.baseY : JOYSTICK_ZONE.y + JOYSTICK_ZONE.h - 52;
    const kx = joystick.active ? joystick.knobX : bx;
    const ky = joystick.active ? joystick.knobY : by;
    const a = joystick.active ? 0.55 : 0.25;
    g.lineStyle(2, PAL.ink, a * 0.8).strokeCircle(bx, by, JOYSTICK_RADIUS + 1);
    g.lineStyle(1, PAL.frameHi, a).strokeCircle(bx, by, JOYSTICK_RADIUS);
    g.fillStyle(PAL.ink, a * 0.8).fillCircle(kx, ky + 1, 11);
    g.fillStyle(PAL.frameHi, a * 1.2).fillCircle(kx, ky, 10);
  }

  /** 據點被打：那一側的畫面邊緣泛紅；耐久低於 35% 時一直微微泛紅 */
  private drawBaseEdge(dt: number): void {
    this.baseHit = Math.max(0, this.baseHit - dt * 1.2);
    const h = this.last;
    const low = h && !h.tutorial && h.baseHp > 0 && h.baseHp / h.baseMaxHp < 0.35 ? 0.35 + 0.15 * Math.sin(this.time.now / 300) : 0;
    const a = Math.max(low, this.baseHit);
    const g = this.edgeG.clear();
    if (a <= 0.01) return;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const w = 3;
      const x = this.baseSide < 0 ? i * w : GAME_WIDTH - (i + 1) * w;
      g.fillStyle(0xc4161c, a * 0.55 * (1 - i / steps)).fillRect(x, 0, w, GAME_HEIGHT);
    }
  }

  private onHud(h: HudData): void {
    this.last = h;

    // 上方一行
    this.waveText.setText(h.tutorial ? '開局教學' : `第 ${GameState.data.day} 夜`);
    if (h.tutorial) {
      this.waveText.setOrigin(0.5, 0);
      this.wavePips.clear();
    } else this.drawWavePips(h.wave, h.totalWaves);

    // 小隊指令切換（F 或暫停畫面）：上方短暫提示
    const order = h.companions.length > 0 ? h.companionOrder : undefined;
    if (order && this.lastOrder && order !== this.lastOrder) this.showToast(`小隊：${order === 'hold' ? '固守' : '跟隨'}`);
    this.lastOrder = order;

    // 動作鍵
    const s = GameState.data.supplies;
    this.keys.medkit?.badge?.setText(`${s.medkit}`);
    this.setKey(this.keys.medkit, s.medkit > 0);
    const hh = h.hero;
    if (this.keys.skill) {
      this.setKey(this.keys.skill, !!hh?.skillReady, hh?.skillReady ? PAL.amber : undefined);
      this.keys.skill.badge?.setText(hh?.skillReady ? '' : '…');
    }
    const st = this.keys.stance;
    if (st) {
      // 持刀／持槍：圖示顯示「按下去會換成什麼」
      const toKnife = !h.meleeStance;
      const want = toKnife ? 'knife' : 'gun';
      if (st.icon.texture.key !== iconKey(want)) st.icon.setTexture(iconKey(want));
      st.label?.setText(h.unarmed ? '近戰' : toKnife ? '持刀' : '持槍');
      this.setKey(st, !h.unarmed, h.meleeStance ? PAL.amber : undefined);
    }
    this.setKey(this.keys.reload, !h.meleeStance && !h.unarmed && h.ammo < h.magazine && !h.reloading);
    this.setKey(this.keys.swap, !h.unarmed && h.slots.length > 1);
    if (this.keys.scope) this.setKey(this.keys.scope, !h.meleeStance && !!getFirearm(h.weaponId)?.scope);
  }

  private onWaveStart(wave: number, total: number, horde = false): void {
    if (this.tut) return;
    if (horde) {
      this.hordeBanner(wave === total);
      return;
    }
    const label = wave === total ? '最後一波！' : `第 ${wave} 波來襲`;
    const w = 150;
    const x = (GAME_WIDTH - w) / 2;
    const y = 104;
    const g = this.add.graphics().setDepth(110);
    drawPanel(g, x, y, w, 30, { tone: 'danger', alpha: 0.88, hazard: true });
    const t = pixelText(this, GAME_WIDTH / 2, y + 15, label, 14, '#ff8a70').setOrigin(0.5).setDepth(111);
    this.tweens.add({ targets: [g, t], alpha: 0, delay: 1000, duration: 500, onComplete: () => (g.destroy(), t.destroy()) });
  }

  /** 屍潮預警：畫面上方閃爍的一行字，邊緣開始泛紅 */
  private onHordeWarning(seconds: number): void {
    if (this.tut) return;
    const t = pixelText(this, GAME_WIDTH / 2, 92, '遠方傳來嘶吼……屍潮逼近！', 10, '#ffb08a')
      .setOrigin(0.5)
      .setDepth(111)
      .setStroke('#000000', 3);
    this.tweens.add({ targets: t, alpha: 0.25, duration: 260, yoyo: true, repeat: Math.max(1, Math.floor((seconds * 1000) / 520) - 1), onComplete: () => t.destroy() });
    this.edgeGlow(seconds * 1000, 0.25);
  }

  /** 屍潮開始：大號危險橫幅 + 畫面四邊紅光脈動 */
  private hordeBanner(last: boolean): void {
    const w = 220;
    const x = (GAME_WIDTH - w) / 2;
    const y = 98;
    const g = this.add.graphics().setDepth(110);
    drawPanel(g, x, y, w, 42, { tone: 'danger', alpha: 0.92, hazard: true });
    const t = pixelText(this, GAME_WIDTH / 2, y + 15, '屍潮來襲！', 18, '#ff6a50').setOrigin(0.5).setDepth(111);
    const sub = pixelText(this, GAME_WIDTH / 2, y + 33, last ? '最後一波　撐過去就天亮' : '守住路障　小心狂奔屍', 8, '#f2ece0').setOrigin(0.5).setDepth(111);
    t.setScale(1.6);
    this.tweens.add({ targets: t, scale: 1, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: [g, t, sub], alpha: 0, delay: 1800, duration: 600, onComplete: () => (g.destroy(), t.destroy(), sub.destroy()) });
    this.edgeGlow(6000, 0.45);
  }

  /** 畫面四邊的紅光，脈動 ms 毫秒後淡出 */
  private edgeGlow(ms: number, peak: number): void {
    const g = this.add.graphics().setDepth(95);
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const a = (1 - i / steps) * 0.5;
      const d = i * 4;
      g.fillStyle(0xa01010, a);
      g.fillRect(d, d, GAME_WIDTH - d * 2, 4);
      g.fillRect(d, GAME_HEIGHT - d - 4, GAME_WIDTH - d * 2, 4);
      g.fillRect(d, d + 4, 4, GAME_HEIGHT - d * 2 - 8);
      g.fillRect(GAME_WIDTH - d - 4, d + 4, 4, GAME_HEIGHT - d * 2 - 8);
    }
    g.setAlpha(0);
    this.tweens.add({ targets: g, alpha: peak, duration: 420, yoyo: true, repeat: Math.max(0, Math.round(ms / 840) - 1), onComplete: () => g.destroy() });
  }

  private buildRotateHint(): void {
    const bg = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.9).setOrigin(0);
    const text = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, '請將手機轉為橫向', 16).setOrigin(0.5);
    this.rotateHint = this.add.container(0, 0, [bg, text]).setDepth(1000);
  }

  private applyOrientation(portraitNow: boolean): void {
    const portrait = this.sys.game.device.input.touch && portraitNow;
    this.rotateHint.setVisible(portrait);
    const defense = this.scene.get('Defense');
    if (portrait && defense.scene.isActive()) {
      defense.scene.pause();
      this.pausedForRotate = true;
    } else if (!portrait && this.pausedForRotate) {
      // 只恢復「因為直向而暫停」的情況，不誤解除其他暫停（暫停畫面開著就維持暫停）
      this.pausedForRotate = false;
      if (defense.scene.isPaused() && !this.pauseLayer) defense.scene.resume();
    }
  }
}
