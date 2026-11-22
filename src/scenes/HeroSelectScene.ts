import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { HEROES, HERO_ORDER, type HeroId } from '../data/heroes';
import { getZone } from '../data/explore';
import { AMMO, getWeapon, type AmmoType } from '../data/weapons';
import { uiButton } from '../explore/ui';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';

const CARD_W = 200;
const CARD_H = 286;
const GAP = 10;

/**
 * 開局選角：三位主角的起始武器、生命、開局地點、技能都不同。
 * 鍵盤 ←→ 或 1／2／3 選，空白鍵／Enter 開始；Esc 回標題。
 */
export class HeroSelectScene extends Phaser.Scene {
  private pick: HeroId = 'student';
  private cards = new Map<HeroId, Phaser.GameObjects.Rectangle>();
  private started = false;

  constructor() {
    super('HeroSelect');
  }

  create(): void {
    this.started = false;
    this.cards.clear();
    AudioManager.setMood('menu');
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0d0f14).setOrigin(0);
    pixelText(this, GAME_WIDTH / 2, 8, '選擇你的倖存者', 12, '#f5d76e').setOrigin(0.5, 0);

    const x0 = (GAME_WIDTH - (CARD_W * 3 + GAP * 2)) / 2;
    HERO_ORDER.forEach((id, i) => this.card(id, x0 + i * (CARD_W + GAP), 30));
    this.refresh();

    uiButton(this, GAME_WIDTH / 2 - 80, GAME_HEIGHT - 34, 160, 26, '開始 ▶', () => this.start(), { fill: 0x7a2a22, size: 10 });
    pixelText(this, 10, GAME_HEIGHT - 26, 'Esc 返回', 8, '#6b7280');

    const kb = this.input.keyboard;
    kb?.on('keydown-LEFT', () => this.move(-1));
    kb?.on('keydown-RIGHT', () => this.move(1));
    kb?.on('keydown-A', () => this.move(-1));
    kb?.on('keydown-D', () => this.move(1));
    kb?.on('keydown-ONE', () => this.select('student'));
    kb?.on('keydown-TWO', () => this.select('soldier'));
    kb?.on('keydown-THREE', () => this.select('lucky'));
    kb?.on('keydown-SPACE', () => this.start());
    kb?.on('keydown-ENTER', () => this.start());
    kb?.once('keydown-ESC', () => this.scene.start('Menu'));
  }

  private move(d: number): void {
    const i = HERO_ORDER.indexOf(this.pick);
    this.select(HERO_ORDER[(i + d + HERO_ORDER.length) % HERO_ORDER.length]);
  }

  private select(id: HeroId): void {
    if (this.pick === id) return;
    AudioManager.ui('tap');
    this.pick = id;
    this.refresh();
  }

  private refresh(): void {
    for (const [id, r] of this.cards) {
      const on = id === this.pick;
      r.setStrokeStyle(on ? 2 : 1, on ? 0xf5d76e : 0xffffff, on ? 1 : 0.15);
      r.setFillStyle(on ? 0x1c2230 : 0x13161d, 0.96);
    }
  }

  private card(id: HeroId, x: number, y: number): void {
    const h = HEROES[id];
    const bg = this.add.rectangle(x, y, CARD_W, CARD_H, 0x13161d, 0.96).setOrigin(0).setDepth(98);
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      if (this.pick === id) this.start();
      else this.select(id);
    });
    this.cards.set(id, bg);
    this.add.rectangle(x, y, CARD_W, 3, h.color).setOrigin(0).setDepth(99);

    // 角色：同一套像素圖，用顏色區分
    const key = this.textures.exists('player') ? 'player' : undefined;
    if (key) this.add.image(x + 30, y + 64, key, 0).setOrigin(0.5, 1).setScale(1).setTint(h.tint).setDepth(100);
    pixelText(this, x + 62, y + 10, h.name, 12, '#ffffff');
    pixelText(this, x + 62, y + 28, h.title, 8, '#' + h.color.toString(16).padStart(6, '0'));
    pixelText(this, x + 62, y + 42, `生命 ${h.maxHp}`, 8, '#ef9a9a');
    pixelText(this, x + 10, y + 70, h.blurb, 8, '#c8c8c8').setWordWrapWidth(CARD_W - 20, true).setLineSpacing(2);

    let ty = y + 116;
    const guns = h.guns.map((g) => getWeapon(g)?.name ?? g).join('、');
    const melee = getWeapon(h.melee)?.name ?? h.melee;
    pixelText(this, x + 10, ty, `武器：${guns}＋${melee}`, 8, '#f5d76e').setWordWrapWidth(CARD_W - 20, true);
    ty += 14;
    const ammo = (Object.entries(h.ammo) as [AmmoType, number][]).map(([t, n]) => `${AMMO[t].name.split(' ')[0]} ${n}`).join('、');
    const pistol = h.guns.includes('m1911') ? (h.infinitePistol ? 'M1911 無限' : 'M1911 有限') : '';
    pixelText(this, x + 10, ty, `彈藥：${[pistol, ammo].filter(Boolean).join('・')}`, 7, '#b0bec5').setWordWrapWidth(CARD_W - 20, true);
    ty += 14;
    pixelText(this, x + 10, ty, `開局：${getZone(h.startZone)?.name ?? h.startZone}`, 7, '#b0bec5');
    ty += 18;

    for (const sk of h.skills) {
      const head = sk.key ? `${sk.name}【${sk.key}】` : sk.name;
      pixelText(this, x + 10, ty, head, 8, '#9ad17a');
      ty += 12;
      const t = pixelText(this, x + 10, ty, sk.desc.replace(/ /g, ''), 7, '#c8c8c8').setWordWrapWidth(CARD_W - 20, true).setLineSpacing(1);
      ty += t.height + 6;
    }
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    AudioManager.ui('confirm');
    GameState.reset(this.pick);
    // 標題畫面選好的據點地圖
    GameState.data.outpostMap = this.registry.get('outpostMap') ?? undefined;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Defense'));
  }
}
