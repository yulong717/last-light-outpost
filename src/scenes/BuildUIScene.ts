import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { BARRICADE_LEVELS, BUILDINGS, LAMP, SPIKES, TURRET, type BuildingKind } from '../data/buildings';
import { AudioManager } from '../audio/AudioManager';
import type { BuildMode } from '../build/BuildMode';
import type { Quote } from '../build/Outpost';
import { registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { ensureCrewTexture } from '../art/CrewArt';
import { COMPANION_ROLES, MAX_DEPLOYED } from '../data/companions';
import { ATTRS, TRAIT_BY_ID } from '../data/crewTraits';
import { BACKGROUND_BY_ID, BODIES, PROF_NAMES, profSummary } from '../data/crewBody';
import { crewStats } from '../data/crewLoadout';
import { getWeapon } from '../data/weapons';
import { pixelText } from '../utils/text';
import { EXPLORE_TIME, getZone } from '../data/explore';
import { crewReady } from '../data/companions';
import type { ArmoryData } from './ArmoryScene';

export interface BuildUIData {
  mode: BuildMode;
  onStartNight: () => void;
  /** 打開城市地圖出門探索 */
  onExplore: () => void;
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
  private onExplore!: () => void;
  private scrapText!: Phaser.GameObjects.Text;
  private panel!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;
  private objective?: Phaser.GameObjects.Text;
  private panelRects: (() => void)[] = [];
  private fixedRects: (() => void)[] = [];
  /** 隊伍名冊面板是否打開 */
  private rosterOpen = false;
  private rosterPage = 0;
  /** 換武器失敗時的提示 */
  private rosterNote = '';

  constructor() {
    super('BuildUI');
  }

  init(data: BuildUIData): void {
    this.mode = data.mode;
    this.onStartNight = data.onStartNight;
    this.onExplore = data.onExplore;
  }

  create(): void {
    this.panelRects = [];
    this.fixedRects = [];
    const touch = this.sys.game.device.input.touch;

    this.add.rectangle(0, 0, GAME_WIDTH, 26, 0x000000, 0.55).setOrigin(0);
    pixelText(this, 8, 6, `第 ${GameState.data.day} 天・白天`, 9, '#f5d76e');
    this.scrapText = pixelText(this, 96, 6, '', 9, '#e8e8e8');
    this.fixedRects.push(registerUIRect({ x: 0, y: 0, w: GAME_WIDTH, h: 26 }));

    this.button(GAME_WIDTH - 104, 2, 100, 22, '開始夜晚 ▶', true, () => this.onStartNight(), 0x7a2a22);
    this.button(GAME_WIDTH - 172, 2, 62, 22, `隊伍 ${GameState.data.crew.length}`, true, () => this.toggleRoster());
    // 軍械庫：買槍、買彈、配置上場武器
    this.button(GAME_WIDTH - 240, 2, 62, 22, '軍械庫', true, () => this.openArmory(), 0x3a4a2a);
    // 白天探索：剩幾個時段就能出門幾趟（近區 1、遠區 2）
    const left = GameState.data.dayTime;
    const slots = '●'.repeat(left) + '○'.repeat(Math.max(0, EXPLORE_TIME.slotsPerDay - left));
    this.button(GAME_WIDTH - 358, 2, 112, 22, `出發探索 ${slots}`, left > 0, () => this.onExplore(), 0x2a3a5a);

    this.hint = pixelText(
      this,
      GAME_WIDTH / 2,
      34,
      touch ? '點地上的槽位建造　點路障或外牆修理／強化' : '點地上的槽位建造　點路障或外牆修理／強化　右鍵或 Esc 取消　Enter 開始夜晚',
      8,
      '#c8c8c8',
    ).setOrigin(0.5, 0);
    this.tweens.add({ targets: this.hint, alpha: 0.4, duration: 900, yoyo: true, repeat: -1 });
    // 主線目標
    const ch = GameState.chapter;
    if (ch) {
      const zn = getZone(ch.zone)?.name ?? '';
      const goal = GameState.chapterReady() ? `★ ${ch.title}：${ch.objective}（${zn}）` : `★ ${ch.title}　第 ${ch.minDay} 天開始`;
      this.objective = pixelText(this, GAME_WIDTH / 2, 48, goal, 8, '#f5d76e').setOrigin(0.5, 0);
    }

    this.panel = this.add.container(0, 0);
    this.mode.events.on('changed', this.refresh, this);
    this.input.keyboard?.on('keydown-ENTER', this.onStartNight);
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.mode.events.off('changed', this.refresh, this);
      this.input.keyboard?.off('keydown-ENTER', this.onStartNight);
      this.clearPanel();
      this.fixedRects.forEach((fn) => fn());
      this.scene.stop('Armory');
    });
  }

  private openArmory(): void {
    if (this.scene.isActive('Armory')) return;
    const data: ArmoryData = { onChange: () => this.mode.events.emit('changed') };
    this.scene.launch('Armory', data);
    this.scene.bringToTop('Armory');
  }

  private refresh(): void {
    const s = GameState.data.supplies;
    this.scrapText.setText(`廢料 ${GameState.data.scrap}　醫療 ${s.medkit} 手雷 ${s.grenade}`);
    this.clearPanel();
    const sel = this.mode.selection;
    if (sel) this.rosterOpen = false;
    this.hint.setVisible(!sel && !this.rosterOpen);
    this.objective?.setVisible(!sel && !this.rosterOpen);
    if (!sel) {
      if (this.rosterOpen) this.showRoster();
      return;
    }
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

  private toggleRoster(): void {
    this.rosterOpen = !this.rosterOpen;
    // 打開名冊時取消槽位選取（select 會觸發 refresh）
    if (this.rosterOpen && this.mode.selection) this.mode.select(null);
    else this.refresh();
  }

  /**
   * 隊伍名冊：每人一格，顯示換裝後的樣子、職業、特質與五項屬性。
   * 前 MAX_DEPLOYED 位會出戰。
   */
  private showRoster(): void {
    const crew = GameState.data.crew;
    const cols = 2;
    const perPage = 6;
    const cellH = 72;
    const pages = Math.max(1, Math.ceil(crew.length / perPage));
    this.rosterPage = Math.min(this.rosterPage, pages - 1);
    const list = crew.slice(this.rosterPage * perPage, (this.rosterPage + 1) * perPage);
    const rows = Math.max(1, Math.ceil(list.length / cols));
    const x0 = 20;
    const w = GAME_WIDTH - 40;
    const cw = (w - 24) / cols;
    const h = 26 + rows * (cellH + 4);
    const bg = this.add.rectangle(x0, PANEL_Y, w, h, 0x0d0f14, 0.92).setOrigin(0).setStrokeStyle(1, 0xf5d76e, 0.6);
    this.panel.add(bg);
    this.panelRects.push(registerUIRect({ x: x0, y: PANEL_Y, w, h }));
    this.text(x0 + 10, PANEL_Y + 7, `隊伍名冊　前 ${MAX_DEPLOYED} 位出戰　點武器列可換武器（一把只能一人拿）`, 9, '#f5d76e');
    if (pages > 1) {
      this.addButton(x0 + w - 70, PANEL_Y + 4, 28, 16, '◀', this.rosterPage > 0, () => {
        this.rosterPage--;
        this.refresh();
      });
      this.addButton(x0 + w - 38, PANEL_Y + 4, 28, 16, '▶', this.rosterPage < pages - 1, () => {
        this.rosterPage++;
        this.refresh();
      });
    }
    if (crew.length === 0) {
      this.text(x0 + 10, PANEL_Y + 26, '現在只有你一個人。出門探索、推進主線，就能找到願意跟你走的倖存者。', 8, '#b0bec5');
      return;
    }
    const ready = crew.filter(crewReady);
    list.forEach((m, i) => {
      const cx = x0 + 8 + (i % cols) * (cw + 8);
      const cy = PANEL_Y + 24 + Math.floor(i / cols) * (cellH + 4);
      this.panel.add(this.add.rectangle(cx, cy, cw, cellH, 0x1c2029, 0.95).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.12));
      // 半身像：切出頭到腰，對齊到格子左上
      const key = ensureCrewTexture(this, m) ?? 'player';
      const img = this.add.image(cx - 10, cy + 6, key, 0).setOrigin(0, 0).setCrop(12, 4, 40, 50);
      if (key === 'player') img.setTint(COMPANION_ROLES[m.role].tint);
      this.panel.add(img);
      const isReady = crewReady(m);
      const deployed = isReady && ready.indexOf(m) < MAX_DEPLOYED;
      const tx0 = cx + 44;
      this.text(tx0, cy + 3, m.name, 9, '#ffffff');
      this.text(cx + cw - 6, cy + 4, `${COMPANION_ROLES[m.role].title}${!isReady ? `・負傷 ${m.injuredDays} 天` : deployed ? '・出戰' : '・待命'}`, 8, !isReady ? '#ef9a9a' : deployed ? '#f5d76e' : '#90a4ae').setOrigin(1, 0);
      // 體格・出身・擅長
      const body = BODIES[m.body] ?? BODIES.average;
      const bgDef = BACKGROUND_BY_ID[m.background];
      const good = m.prof ? profSummary(m.prof) : '';
      this.text(tx0, cy + 17, `${body.name}・${bgDef?.name ?? '倖存者'}${good ? `　擅長 ${good}` : ''}`, 8, '#cfd8dc');
      const traits = m.traits.map((t) => TRAIT_BY_ID[t]).filter(Boolean);
      let tx = tx0;
      for (const t of traits) {
        const tt = this.text(tx, cy + 30, t.name, 8, t.kind === 'perk' ? '#a5d6a7' : '#ef9a9a');
        tx += tt.width + 6;
      }
      const st = crewStats(m);
      const attrs = ATTRS.map((a) => `${a.name[0]}${m.attrs[a.key]}`).join(' ');
      this.text(tx0, cy + 42, `${attrs}　血 ${st.maxHp}　速 ${Math.round(st.speed)}`, 8, '#b0bec5');
      // 武器列：點一下換下一把能用的
      const wname = this.weaponLabel(m.weaponId, st.weaponId, st.sidearm, !!st.melee);
      const label = `武器：${wname}・${PROF_NAMES[st.proficiency] ?? ''}`;
      this.addButton(tx0, cy + 55, cw - 50, 14, '', true, () => this.cycleCrewWeapon(m.id));
      this.text(tx0 + 4, cy + 56, label, 8, st.sidearm ? '#90a4ae' : '#ffe082');
    });
    if (this.rosterNote) this.text(x0 + 10, PANEL_Y + h + 4, this.rosterNote, 8, '#ff8a80');
  }

  private weaponLabel(assigned: string | undefined, actual: string, sidearm: boolean, melee: boolean): string {
    if (sidearm) return '隨身手槍';
    if (!assigned && melee) return '隨身小刀';
    return getWeapon(actual)?.name ?? actual;
  }

  /** 換下一把：隨身 → 能用的武器依序 → 回到隨身 */
  private cycleCrewWeapon(crewId: string): void {
    const m = GameState.data.crew.find((c) => c.id === crewId);
    if (!m) return;
    const options: (string | null)[] = [null, ...GameState.wieldableFor(crewId)];
    let i = options.indexOf(m.weaponId ?? null);
    this.rosterNote = '';
    // 往後找一把配得上的（主角最後一把槍之類的會被拒絕，跳過）
    for (let n = 0; n < options.length; n++) {
      i = (i + 1) % options.length;
      const res = GameState.assignWeapon(crewId, options[i]);
      if (res.ok) break;
      this.rosterNote = res.reason ?? '';
    }
    GameState.save();
    this.refresh();
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
