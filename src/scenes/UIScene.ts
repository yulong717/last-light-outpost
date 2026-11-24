import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { heroTouch } from '../systems/HeroSystem';
import { JOYSTICK_RADIUS, JOYSTICK_ZONE, joystick, queueAction, registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import { AudioManager } from '../audio/AudioManager';
import { PAL, PixelBar, drawPanel, drawPlate, ensureUiTextures, icon, iconKey, type IconName } from '../ui/theme';
import type { HudData } from './DefenseScene';
import type { TutorialHud } from '../systems/Tutorial';
import type { TutorialFocus } from '../data/tutorial';

type Rect = { x: number; y: number; w: number; h: number };

/** 左上主角面板 */
const PX = 4;
const PY = 4;
const PW = 180;
/** 面板內容左緣 */
const CX = PX + 6;
/** 彈匣格最多畫幾格，再多就改成彈藥條 */
const MAX_PIPS = 14;

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
 * 夜晚戰鬥 HUD，疊在 DefenseScene 上。外觀統一走 src/ui/theme.ts 的鏽鐵像素風。
 *
 * 版面：
 * - 左上「主角面板」：生命、體力、手上的武器與彈匣（彈匣畫成一顆顆子彈）、武器槽
 * - 左上面板下方「小隊」：夥伴血條；點標題列切換固守／跟隨（電腦 F）
 * - 上方中央「夜牌」：第幾夜、波次格、據點與路障耐久
 * - 右上：廢料、擊殺、靜音
 * - 觸控右下：換彈、持刀／持槍、手雷、醫療（馬克多一顆擊倒）；點左上武器欄換下一把槍
 * - 電腦右下：只留手雷／醫療／技能的快捷格（G／H／C），其他都用鍵盤
 */
export class UIScene extends Phaser.Scene {
  private touchUI = false;
  private stick!: Phaser.GameObjects.Graphics;
  private rotateHint!: Phaser.GameObjects.Container;
  /** 轉向後補查的計時器 */
  private orientTimers: number[] = [];
  /** 是不是因為直向才暫停戰鬥（只解除自己造成的暫停） */
  private pausedForRotate = false;
  private unregister: (() => void)[] = [];
  private last?: HudData;

  // 主角面板
  private panelG!: Phaser.GameObjects.Graphics;
  private panelH = 0;
  private hpBar!: PixelBar;
  private staminaBar!: PixelBar;
  private weaponIcon!: Phaser.GameObjects.Image;
  private weaponName!: Phaser.GameObjects.Text;
  private reserveText!: Phaser.GameObjects.Text;
  private styleText!: Phaser.GameObjects.Text;
  private pipsG!: Phaser.GameObjects.Graphics;
  private slotText!: Phaser.GameObjects.Text;
  private heroText!: Phaser.GameObjects.Text;
  private weaponRect: Rect = { x: PX, y: PY + 24, w: PW, h: 40 };

  // 夜牌
  private waveText!: Phaser.GameObjects.Text;
  private wavePips!: Phaser.GameObjects.Graphics;
  private baseBar!: PixelBar;
  private barricadeBar!: PixelBar;

  // 右上
  private scrapText!: Phaser.GameObjects.Text;
  private killText!: Phaser.GameObjects.Text;

  // 小隊
  private crewG?: Phaser.GameObjects.Graphics;
  private crewRect?: Rect;
  private orderText?: Phaser.GameObjects.Text;
  private crewRows: {
    mark: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text;
    bar: PixelBar;
    status: Phaser.GameObjects.Text;
  }[] = [];

  // 動作鍵
  private keys: Partial<Record<'reload' | 'stance' | 'grenade' | 'medkit' | 'skill', ActionKey>> = {};
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
    this.crewRows = [];
    this.crewG = undefined;
    this.crewRect = undefined;
    this.orderText = undefined;
    this.touchUI = this.sys.game.device.input.touch;

    this.buildPlayerPanel();
    this.buildNightPlate();
    this.buildTopRight();
    this.buildActions();

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
    // 轉向偵測：Phaser 的 ORIENTATION_CHANGE 觸發時，手機瀏覽器（尤其 iOS）的視窗尺寸常常還沒更新，
    // 讀到的是轉向前的寬高，提示就會卡住、要再轉一次才對。所以同時聽瀏覽器的各種轉向／尺寸事件，
    // 並在之後幾個時間點再補查幾次，等尺寸穩定。
    const onTurn = () => this.queueOrientationCheck();
    const portraitMq = window.matchMedia?.('(orientation: portrait)');
    this.scale.on(Phaser.Scale.Events.ORIENTATION_CHANGE, onTurn);
    window.addEventListener('resize', onTurn);
    window.addEventListener('orientationchange', onTurn);
    window.visualViewport?.addEventListener('resize', onTurn);
    screen.orientation?.addEventListener?.('change', onTurn);
    portraitMq?.addEventListener?.('change', onTurn);
    this.unregister.push(() => {
      this.scale.off(Phaser.Scale.Events.ORIENTATION_CHANGE, onTurn);
      window.removeEventListener('resize', onTurn);
      window.removeEventListener('orientationchange', onTurn);
      window.visualViewport?.removeEventListener('resize', onTurn);
      screen.orientation?.removeEventListener?.('change', onTurn);
      portraitMq?.removeEventListener?.('change', onTurn);
      this.orientTimers.forEach((t) => window.clearTimeout(t));
    });
    this.checkOrientation();

    const defense = this.scene.get('Defense');
    defense.events.on('hud', this.onHud, this);
    defense.events.on('wave-start', this.onWaveStart, this);
    defense.events.on('horde-warning', this.onHordeWarning, this);
    if (data.tutorial) this.buildTutorial();
    defense.events.on('tutorial', this.onTutorial, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      defense.events.off('hud', this.onHud, this);
      defense.events.off('wave-start', this.onWaveStart, this);
      defense.events.off('horde-warning', this.onHordeWarning, this);
      defense.events.off('tutorial', this.onTutorial, this);
      this.unregister.forEach((fn) => fn());
    });
  }

  // ───────────────────────── 主角面板 ─────────────────────────

  private buildPlayerPanel(): void {
    this.panelG = this.add.graphics().setDepth(99);
    icon(this, CX, PY + 6, 'heart');
    this.hpBar = new PixelBar(this, CX + 12, PY + 6, 118, 8, { color: PAL.hp, dark: PAL.hpLo, seg: 6 });
    icon(this, CX + 1, PY + 15, 'bolt');
    this.staminaBar = new PixelBar(this, CX + 12, PY + 17, 118, 5, { color: PAL.stamina, dark: PAL.staminaLo });
    this.staminaBar.pulseLow = true;
    this.heroText = pixelText(this, CX + 134, PY + 5, '', 7, '#c8bca8').setOrigin(0, 0).setWordWrapWidth(32);

    // 武器列：圖示＋名稱＋彈匣
    const wy = PY + 27;
    this.weaponIcon = this.add.image(CX + 20, wy + 10, '__DEFAULT').setOrigin(0.5).setDepth(101).setVisible(false);
    this.weaponName = pixelText(this, CX + 45, wy - 1, '', 8, '#f2ece0');
    this.reserveText = pixelText(this, PX + PW - 7, wy - 1, '', 7, '#b8ab98').setOrigin(1, 0);
    this.pipsG = this.add.graphics().setDepth(101);
    this.styleText = pixelText(this, CX + 45, wy + 12, '', 7, '#b8ab98');
    this.slotText = pixelText(this, CX, wy + 25, '', 7, '#8a8070');
    this.weaponRect = { x: PX, y: wy - 3, w: PW, h: 38 };
    // 觸控：點武器欄換下一把槍（電腦用 Q／1／2／3）
    const hit = this.add.zone(this.weaponRect.x, this.weaponRect.y, this.weaponRect.w, this.weaponRect.h).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => {
      const h = this.last;
      if (!h || h.unarmed || h.slots.length < 2 || h.meleeStance) return;
      AudioManager.ui('tap');
      queueAction('next');
    });
    this.unregister.push(registerUIRect(this.weaponRect));
    this.layoutPanel(false);
  }

  /** 面板高度跟著內容（有沒有技能列）變 */
  private layoutPanel(hasHero: boolean): void {
    const h = 66 + (hasHero ? 0 : 0);
    if (h === this.panelH) return;
    this.panelH = h;
    const g = this.panelG.clear();
    drawPanel(g, PX, PY, PW, h, { alpha: 0.82 });
    // 生命與武器之間的分隔線
    g.fillStyle(PAL.frameLo, 1).fillRect(PX + 5, PY + 25, PW - 10, 1);
    g.fillStyle(PAL.frame, 1).fillRect(PX + 5, PY + 26, PW - 10, 1);
    // 武器圖示的底框
    g.fillStyle(PAL.ink, 0.6).fillRect(CX, PY + 28, 41, 19);
    g.lineStyle(1, PAL.frameLo, 1).strokeRect(CX + 0.5, PY + 28.5, 40, 18);
    this.layoutCrew();
  }

  /** 彈匣：一顆顆子彈；彈匣太大就畫成分格彈藥條 */
  private drawAmmo(h: HudData): void {
    const g = this.pipsG.clear();
    const x0 = CX + 45;
    const y0 = PY + 39;
    const maxW = PW - (x0 - PX) - 8;
    if (h.meleeStance) {
      // 近戰：連段格
      const c = h.meleeChain;
      const n = Math.max(1, c.len);
      for (let i = 0; i < n; i++) {
        const x = x0 + i * 9;
        g.fillStyle(PAL.ink, 1).fillRect(x, y0 + 1, 7, 5);
        g.fillStyle(i < c.idx ? PAL.amber : 0x3a3530, 1).fillRect(x + 1, y0 + 2, 5, 3);
      }
      return;
    }
    if (h.reloading) {
      g.fillStyle(PAL.ink, 1).fillRect(x0, y0 + 1, maxW, 5);
      g.fillStyle(0x3a3530, 1).fillRect(x0 + 1, y0 + 2, maxW - 2, 3);
      g.fillStyle(PAL.amber, 1).fillRect(x0 + 1, y0 + 2, Math.round((maxW - 2) * h.reloadProgress), 3);
      return;
    }
    const mag = Math.max(1, h.magazine);
    if (mag <= MAX_PIPS) {
      const step = Math.min(6, Math.floor(maxW / mag));
      for (let i = 0; i < mag; i++) {
        const x = x0 + i * step;
        const full = i < h.ammo;
        g.fillStyle(PAL.ink, 1).fillRect(x, y0, Math.max(3, step - 1), 7);
        g.fillStyle(full ? PAL.brass : 0x34302b, 1).fillRect(x + 1, y0 + 2, Math.max(1, step - 3), 4);
        if (full) g.fillStyle(0xe0844a, 1).fillRect(x + 1, y0 + 1, Math.max(1, step - 3), 1);
      }
    } else {
      // 大彈匣：分格條（每格 5 發）
      g.fillStyle(PAL.ink, 1).fillRect(x0, y0, maxW, 7);
      g.fillStyle(0x34302b, 1).fillRect(x0 + 1, y0 + 1, maxW - 2, 5);
      const fw = Math.round((maxW - 2) * (h.ammo / mag));
      g.fillStyle(h.ammo / mag < 0.25 ? PAL.blood : PAL.brass, 1).fillRect(x0 + 1, y0 + 1, fw, 5);
      g.fillStyle(0xe0844a, 1).fillRect(x0 + 1, y0 + 1, fw, 1);
      const seg = (maxW - 2) / (mag / 5);
      g.fillStyle(PAL.ink, 0.7);
      for (let sx = seg; sx < maxW - 2; sx += seg) g.fillRect(Math.round(x0 + 1 + sx), y0 + 1, 1, 5);
    }
  }

  // ───────────────────────── 夜牌（上方中央） ─────────────────────────

  private buildNightPlate(): void {
    const w = 176;
    const x = Math.round((GAME_WIDTH - w) / 2);
    const y = 4;
    const g = this.add.graphics().setDepth(99);
    drawPanel(g, x, y, w, 34, { alpha: 0.82, tone: 'danger' });
    this.waveText = pixelText(this, x + 8, y + 3, '', 8, '#f2ece0');
    this.wavePips = this.add.graphics().setDepth(101);
    icon(this, x + 7, y + 20, 'base');
    this.baseBar = new PixelBar(this, x + 18, y + 22, 62, 6, { color: PAL.base, dark: PAL.baseLo, seg: 6 });
    icon(this, x + 90, y + 20, 'barricade');
    this.barricadeBar = new PixelBar(this, x + 101, y + 22, 68, 6, { color: PAL.wood, dark: PAL.woodLo, seg: 6 });
  }

  private drawWavePips(wave: number, total: number): void {
    const g = this.wavePips.clear();
    const w = 176;
    const x0 = Math.round((GAME_WIDTH - w) / 2) + w - 8;
    for (let i = 0; i < total; i++) {
      const x = x0 - (total - i) * 7;
      g.fillStyle(PAL.ink, 1).fillRect(x, 9, 6, 6);
      g.fillStyle(i < wave - 1 ? 0x6b5f52 : i === wave - 1 ? PAL.blood : 0x2a2522, 1).fillRect(x + 1, 10, 4, 4);
    }
  }

  // ───────────────────────── 右上 ─────────────────────────

  private buildTopRight(): void {
    const w = 104;
    const x = GAME_WIDTH - w - 4;
    const g = this.add.graphics().setDepth(99);
    drawPanel(g, x, 4, w, 18, { alpha: 0.82, rivets: false });
    icon(this, x + 6, 9, 'scrap');
    this.scrapText = pixelText(this, x + 17, 5, '', 8, '#f2c14e');
    icon(this, x + 56, 9, 'skull');
    this.killText = pixelText(this, x + 67, 5, '', 8, '#f2ece0');
    // 靜音（電腦也可按 M）
    const s = 20;
    const mx = GAME_WIDTH - s - 4;
    const my = 25;
    const mg = this.add.graphics().setDepth(99);
    drawPlate(mg, mx, my, s, s, { chamfer: 1 });
    const ic = this.add.image(mx + s / 2, my + s / 2 - 1, iconKey('sound')).setDepth(101);
    const refresh = () => ic.setTexture(iconKey(AudioManager.settings.muted ? 'mute' : 'sound'));
    refresh();
    const hit = this.add.zone(mx, my, s, s).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => AudioManager.toggleMute());
    this.unregister.push(AudioManager.onChange(refresh), registerUIRect({ x: mx, y: my, w: s, h: s }));
  }

  // ───────────────────────── 動作鍵 ─────────────────────────

  private buildActions(): void {
    const W = GAME_WIDTH;
    const H = GAME_HEIGHT;
    const soldier = GameState.data.hero === 'soldier';
    if (this.touchUI) {
      // 拇指弧線：最常按的換彈最大、最靠角落
      this.keys.reload = this.actionKey(W - 52, H - 52, 46, 'reload', '換彈', () => queueAction('reload'));
      this.keys.stance = this.actionKey(W - 102, H - 46, 40, 'knife', '持刀', () => queueAction('stance'));
      this.keys.grenade = this.actionKey(W - 46, H - 92, 34, 'grenade', undefined, () => this.scene.get('Defense').events.emit('use-grenade'));
      this.keys.medkit = this.actionKey(W - 84, H - 88, 34, 'medkit', undefined, () => this.scene.get('Defense').events.emit('use-medkit'));
      if (soldier) this.keys.skill = this.actionKey(W - 144, H - 40, 34, 'fist', undefined, () => (heroTouch.skill = true));
      this.buttonRects.reload = this.keys.reload.rect;
      this.buttonRects.stance = this.keys.stance.rect;
      this.buttonRects.melee = this.keys.stance.rect;
      this.buttonRects.swap = this.keys.stance.rect;
    } else {
      // 電腦：只留用品與技能的快捷格（也能點），其餘看鍵盤
      const s = 28;
      let x = W - s - 6;
      const y = H - s - 6;
      this.keys.medkit = this.actionKey(x, y, s, 'medkit', undefined, () => this.scene.get('Defense').events.emit('use-medkit'), 'H');
      x -= s + 4;
      this.keys.grenade = this.actionKey(x, y, s, 'grenade', undefined, () => this.scene.get('Defense').events.emit('use-grenade'), 'G');
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
    if (hotkey) k.key = pixelText(this, x + size / 2, y - 1, hotkey, 7, '#f2c14e').setOrigin(0.5, 1).setDepth(102);
    if (!label) k.badge = pixelText(this, x + size - 2, y + size - 1, '', 7, '#f2ece0').setOrigin(1, 1).setDepth(102);
    const hit = this.add.zone(x, y, size, size).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => {
      if (!k.enabled) return;
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
    const a = k.enabled ? 1 : 0.35;
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

  // ───────────────────────── 小隊 ─────────────────────────

  private layoutCrew(): void {
    if (!this.crewG) return;
    const n = this.crewRows.length;
    const y = PY + this.panelH + 3;
    const h = 20 + n * 12;
    const g = this.crewG.clear();
    drawPanel(g, PX, y, PW, h, { alpha: 0.78, rivets: false });
    g.fillStyle(PAL.frameLo, 1).fillRect(PX + 5, y + 16, PW - 10, 1);
    this.crewRows.forEach((r, i) => {
      const ry = y + 19 + i * 12;
      r.mark.setPosition(CX, ry + 3);
      r.label.setPosition(CX + 8, ry - 1);
      r.bar.y = ry + 3;
      r.status.setPosition(PX + PW - 7, ry - 1);
    });
    if (this.crewRect) {
      this.crewRect.y = y;
    }
  }

  /** 第一次收到 HUD 資料時才建夥伴名單（人數依存檔而定）；沒有夥伴就不顯示 */
  private buildCrew(): void {
    const defense = this.scene.get('Defense');
    this.crewG = this.add.graphics().setDepth(99);
    const y = PY + this.panelH + 3;
    // 標題列：點一下切換固守／跟隨（電腦 F）
    const head = this.add.container(0, 0).setDepth(101);
    const ic = this.add.image(CX, y + 5, iconKey('crew')).setOrigin(0);
    const t = pixelText(this, CX + 10, y + 3, '小隊', 7, '#b8ab98');
    this.orderText = pixelText(this, PX + PW - 7, y + 3, '', 7, '#f2c14e').setOrigin(1, 0);
    head.add([ic, t]);
    this.crewRect = { x: PX, y, w: PW, h: 17 };
    const hit = this.add.zone(PX, y, PW, 17).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => {
      AudioManager.ui('tap');
      defense.events.emit('companion-order');
    });
    this.unregister.push(registerUIRect(this.crewRect));
  }

  private addCrewRows(count: number): void {
    for (let i = this.crewRows.length; i < count; i++) {
      const mark = this.add.rectangle(0, 0, 5, 5, 0xffffff).setOrigin(0).setStrokeStyle(1, PAL.ink).setDepth(101);
      const label = pixelText(this, 0, 0, '', 7);
      const bar = new PixelBar(this, CX + 82, 0, 40, 5, { color: PAL.base, seg: 5, depth: 101 });
      bar.pulseLow = false;
      const status = pixelText(this, 0, 0, '', 7, '#8a8070').setOrigin(1, 0);
      this.crewRows.push({ mark, label, bar, status });
    }
    this.layoutCrew();
  }

  private updateCrew(h: HudData): void {
    if (h.companions.length === 0) return;
    if (!this.crewG) this.buildCrew();
    if (h.companions.length > this.crewRows.length) this.addCrewRows(h.companions.length);
    h.companions.forEach((c, i) => {
      const row = this.crewRows[i];
      if (!row) return;
      const ratio = c.alive ? c.hp / c.maxHp : 0;
      row.mark.setFillStyle(c.alive ? c.color : 0x555555);
      row.label.setText(`${c.name} ${c.title}`).setColor(c.alive ? '#e8e0d0' : '#6b645c');
      row.bar.set(ratio, ratio > 0.5 ? PAL.base : ratio > 0.25 ? PAL.amber : PAL.hp);
      row.status.setText(c.status).setColor(c.alive ? '#8a8070' : '#d8402f');
    });
    const hold = h.companionOrder === 'hold';
    this.orderText?.setText(`${hold ? '固守' : '跟隨'}${this.touchUI ? ' ⇄' : '  F'}`);
  }

  // ───────────────────────── 教學 ─────────────────────────

  /** 開局教學：上方提示框＋右上「跳過教學」 */
  private buildTutorial(): void {
    // 夾在左上主角面板與右上之間，不疊到面板
    const w = 264;
    const x = (GAME_WIDTH - w) / 2;
    const y = 44;
    const g = this.add.graphics().setDepth(95);
    const head = pixelText(this, x + 10, y + 6, '', 10, '#f2c14e').setDepth(96);
    const progress = pixelText(this, x + w - 10, y + 7, '', 8, '#9ad17a').setOrigin(1, 0).setDepth(96);
    const hint = pixelText(this, x + 10, y + 23, '', 8, '#e8e0d0').setDepth(96).setWordWrapWidth(w - 20, true);
    const focus = this.add.graphics().setDepth(97);
    this.tut = { g, x, y, w, head, hint, progress, focus, current: null, cleared: false };
    // 跳過教學（電腦也可按 Esc）
    const bw = 64;
    const bx = GAME_WIDTH - bw - 26;
    const by = 25;
    const bg = this.add.graphics().setDepth(99);
    drawPlate(bg, bx, by, bw, 18, {});
    pixelText(this, bx + bw / 2, by + 8, this.touchUI ? '跳過教學' : '跳過 Esc', 7, '#b8ab98').setOrigin(0.5);
    const hit = this.add.zone(bx, by, bw, 18).setOrigin(0).setInteractive();
    hit.on('pointerdown', () => this.scene.get('Defense').events.emit('tutorial-skip'));
    this.unregister.push(registerUIRect({ x: bx, y: by, w: bw, h: 18 }));
  }

  private onTutorial(t: TutorialHud): void {
    const u = this.tut;
    if (!u) return;
    u.head.setText(`${t.cleared ? '✓ ' : ''}${t.title}`).setColor(t.cleared ? '#9ad17a' : '#f2c14e');
    u.hint.setText(t.hint);
    u.progress.setText(`${t.progress ? t.progress + '　' : ''}${t.step}/${t.total}`);
    drawPanel(u.g.clear(), u.x, u.y, u.w, 32 + u.hint.height, { tone: t.cleared ? 'ok' : 'amber', alpha: 0.9, hazard: !t.cleared });
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
    this.hpBar.update(dt);
    this.staminaBar.update(dt);
    this.baseBar.update(dt);
    this.barricadeBar.update(dt);
    for (const r of this.crewRows) r.bar.update(dt);
    this.drawTutorialFocus();
    const g = this.stick;
    g.clear();
    if (!this.touchUI) return;
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

  private onHud(h: HudData): void {
    this.last = h;
    this.updateCrew(h);
    this.hpBar.set(h.playerHp / h.playerMaxHp);
    this.baseBar.set(h.baseHp / h.baseMaxHp);
    this.barricadeBar.set(h.barricadeHp / h.barricadeMaxHp);
    // 體力見底時閃紅
    this.staminaBar.set(h.stamina, h.stamina < 0.25 && Math.floor(this.time.now / 160) % 2 === 0 ? PAL.blood : PAL.stamina);

    // 武器列
    const reserve = h.reserve === Infinity ? '∞' : `${h.reserve}`;
    if (h.meleeStance) {
      const c = h.meleeChain;
      this.weaponName.setText(h.meleeName).setColor('#f2c14e');
      this.reserveText.setText(c.streak > 1 ? `連擊 ${c.streak}` : '');
      // 只顯示下一招的名字，不把整串招式表塞進來
      const style = c.names ? `▸${c.names[c.idx % c.names.length]}` : c.len > 1 ? `快砍 ${c.len} 下` : '重擊';
      this.styleText.setText(style).setPosition(CX + 45 + Math.max(1, c.len) * 9 + 4, PY + 37);
    } else {
      this.weaponName.setText(h.weaponName).setColor(h.ammo === 0 && !h.reloading ? '#ff6b6b' : '#f2ece0');
      this.reserveText.setText(`備 ${reserve}`).setColor(h.reserve === 0 ? '#ff6b6b' : '#b8ab98');
      this.styleText.setText('');
    }
    this.drawAmmo(h);
    const iconKeyW = h.meleeStance ? `wpn_${h.meleeId}_icon` : `wpn_${h.weaponId}_icon`;
    if (this.textures.exists(iconKeyW)) {
      if (this.weaponIcon.texture.key !== iconKeyW) {
        this.weaponIcon.setTexture(iconKeyW);
      }
      this.weaponIcon.setVisible(true).setAlpha(h.reloading && !h.meleeStance ? 0.5 : 1);
    } else this.weaponIcon.setVisible(false);

    // 武器槽：目前拿的那把亮起來
    if (h.unarmed) this.slotText.setText(this.touchUI ? '點畫面揮擊，按住連續揮' : '左鍵／右鍵／V 揮擊，按住連續揮');
    else {
      const guns = h.slots.map((n, i) => {
        const k = this.touchUI ? '' : `${i + 1}·`;
        return i === h.slot && !h.meleeStance ? `▸${k}${n}` : `${k}${n}`;
      });
      const melee = `${h.meleeStance ? '▸' : ''}${this.touchUI ? '' : '4·'}${h.meleeName}`;
      this.slotText.setText([...guns, melee].join('   '));
    }

    // 主角狀態（技能、被抓）
    const hh = h.hero;
    let heroLine = '';
    if (hh) {
      if (hh.grabbed) heroLine = hh.grabbed > 1 ? `被${hh.grabbed}隻纏住` : '被抓住！';
      else if (hh.sprinting) heroLine = '衝刺中';
      else if (hh.lastStand !== undefined) heroLine = hh.lastStand ? '不死 ✓' : '不死 ✗';
    }
    this.heroText.setText(heroLine).setColor(hh?.grabbed ? '#ff6b6b' : '#c8bca8');

    // 夜牌
    this.waveText.setText(h.tutorial ? '開局教學' : `第 ${GameState.data.day} 夜　波 ${h.wave}/${h.totalWaves}`);
    if (!h.tutorial) this.drawWavePips(h.wave, h.totalWaves);
    this.scrapText.setText(`${GameState.data.scrap}`);
    this.killText.setText(`${h.kills}`);

    // 動作鍵
    const s = GameState.data.supplies;
    this.keys.grenade?.badge?.setText(`${s.grenade}`);
    this.keys.medkit?.badge?.setText(`${s.medkit}`);
    this.setKey(this.keys.grenade, s.grenade > 0);
    this.setKey(this.keys.medkit, s.medkit > 0);
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

  /** 現在是不是直向：優先用 screen.orientation（轉向事件發生時就已更新），其次 media query，最後才比視窗寬高 */
  private isPortrait(): boolean {
    if (!this.sys.game.device.input.touch) return false;
    const type = screen.orientation?.type;
    if (type) return type.startsWith('portrait');
    const mq = window.matchMedia?.('(orientation: portrait)');
    if (mq) return mq.matches;
    return window.innerHeight > window.innerWidth;
  }

  /** 轉向／尺寸改變：馬上查一次，之後再補查幾次（瀏覽器轉完才更新尺寸），順便讓 Phaser 重新算縮放 */
  private queueOrientationCheck(): void {
    this.orientTimers.forEach((t) => window.clearTimeout(t));
    this.checkOrientation();
    this.orientTimers = [120, 350, 800].map((ms) =>
      window.setTimeout(() => {
        if (!this.sys.isActive() && !this.sys.isPaused()) return;
        this.scale.refresh();
        this.checkOrientation();
      }, ms),
    );
  }

  private checkOrientation(): void {
    const portrait = this.isPortrait();
    this.rotateHint.setVisible(portrait);
    const defense = this.scene.get('Defense');
    if (portrait && defense.scene.isActive()) {
      defense.scene.pause();
      this.pausedForRotate = true;
    } else if (!portrait && this.pausedForRotate) {
      this.pausedForRotate = false;
      if (defense.scene.isPaused()) defense.scene.resume();
    }
  }
}
