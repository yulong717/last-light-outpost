import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import {
  AMMO,
  FIREARMS,
  MAX_GUNS,
  MELEE,
  fullReloadTime,
  type AmmoType,
  type FirearmDef,
  type MeleeDef,
} from '../data/weapons';
import { registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';

export interface ArmoryData {
  /** 買東西後通知白天介面更新廢料 */
  onChange: () => void;
}

type Tab = 'guns' | 'melee' | 'ammo';

const PX = 20;
const PY = 30;
const PW = GAME_WIDTH - 40;
const PH = GAME_HEIGHT - 40;
const LIST_W = 236;
const ROW_H = 22;

const ACTION_NAME = { semi: '半自動', auto: '全自動', pump: '泵動', bolt: '栓動' } as const;
const RELOAD_NAME = { magazine: '換彈匣', single: '逐發裝填', whole: '一次裝滿' } as const;

/** 能力條的上限（用全名單的最大值正規化） */
const MAX = {
  dmg: Math.max(...FIREARMS.map((d) => d.damage * d.pellets)),
  dps: Math.max(...FIREARMS.map((d) => dps(d))),
  range: Math.max(...FIREARMS.map((d) => Math.min(d.range, d.falloffEnd))),
  melee: Math.max(...MELEE.map((m) => m.damage)),
};

function dps(d: FirearmDef): number {
  // 打完一匣（含換彈）的平均每秒傷害
  const t = d.magazine / d.fireRate + fullReloadTime(d, 0);
  return (d.damage * d.pellets * d.magazine) / t;
}

/** 操控：後座與散布越小越高（0..1） */
function control(d: FirearmDef): number {
  return Phaser.Math.Clamp(1 - (d.climbMax * 0.6 + d.bloomMax * 0.5 + d.spread * 0.6 + d.moveSpread * 0.3) / 16, 0.05, 1);
}

/**
 * 軍械庫（白天）：買槍、買近戰武器、買彈藥、決定帶哪三把槍上場。
 * 疊在白天布置介面上方；Esc 或右上角關閉。
 */
export class ArmoryScene extends Phaser.Scene {
  private onChange!: () => void;
  private tab: Tab = 'guns';
  private selected = 'm1911';
  private root!: Phaser.GameObjects.Container;
  private rects: (() => void)[] = [];

  constructor() {
    super('Armory');
  }

  init(data: ArmoryData): void {
    this.onChange = data.onChange;
  }

  create(): void {
    this.rects = [];
    this.root = this.add.container(0, 0);
    this.input.keyboard?.on('keydown-ESC', this.close, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-ESC', this.close, this);
      this.clear();
    });
    this.redraw();
  }

  private close(): void {
    AudioManager.ui('back');
    this.scene.stop();
  }

  private clear(): void {
    this.rects.forEach((fn) => fn());
    this.rects = [];
    this.root?.removeAll(true);
  }

  private changed(): void {
    this.onChange();
    this.redraw();
  }

  private redraw(): void {
    this.clear();
    const st = GameState.data;
    // 擋住後面的白天介面
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0).setInteractive();
    this.root.add(dim);
    this.rects.push(registerUIRect({ x: 0, y: 0, w: GAME_WIDTH, h: GAME_HEIGHT }));
    this.root.add(this.add.rectangle(PX, PY, PW, PH, 0x0d0f14, 0.96).setOrigin(0).setStrokeStyle(1, 0xf5d76e, 0.6));

    this.text(PX + 10, PY + 7, '軍械庫', 11, '#f5d76e');
    this.text(PX + 70, PY + 9, `廢料 ${st.scrap}　第 ${st.day} 天`, 8, '#e8e8e8');
    this.button(PX + PW - 30, PY + 4, 26, 20, '✕', true, () => this.close());

    const tabs: [Tab, string][] = [
      ['guns', '槍械'],
      ['melee', '近戰'],
      ['ammo', '彈藥'],
    ];
    tabs.forEach(([t, label], i) => {
      this.button(PX + 200 + i * 64, PY + 4, 60, 20, label, true, () => {
        this.tab = t;
        this.selected = t === 'guns' ? FIREARMS[0].id : t === 'melee' ? MELEE[0].id : '';
        this.redraw();
      }, this.tab === t ? 0x5a4a1a : 0x2a2f3a);
    });

    if (this.tab === 'guns') this.drawGuns();
    else if (this.tab === 'melee') this.drawMelee();
    else this.drawAmmo();
    this.drawLoadout();
  }

  // ── 槍械 ──────────────────────────────────────────────

  private drawGuns(): void {
    const st = GameState.data;
    FIREARMS.forEach((d, i) => {
      const y = PY + 32 + i * ROW_H;
      const owned = GameState.owns(d.id);
      const slot = st.armory.loadout.indexOf(d.id);
      const locked = d.unlockDay > st.day;
      const tag = slot >= 0 ? `上場 ${slot + 1}` : owned ? '擁有' : locked ? `第 ${d.unlockDay} 天` : `${d.price}`;
      const color = slot >= 0 ? '#9ad17a' : owned ? '#c8c8c8' : locked ? '#6b7280' : st.scrap >= d.price ? '#f5d76e' : '#ff6b6b';
      this.listRow(y, d.id, d.name, tag, color, d.id === this.selected, () => {
        this.selected = d.id;
        this.redraw();
      });
    });
    const d = FIREARMS.find((f) => f.id === this.selected) ?? FIREARMS[0];
    this.gunDetail(d);
  }

  private gunDetail(d: FirearmDef): void {
    const st = GameState.data;
    const x = PX + LIST_W + 18;
    const w = PW - LIST_W - 28;
    let y = PY + 32;
    const nm = this.text(x, y, d.name, 11, '#ffffff');
    this.text(x + nm.width + 6, y + 4, d.model, 7, '#90a4ae');
    this.icon(x + w, y - 2, d.id, 2).setOrigin(1, 0);
    y += 18;
    this.text(x, y, d.desc, 8, '#c8c8c8').setWordWrapWidth(w, true);
    y += 30;
    const per = d.pellets > 1 ? `${d.damage}×${d.pellets}` : `${d.damage}`;
    this.bar(x, y, w, '單發傷害', (d.damage * d.pellets) / MAX.dmg, per);
    this.bar(x, y + 14, w, '持續火力', dps(d) / MAX.dps, `${Math.round(dps(d))}/秒`);
    this.bar(x, y + 28, w, '穿甲', d.penetration, `穿 ${d.pierce} 隻`);
    this.bar(x, y + 42, w, '有效射程', Math.min(d.range, d.falloffEnd) / MAX.range, '');
    this.bar(x, y + 56, w, '操控', control(d), '');
    this.bar(x, y + 70, w, '機動', (d.moveMul - 0.7) / 0.3, `換槍 ${d.swapTime}s`);
    y += 90;
    const reserve = d.infiniteReserve ? '無限' : `${st.armory.ammo[d.ammo]}`;
    const rpm = d.action === 'auto' ? `${Math.round(d.fireRate * 60)} 發/分` : `${d.fireRate} 發/秒`;
    this.text(x, y, `${ACTION_NAME[d.action]}　${rpm}　彈匣 ${d.magazine}${d.chamber && d.reload === 'magazine' ? '+1' : ''}`, 8, '#e8e8e8');
    const rl = d.reload === 'single' ? `每發 ${d.perRound}s${d.clip ? `／橋夾 ${d.clip} 發` : ''}` : `${fullReloadTime(d, 1)}s${d.reloadEmptyTime !== d.reloadTime ? `（打空 ${d.reloadEmptyTime}s）` : ''}`;
    this.text(x, y + 13, `${RELOAD_NAME[d.reload]} ${rl}`, 8, '#e8e8e8');
    this.text(x, y + 26, `彈藥：${AMMO[d.ammo].name}　備彈 ${reserve}`, 8, '#b0bec5');
    y += 46;

    const owned = GameState.owns(d.id);
    if (!owned) {
      const locked = d.unlockDay > st.day;
      const ok = !locked && st.scrap >= d.price;
      this.button(x, y, w, 24, locked ? `第 ${d.unlockDay} 天才進貨` : `購買　${d.price} 廢料`, ok, () => {
        if (GameState.buyWeapon(d.id)) AudioManager.ui('confirm');
        this.changed();
      });
      return;
    }
    const inLoadout = st.armory.loadout.includes(d.id);
    const canAdd = st.armory.loadout.length < MAX_GUNS;
    const label = inLoadout ? (st.armory.loadout.length > 1 ? '卸下' : '至少要帶一把槍') : canAdd ? '帶上場' : `最多帶 ${MAX_GUNS} 把，先卸下一把`;
    this.button(x, y, w, 24, label, inLoadout ? st.armory.loadout.length > 1 : canAdd, () => {
      GameState.toggleLoadout(d.id);
      this.changed();
    });
  }

  // ── 近戰 ──────────────────────────────────────────────

  private drawMelee(): void {
    const st = GameState.data;
    MELEE.forEach((m, i) => {
      const y = PY + 32 + i * ROW_H;
      const owned = GameState.owns(m.id);
      const locked = m.unlockDay > st.day;
      const tag = st.armory.melee === m.id ? '裝備中' : owned ? '擁有' : locked ? `第 ${m.unlockDay} 天` : `${m.price}`;
      const color = st.armory.melee === m.id ? '#9ad17a' : owned ? '#c8c8c8' : locked ? '#6b7280' : st.scrap >= m.price ? '#f5d76e' : '#ff6b6b';
      this.listRow(y, m.id, m.name, tag, color, m.id === this.selected, () => {
        this.selected = m.id;
        this.redraw();
      });
    });
    this.text(PX + 12, PY + 32 + MELEE.length * ROW_H + 8, '右鍵／V／E 隨時揮擊\n每揮一次耗體力，\n體力見底會變慢變弱', 8, '#90a4ae');
    const m = MELEE.find((d) => d.id === this.selected) ?? MELEE[0];
    this.meleeDetail(m);
  }

  private meleeDetail(m: MeleeDef): void {
    const st = GameState.data;
    const x = PX + LIST_W + 18;
    const w = PW - LIST_W - 28;
    let y = PY + 32;
    const nm = this.text(x, y, m.name, 11, '#ffffff');
    this.text(x + nm.width + 6, y + 4, m.damageType === 'blunt' ? '鈍器' : '刀刃', 7, '#90a4ae');
    this.icon(x + w, y - 2, m.id, 2).setOrigin(1, 0);
    y += 18;
    this.text(x, y, m.desc, 8, '#c8c8c8').setWordWrapWidth(w, true);
    y += 30;
    const swing = m.windup + m.active + m.recovery;
    this.bar(x, y, w, '傷害', m.damage / MAX.melee, `${m.damage}`);
    this.bar(x, y + 14, w, '出手速度', Phaser.Math.Clamp(1 - (swing - 0.25) / 0.9, 0.05, 1), `${swing.toFixed(2)}s`);
    this.bar(x, y + 28, w, '橫掃範圍', m.arc / 160, `最多 ${m.maxTargets} 隻`);
    this.bar(x, y + 42, w, '擊退', m.knockback / 42, '');
    this.bar(x, y + 56, w, '打暈', m.stagger / 1.2, `${m.stagger}s`);
    this.bar(x, y + 70, w, '省體力', 1 - m.stamina / 45, `${m.stamina}/揮`);
    y += 90;
    const extras = [m.comboEvery ? `第 ${m.comboEvery} 下連段 ×${m.comboMul}` : '', m.staggerBonus > 1 ? `處決暈眩目標 ×${m.staggerBonus}` : '']
      .filter(Boolean)
      .join('　');
    this.text(x, y, extras, 8, '#e8e8e8');
    this.text(x, y + 13, `穿甲 ${Math.round(m.penetration * 100)}%　觸及 ${m.reach}`, 8, '#b0bec5');
    y += 46;
    if (!GameState.owns(m.id)) {
      const locked = m.unlockDay > st.day;
      const ok = !locked && st.scrap >= m.price;
      this.button(x, y, w, 24, locked ? `第 ${m.unlockDay} 天才進貨` : `購買　${m.price} 廢料`, ok, () => {
        if (GameState.buyWeapon(m.id)) {
          GameState.equipMelee(m.id);
          AudioManager.ui('confirm');
        }
        this.changed();
      });
      return;
    }
    const eq = st.armory.melee === m.id;
    this.button(x, y, w, 24, eq ? '裝備中' : '裝備', !eq, () => {
      GameState.equipMelee(m.id);
      this.changed();
    });
  }

  // ── 彈藥 ──────────────────────────────────────────────

  private drawAmmo(): void {
    const st = GameState.data;
    const x = PX + 12;
    const w = PW - 24;
    this.text(x, PY + 32, 'M1911 備彈無限。其他槍的子彈要在這裡買，彈匣裡剩的天亮會退回備彈。', 8, '#90a4ae');
    (Object.keys(AMMO) as AmmoType[]).forEach((t, i) => {
      const a = AMMO[t];
      const y = PY + 52 + i * 34;
      const have = st.armory.ammo[t];
      const users = FIREARMS.filter((d) => d.ammo === t && !d.infiniteReserve).map((d) => d.name);
      this.root.add(this.add.rectangle(x, y, w, 30, 0x1a1d24, 0.9).setOrigin(0));
      this.text(x + 8, y + 3, a.name, 9, '#ffffff');
      this.text(x + 8, y + 17, users.join('、'), 7, '#90a4ae');
      this.text(x + 260, y + 9, `${have} / ${a.max}`, 9, have === 0 ? '#ff6b6b' : '#e8e8e8');
      const full = have >= a.max;
      const ok = !full && st.scrap >= a.price;
      this.button(x + w - 150, y + 4, 142, 22, full ? '已滿' : `買 ${a.box} 發　${a.price} 廢料`, ok, () => {
        if (GameState.buyAmmo(t) > 0) AudioManager.ui('confirm');
        this.changed();
      });
    });
  }

  private drawLoadout(): void {
    const st = GameState.data;
    const y = PY + PH - 22;
    this.root.add(this.add.rectangle(PX + 1, y - 4, PW - 2, 25, 0x000000, 0.5).setOrigin(0));
    const guns = Array.from({ length: MAX_GUNS }, (_, i) => {
      const id = st.armory.loadout[i];
      const d = id ? FIREARMS.find((f) => f.id === id) : undefined;
      return `${i + 1} ${d ? d.name : '—'}`;
    }).join('　');
    const melee = MELEE.find((m) => m.id === st.armory.melee)?.name ?? '—';
    this.text(PX + 10, y + 2, `今晚帶上場：${guns}　｜　近戰 ${melee}`, 8, '#f5d76e');
  }

  // ── 小元件 ────────────────────────────────────────────

  /** 武器圖示（WeaponArt 產生的 wpn_<id>_icon），沒有圖就給個空的佔位 */
  private icon(x: number, y: number, id: string, scale = 1): Phaser.GameObjects.Image {
    const key = `wpn_${id}_icon`;
    const img = this.add.image(x, y, this.textures.exists(key) ? key : '__MISSING').setScale(scale);
    if (!this.textures.exists(key)) img.setVisible(false);
    this.root.add(img);
    return img;
  }

  private listRow(y: number, id: string, name: string, tag: string, tagColor: string, active: boolean, onPress: () => void): void {
    const x = PX + 8;
    const bg = this.add
      .rectangle(x, y, LIST_W, ROW_H - 2, active ? 0x3a3320 : 0x1a1d24, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0xf5d76e, active ? 0.7 : 0)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerdown', (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      AudioManager.ui('tap');
      this.time.delayedCall(0, onPress);
    });
    this.root.add(bg);
    // 圖示置中在左邊 44px 的格子裡
    this.icon(x + 26, y + (ROW_H - 2) / 2, id);
    this.text(x + 50, y + 4, name, 8, '#ffffff');
    this.text(x + LIST_W - 8, y + 4, tag, 8, tagColor).setOrigin(1, 0);
  }

  private bar(x: number, y: number, w: number, label: string, ratio: number, value: string): void {
    const bx = x + 58;
    const bw = w - 58 - 70;
    this.text(x, y, label, 7, '#b0bec5');
    this.root.add(this.add.rectangle(bx, y + 3, bw, 5, 0x000000).setOrigin(0));
    this.root.add(this.add.rectangle(bx + 1, y + 4, Math.max(1, (bw - 2) * Phaser.Math.Clamp(ratio, 0, 1)), 3, 0xf5d76e).setOrigin(0));
    if (value) this.text(x + w, y, value, 7, '#e8e8e8').setOrigin(1, 0);
  }

  private text(x: number, y: number, s: string, size: number, color: string): Phaser.GameObjects.Text {
    const t = pixelText(this, x, y, s, size, color);
    this.root.add(t);
    return t;
  }

  private button(x: number, y: number, w: number, h: number, label: string, enabled: boolean, onPress: () => void, fill = 0x2a2f3a): void {
    const bg = this.add
      .rectangle(x, y, w, h, enabled ? fill : 0x1a1c22, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0xffffff, enabled ? 0.5 : 0.15);
    this.root.add(bg);
    this.root.add(pixelText(this, x + w / 2, y + h / 2, label, 8, enabled ? '#ffffff' : '#6b7280').setOrigin(0.5));
    if (!enabled) return;
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x4a5262, 0.95));
    bg.on('pointerout', () => bg.setFillStyle(fill, 0.95));
    bg.on('pointerdown', (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      AudioManager.ui('tap');
      // 動作會重建整個面板，等這次點擊處理完再做
      this.time.delayedCall(0, onPress);
    });
  }
}
