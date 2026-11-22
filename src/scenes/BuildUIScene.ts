import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { BARRICADE_LEVELS, BUILDINGS, LAMP, SPIKES, TURRET, type BuildingKind } from '../data/buildings';
import { AudioManager } from '../audio/AudioManager';
import type { BuildMode } from '../build/BuildMode';
import type { Quote } from '../build/Outpost';
import { registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';

export interface BuildUIData {
  mode: BuildMode;
  onStartNight: () => void;
}

const PANEL_X = 150;
const PANEL_Y = 34;
const PANEL_W = 340;

/**
 * 白天布置的介面：上方資訊列（天數、廢料、開始夜晚），
 * 選到槽位／路障／外牆時在天空區域跳出操作面板。
 * 面板放在天空那一塊，不會蓋住地面上的槽位。
 */
export class BuildUIScene extends Phaser.Scene {
  private mode!: BuildMode;
  private onStartNight!: () => void;
  private scrapText!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private panelRects: (() => void)[] = [];
  private fixedRects: (() => void)[] = [];

  constructor() {
    super('BuildUI');
  }

  init(data: BuildUIData): void {
    this.mode = data.mode;
    this.onStartNight = data.onStartNight;
  }

  create(): void {
    this.panelRects = [];
    this.fixedRects = [];
    const touch = this.sys.game.device.input.touch;

    this.add.rectangle(0, 0, GAME_WIDTH, 26, 0x000000, 0.55).setOrigin(0);
    pixelText(this, 8, 6, `第 ${GameState.data.day} 天・白天　布置據點`, 9, '#f5d76e');
    this.scrapText = pixelText(this, 300, 6, '', 9, '#e8e8e8');
    this.fixedRects.push(registerUIRect({ x: 0, y: 0, w: GAME_WIDTH, h: 26 }));

    this.button(GAME_WIDTH - 104, 2, 100, 22, '開始夜晚 ▶', true, () => this.onStartNight(), 0x7a2a22);

    this.hint = pixelText(
      this,
      GAME_WIDTH / 2,
      34,
      touch ? '點地上的槽位建造　點路障或外牆修理／強化' : '點地上的槽位建造　點路障或外牆修理／強化　右鍵或 Esc 取消　Enter 開始夜晚',
      8,
      '#c8c8c8',
    ).setOrigin(0.5, 0);
    this.tweens.add({ targets: this.hint, alpha: 0.4, duration: 900, yoyo: true, repeat: -1 });

    this.panel = this.add.container(0, 0);
    this.mode.events.on('changed', this.refresh, this);
    this.input.keyboard?.on('keydown-ENTER', this.onStartNight);
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.mode.events.off('changed', this.refresh, this);
      this.input.keyboard?.off('keydown-ENTER', this.onStartNight);
      this.clearPanel();
      this.fixedRects.forEach((fn) => fn());
    });
  }

  private refresh(): void {
    this.scrapText.setText(`廢料 ${GameState.data.scrap}`);
    this.clearPanel();
    const sel = this.mode.selection;
    this.hint.setVisible(!sel);
    if (!sel) return;
    const out = this.mode.outpost;

    if (sel.type === 'slot') {
      const slot = out.slot(sel.id)!;
      const b = out.buildings.get(sel.id);
      if (!b) {
        const rows = slot.kinds.length;
        this.frame(28 + rows * 28);
        this.text(PANEL_X + 10, PANEL_Y + 7, '空槽位：選擇要蓋的建築', 9, '#f5d76e');
        slot.kinds.forEach((k: BuildingKind, i) => {
          const def = BUILDINGS[k];
          const q = out.buildQuote(sel.id, k);
          const y = PANEL_Y + 26 + i * 28;
          this.addButton(PANEL_X + 8, y, PANEL_W - 16, 24, '', this.affordable(q), () => this.mode.build(k));
          this.text(PANEL_X + 16, y + 6, def.name, 8, '#ffffff');
          this.text(PANEL_X + 84, y + 6, def.desc, 8, '#c8c8c8');
          this.text(PANEL_X + PANEL_W - 16, y + 6, `${def.cost}`, 8, this.affordable(q) ? '#f5d76e' : '#ff6b6b').setOrigin(1, 0);
        });
        return;
      }
      const def = BUILDINGS[b.kind];
      this.frame(90);
      this.text(PANEL_X + 10, PANEL_Y + 7, `${def.name}　Lv${b.level}${b.level >= def.maxLevel ? '（滿級）' : ''}`, 9, '#f5d76e');
      const status = b.canBreak ? `耐久 ${b.hp} / ${b.maxHp}${b.working ? '' : '　已損壞，夜裡不會生效'}` : '不會被破壞';
      this.text(PANEL_X + 10, PANEL_Y + 23, status, 8, b.working ? '#c8c8c8' : '#ff8a80');
      this.text(PANEL_X + 10, PANEL_Y + 38, this.effectLine(b.kind, b.level), 8, '#9ad17a');
      const up = out.upgradeQuote(sel.id);
      const rep = out.repairQuote(sel.id);
      const bw = (PANEL_W - 16 - 8 * 2) / 3;
      const by = PANEL_Y + 58;
      this.actionButton(PANEL_X + 8, by, bw, '升級', up, () => this.mode.upgrade());
      this.actionButton(PANEL_X + 8 + (bw + 8), by, bw, '修理', rep, () => this.mode.repair());
      this.addButton(PANEL_X + 8 + (bw + 8) * 2, by, bw, 24, `拆除 +${out.refund(sel.id)}`, true, () => this.mode.demolish());
      return;
    }

    if (sel.type === 'barricade') {
      const lv = GameState.data.barricadeLevel;
      const bar = out.barricade;
      this.frame(74);
      this.text(PANEL_X + 10, PANEL_Y + 7, `主路障　Lv${lv}${lv >= BARRICADE_LEVELS.length ? '（滿級）' : ''}`, 9, '#f5d76e');
      this.text(PANEL_X + 10, PANEL_Y + 24, `耐久 ${bar.hp} / ${bar.maxHp}${bar.alive ? '' : '　已倒塌！'}`, 8, bar.alive ? '#c8c8c8' : '#ff8a80');
      const bw = (PANEL_W - 16 - 8) / 2;
      const by = PANEL_Y + 42;
      this.actionButton(PANEL_X + 8, by, bw, '強化', out.barricadeUpgradeQuote(), () => this.mode.upgrade());
      this.actionButton(PANEL_X + 16 + bw, by, bw, '修理', out.barricadeRepairQuote(), () => this.mode.repair(), true);
      return;
    }

    // 外牆
    const st = GameState.data;
    this.frame(74);
    this.text(PANEL_X + 10, PANEL_Y + 7, '據點外牆', 9, '#f5d76e');
    this.text(PANEL_X + 10, PANEL_Y + 24, `耐久 ${st.baseHp} / ${st.baseMaxHp}　歸零就失守`, 8, '#c8c8c8');
    this.actionButton(PANEL_X + 8, PANEL_Y + 42, PANEL_W - 16, '修理', out.wallRepairQuote(), () => this.mode.repair(), true);
  }

  private effectLine(kind: BuildingKind, level: number): string {
    const i = level - 1;
    switch (kind) {
      case 'sandbag':
        return '擋住同一排的霧屍';
      case 'spikes':
        return `每 ${SPIKES.interval} 秒刺 ${SPIKES.damage[i]}　減速 ${Math.round((1 - SPIKES.slow[i]) * 100)}%`;
      case 'lamp':
        return `光圈 ${LAMP.radius[i]}　減速 ${Math.round((1 - LAMP.slow[i]) * 100)}%`;
      case 'turret':
        return `傷害 ${TURRET.damage[i]}　每 ${TURRET.interval[i]} 秒一發　射程 ${TURRET.range[i]}`;
    }
  }

  private affordable(q: Quote): boolean {
    return !q.blocked && q.cost > 0 && GameState.data.scrap >= q.cost;
  }

  /** 升級／修理按鈕；partial 代表錢不夠也能修一部分 */
  private actionButton(x: number, y: number, w: number, label: string, q: Quote, onPress: () => void, partial = false): void {
    if (q.blocked) {
      this.addButton(x, y, w, 24, `${label}（${q.blocked}）`, false, onPress);
      return;
    }
    const ok = partial ? GameState.data.scrap > 0 : this.affordable(q);
    this.addButton(x, y, w, 24, `${label}  ${q.cost}`, ok, onPress);
  }

  private frame(h: number): void {
    const bg = this.add.rectangle(PANEL_X, PANEL_Y, PANEL_W, h, 0x0d0f14, 0.88).setOrigin(0).setStrokeStyle(1, 0xf5d76e, 0.6);
    this.panel.add(bg);
    this.panelRects.push(registerUIRect({ x: PANEL_X, y: PANEL_Y, w: PANEL_W, h }));
  }

  private text(x: number, y: number, s: string, size: number, color: string): Phaser.GameObjects.Text {
    const t = pixelText(this, x, y, s, size, color);
    this.panel.add(t);
    return t;
  }

  private addButton(x: number, y: number, w: number, h: number, label: string, enabled: boolean, onPress: () => void): void {
    const objs = this.button(x, y, w, h, label, enabled, onPress);
    this.panel.add(objs);
  }

  private button(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    enabled: boolean,
    onPress: () => void,
    fill = 0x2a2f3a,
  ): Phaser.GameObjects.GameObject[] {
    const bg = this.add
      .rectangle(x, y, w, h, enabled ? fill : 0x1a1c22, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0xffffff, enabled ? 0.5 : 0.15);
    const objs: Phaser.GameObjects.GameObject[] = [bg];
    if (label) {
      objs.push(pixelText(this, x + w / 2, y + h / 2, label, 8, enabled ? '#ffffff' : '#6b7280').setOrigin(0.5));
    }
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(0x4a5262, 0.95));
      bg.on('pointerout', () => bg.setFillStyle(fill, 0.95));
      bg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        // 等這次點擊處理完再動作：動作會重建面板，不要在按鈕自己的事件裡把它銷毀
        AudioManager.ui('tap');
        this.time.delayedCall(0, onPress);
      });
    }
    return objs;
  }

  private clearPanel(): void {
    this.panelRects.forEach((fn) => fn());
    this.panelRects = [];
    this.panel?.removeAll(true);
  }
}
