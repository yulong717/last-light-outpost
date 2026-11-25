import Phaser from 'phaser';
import { uiButton, uiPanel } from '../explore/ui';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import {
  AMMO,
  FIREARMS,
  MAX_GUNS,
  MELEE,
  fullReloadTime,
  getWeapon,
  type AmmoType,
  type FirearmDef,
  type MeleeDef,
} from '../data/weapons';
import { SUPPLIES, SUPPLY_PRICE, type SupplyId } from '../data/explore';
import { registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { pixelText, wrapCJK } from '../utils/text';

export interface ArmoryData {
  /** 買東西、換配置後通知白天介面更新 */
  onChange: () => void;
}

type Tab = 'rack' | 'shop';

const PX = 20;
const PY = 30;
const PW = GAME_WIDTH - 40;
const PH = GAME_HEIGHT - 40;
/** 右邊說明欄寬 */
const DETAIL_W = 196;
/** 陳列架（洞洞板）的範圍 */
const RACK_X = PX + 8;
const RACK_Y = PY + 30;
const RACK_W = PW - DETAIL_W - 30;
const RACK_H = PH - 62;
/** 槍架：兩欄、每格高度；近戰架在槍架下面一排 */
const GUN_COLS = 2;
const GUN_SLOT_H = 32;
const MELEE_SLOT_H = 44;

const TAG = { pierce: 0x6a3aa0, crowd: 0xa04a2a, control: 0x2a5a9a, power: 0x8a2a2a, speed: 0x2a7a4a, warn: 0x5a4a1a, neutral: 0x3a3f4a, special: 0x8a6a1a } as const;

/** 槍的特性標籤（從數值推出來，不用另外寫） */
function gunTags(d: FirearmDef): [string, number][] {
  const t: [string, number][] = [];
  if (d.scope) t.push(['狙擊鏡・全圖視野', TAG.special]);
  if (d.silent) t.push(['無聲', TAG.special]);
  if (d.recoverable) t.push(['箭可回收', TAG.special]);
  if (d.pellets > 1) t.push(['散射', TAG.crowd]);
  if (d.pierce >= 2) t.push([`貫穿 ${d.pierce} 隻`, TAG.pierce]);
  if (d.stopping >= 0.5) t.push(['擊退・解圍', TAG.control]);
  if (d.action === 'auto') t.push(['連射', TAG.speed]);
  if (d.infiniteReserve) t.push(['子彈無限', TAG.speed]);
  if (d.penetration >= 0.5) t.push(['穿甲', TAG.pierce]);
  if (d.reload === 'single') t.push(['逐發裝填', TAG.warn]);
  if (d.moveMul < 0.85) t.push(['笨重', TAG.warn]);
  if (d.swapTime <= 0.3) t.push(['換槍快', TAG.speed]);
  return t.slice(0, 5);
}

function meleeTags(m: MeleeDef): [string, number][] {
  const swing = m.windup + m.active + m.recovery;
  const t: [string, number][] = [];
  if (m.charge) t.push(['邊走邊蓄力・一閃', TAG.special]);
  if (m.maxTargets >= 3) t.push([`一次掃 ${m.maxTargets} 隻`, TAG.crowd]);
  else t.push(['單體', TAG.neutral]);
  if (m.knockback >= 24) t.push(['擊飛', TAG.control]);
  if (m.stagger >= 0.6) t.push(['打暈', TAG.control]);
  if (m.penetration >= 0.5) t.push(['破頭盔', TAG.pierce]);
  if ((m.gore ?? 0) >= 2) t.push(['砍斷手腳', TAG.power]);
  if (m.staggerBonus > 1) t.push(['處決暈眩', TAG.power]);
  if (m.steps) t.push([`${m.steps.length} 段連擊`, TAG.speed]);
  if (swing <= 0.4) t.push(['出手快', TAG.speed]);
  if (swing >= 0.9) t.push(['起手慢', TAG.warn]);
  return t.slice(0, 6);
}

/** 能力條的上限（用全名單的最大值正規化；巴雷特單發太誇張，威力上限壓在 100） */
const MAX = {
  dmg: 100,
  dps: Math.max(...FIREARMS.map((d) => dps(d))),
  range: 900,
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
 * 軍械庫（白天）：
 * - 陳列架：撿到的武器掛在洞洞板上，還沒撿到的只剩黑色剪影，選了會說在哪裡找得到。
 *   在這裡決定今晚帶哪三把槍、哪一把近戰。武器不能買，只能去指定地點撿（見 src/data/weapons.ts 的 found）。
 * - 商店：只賣彈藥和物資。
 * 疊在白天介面上方；Esc 或右上角關閉。
 */
export class ArmoryScene extends Phaser.Scene {
  private onChange!: () => void;
  private tab: Tab = 'rack';
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
    // 一打開先選身上的第一把槍
    this.selected = GameState.data.armory.loadout[0] ?? GameState.data.armory.melee;
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
    this.root.add(uiPanel(this, PX, PY, PW, PH));

    this.text(PX + 10, PY + 7, '軍械庫', 11, '#f5d76e');
    this.text(PX + 70, PY + 9, `廢料 ${st.scrap}　第 ${st.day} 天`, 8, '#e8e8e8');
    this.button(PX + PW - 30, PY + 4, 26, 20, '✕', true, () => this.close());

    const tabs: [Tab, string][] = [
      ['rack', '陳列架'],
      ['shop', '商店'],
    ];
    tabs.forEach(([t, label], i) => {
      this.button(PX + 200 + i * 70, PY + 4, 66, 20, label, true, () => {
        this.tab = t;
        this.redraw();
      }, this.tab === t ? 0x5a4a1a : 0x2a2f3a);
    });

    if (this.tab === 'rack') {
      this.drawRack();
      const w = getWeapon(this.selected) ?? FIREARMS[0];
      if (w.kind === 'firearm') this.gunDetail(w);
      else this.meleeDetail(w);
    } else this.drawShop();
    this.drawLoadout();
  }

  // ── 陳列架 ──────────────────────────────────────────

  private drawRack(): void {
    const g = this.add.graphics();
    this.root.add(g);
    // 洞洞板：木框、深色板面、整齊的小洞
    g.fillStyle(0x4a3524, 1).fillRect(RACK_X, RACK_Y, RACK_W, RACK_H);
    g.fillStyle(0x2b2f36, 1).fillRect(RACK_X + 4, RACK_Y + 4, RACK_W - 8, RACK_H - 8);
    g.fillStyle(0x1b1e23, 1);
    for (let y = RACK_Y + 9; y < RACK_Y + RACK_H - 6; y += 8) for (let x = RACK_X + 9; x < RACK_X + RACK_W - 6; x += 8) g.fillRect(x, y, 1, 1);
    // 頂燈
    g.fillStyle(0xf5d76e, 0.05).fillRect(RACK_X + 4, RACK_Y + 4, RACK_W - 8, 40);

    const inner = RACK_W - 16;
    const slotW = Math.floor((inner - (GUN_COLS - 1) * 6) / GUN_COLS);
    this.text(RACK_X + 8, RACK_Y + 6, '槍械', 7, '#b0bec5');
    FIREARMS.forEach((d, i) => {
      const col = i % GUN_COLS;
      const row = Math.floor(i / GUN_COLS);
      const x = RACK_X + 8 + col * (slotW + 6);
      const y = RACK_Y + 16 + row * (GUN_SLOT_H + 3);
      const idx = GameState.data.armory.loadout.indexOf(d.id);
      this.slot(x, y, slotW, GUN_SLOT_H, d.id, d.name, idx >= 0 ? `${idx + 1}` : '');
    });
    const gunRows = Math.ceil(FIREARMS.length / GUN_COLS);
    const my = RACK_Y + 16 + gunRows * (GUN_SLOT_H + 3) + 6;
    // 近戰架：橫木一條
    g.fillStyle(0x4a3524, 1).fillRect(RACK_X + 4, my - 4, RACK_W - 8, 2);
    this.text(RACK_X + 8, my - 1, '近戰', 7, '#b0bec5');
    const mw = Math.floor((inner - (MELEE.length - 1) * 4) / MELEE.length);
    MELEE.forEach((m, i) => {
      const x = RACK_X + 8 + i * (mw + 4);
      this.slot(x, my + 9, mw, Math.min(MELEE_SLOT_H, RACK_Y + RACK_H - my - 14), m.id, m.name, GameState.data.armory.melee === m.id ? '近戰' : '');
    });
  }

  /**
   * 陳列架上的一格：擁有的武器掛在兩根掛鉤上；還沒撿到的只剩黑色剪影和問號。
   * badge：帶上場的編號（槍）或「近戰」。
   */
  private slot(x: number, y: number, w: number, h: number, id: string, name: string, badge: string): void {
    const owned = GameState.owns(id);
    const active = id === this.selected;
    const holder = GameState.crewHolder(id);
    const zone = this.add
      .rectangle(x, y, w, h, 0xffffff, active ? 0.08 : 0)
      .setOrigin(0)
      .setStrokeStyle(1, active ? 0xf5d76e : 0xffffff, active ? 0.8 : 0.05)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => !active && zone.setFillStyle(0xffffff, 0.04));
    zone.on('pointerout', () => !active && zone.setFillStyle(0xffffff, 0));
    zone.on('pointerdown', (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      AudioManager.ui('tap');
      this.time.delayedCall(0, () => {
        this.selected = id;
        this.redraw();
      });
    });
    this.root.add(zone);

    const key = `wpn_${id}_icon`;
    const cx = x + w / 2;
    const cy = y + (h - 10) / 2 + 1;
    if (this.textures.exists(key)) {
      const tex = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
      const s = Math.max(1, Math.min(2, Math.floor((w - 10) / tex.width), Math.floor((h - 12) / tex.height)));
      if (owned) {
        // 掛鉤
        const g = this.add.graphics();
        g.fillStyle(0x8d9097, 1);
        g.fillRect(cx - (tex.width * s) / 4, cy - (tex.height * s) / 2 - 2, 2, 4);
        g.fillRect(cx + (tex.width * s) / 4, cy - (tex.height * s) / 2 - 2, 2, 4);
        this.root.add(g);
        this.root.add(this.add.image(cx + 1, cy + 2, key).setScale(s).setTintFill(0x000000).setAlpha(0.4));
        const img = this.add.image(cx, cy, key).setScale(s);
        // 拿在隊員手上：架上只剩淡淡的影子
        if (holder) img.setAlpha(0.35);
        this.root.add(img);
      } else {
        this.root.add(this.add.image(cx, cy, key).setScale(s).setTintFill(0x0e1014).setAlpha(0.9));
        this.text(cx, cy - 5, '？', 9, '#5a606b').setOrigin(0.5, 0);
      }
    }
    const label = owned ? (holder ? `${name}（${holder.name}）` : name) : '？？？';
    this.text(cx, y + h - 10, label, 7, owned ? (badge ? '#9ad17a' : '#d0d4da') : '#5a606b').setOrigin(0.5, 0);
    if (badge) {
      const t = pixelText(this, 0, 0, badge, 7, '#10140c');
      const bw = t.width + 6;
      this.root.add(this.add.rectangle(x + 2, y + 2, bw, 11, 0x9ad17a, 1).setOrigin(0));
      t.setPosition(x + 5, y + 2);
      this.root.add(t);
    }
  }

  /** 右側：展示大圖、名稱、說明 */
  private detailHeader(id: string, name: string, sub: string, desc: string): { x: number; y: number; w: number } {
    const x = PX + PW - DETAIL_W - 8;
    const w = DETAIL_W;
    this.root.add(this.add.rectangle(x - 6, PY + 28, w + 10, PH - 56, 0x13161d, 0.95).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.08));
    let y = PY + 32;
    const owned = GameState.owns(id);
    this.showcase(x + w, y, id, w, !owned);
    y += 50;
    const nm = this.text(x, y, name, 11, owned ? '#ffffff' : '#9aa0aa');
    this.text(x + nm.width + 6, y + 4, sub, 7, '#90a4ae');
    y += 17;
    const t = wrapCJK(this.text(x, y, desc, 8, owned ? '#c8c8c8' : '#8a9099').setLineSpacing(2), w);
    y += t.height + 6;
    return { x, y, w };
  }

  /** 星等：●●●○○，一眼看出強弱 */
  private pips(x: number, y: number, label: string, ratio: number): void {
    this.text(x, y, label, 7, '#b0bec5');
    const n = Math.max(1, Math.min(5, Math.round(Phaser.Math.Clamp(ratio, 0, 1) * 5)));
    const g = this.add.graphics();
    this.root.add(g);
    for (let i = 0; i < 5; i++) {
      g.fillStyle(i < n ? 0xf5d76e : 0x2e323c, 1).fillRect(x + 30 + i * 9, y + 2, 7, 6);
    }
  }

  /** 特性標籤：彩色小方塊，最多一行半 */
  private chips(x: number, y: number, w: number, list: [string, number][]): number {
    let cx = x;
    let cy = y;
    for (const [label, color] of list) {
      const t = pixelText(this, 0, 0, label, 7, '#ffffff');
      const cw = t.width + 8;
      if (cx + cw > x + w) {
        cx = x;
        cy += 14;
      }
      this.root.add(this.add.rectangle(cx, cy, cw, 12, color, 0.85).setOrigin(0));
      t.setPosition(cx + 4, cy + 1);
      this.root.add(t);
      cx += cw + 4;
    }
    return cy + 14;
  }

  /** 還沒撿到：按鈕位置改成「在哪裡撿得到」 */
  private whereHint(x: number, y: number, w: number, where: string): void {
    this.root.add(this.add.rectangle(x, y, w, 24, 0x1d2027, 1).setOrigin(0).setStrokeStyle(1, 0xffd180, 0.35));
    wrapCJK(this.text(x + 6, y + 3, `在「${where}」撿得到`, 7, '#ffd180'), w - 12);
  }

  private gunDetail(d: FirearmDef): void {
    const st = GameState.data;
    let { x, y, w } = this.detailHeader(d.id, d.name, d.model, d.desc);
    this.pips(x, y, '威力', (d.damage * d.pellets) / MAX.dmg);
    this.pips(x + w / 2, y, '火力', dps(d) / MAX.dps);
    this.pips(x, y + 12, '射程', Math.min(d.range, d.falloffEnd) / MAX.range);
    this.pips(x + w / 2, y + 12, '好控', control(d));
    y += 28;
    const reserve = d.infiniteReserve && !st.armory.finitePistol ? '無限' : `${st.armory.ammo[d.ammo]}`;
    y = this.chips(x, y, w, gunTags(d));
    this.text(x, y + 2, `彈匣 ${d.magazine}　${AMMO[d.ammo].name}　備彈 ${reserve}`, 7, '#90a4ae');
    if (d.scope) this.text(x, y + 14, this.sys.game.device.input.touch ? '「瞄準」鍵開鏡，游標推到畫面邊緣看整張地圖' : 'Z 鍵開鏡，游標推到畫面邊緣看整張地圖', 7, '#ffd180');
    const by = PY + PH - 58;
    if (!GameState.owns(d.id)) {
      this.whereHint(x, by, w, d.found.where);
      return;
    }
    const inLoadout = st.armory.loadout.includes(d.id);
    const crewHolder = GameState.crewHolder(d.id);
    const canAdd = st.armory.loadout.length < MAX_GUNS && !crewHolder;
    const label = inLoadout
      ? st.armory.loadout.length > 1 ? '從身上卸下' : '至少要帶一把槍'
      : crewHolder ? `${crewHolder.name} 拿著，先到名冊收回`
      : canAdd ? '帶上場' : `最多帶 ${MAX_GUNS} 把，先卸下一把`;
    this.button(x, by, w, 24, label, inLoadout ? st.armory.loadout.length > 1 : canAdd, () => {
      GameState.toggleLoadout(d.id);
      AudioManager.ui('confirm');
      this.changed();
    });
  }

  private meleeDetail(m: MeleeDef): void {
    const st = GameState.data;
    const swing = m.windup + m.active + m.recovery;
    let { x, y, w } = this.detailHeader(m.id, m.name, m.damageType === 'blunt' ? '鈍器' : '刀刃', m.desc);
    this.pips(x, y, '傷害', m.damage / MAX.melee);
    this.pips(x + w / 2, y, '出手', Phaser.Math.Clamp(1 - (swing - 0.25) / 0.9, 0.05, 1));
    this.pips(x, y + 12, '範圍', m.arc / 160);
    this.pips(x + w / 2, y + 12, '省力', 1 - m.stamina / 45);
    y += 28;
    y = this.chips(x, y, w, meleeTags(m));
    const touch = this.sys.game.device.input.touch;
    const how = m.charge
      ? touch ? '按住「近戰」蓄力、放開一閃；點一下是一般連段' : '按住右鍵／V／E 蓄力、放開一閃；點一下是一般連段'
      : touch ? '「近戰」鍵快揮，「持刀」切成近戰模式，按住連續揮' : '右鍵／V／E 快揮，4／X 切成近戰模式，按住連續揮';
    wrapCJK(this.text(x, y + 2, how, 7, '#90a4ae'), w);
    const by = PY + PH - 58;
    if (!GameState.owns(m.id)) {
      this.whereHint(x, by, w, m.found.where);
      return;
    }
    const eq = st.armory.melee === m.id;
    const holder = GameState.crewHolder(m.id);
    this.button(x, by, w, 24, eq ? '裝備中' : holder ? `${holder.name} 拿著，先到名冊收回` : '裝備', !eq && !holder, () => {
      GameState.equipMelee(m.id);
      AudioManager.ui('confirm');
      this.changed();
    });
  }

  // ── 商店：只賣彈藥和物資 ─────────────────────────────

  private drawShop(): void {
    const st = GameState.data;
    const x = PX + 12;
    const colW = (PW - 36) / 2;
    this.text(x, PY + 32, '商店只賣彈藥和物資。武器要自己去找，撿到的會掛上陳列架。', 8, '#90a4ae');
    this.text(x, PY + 46, '彈藥', 9, '#f5d76e');
    (Object.keys(AMMO) as AmmoType[]).forEach((t, i) => {
      const a = AMMO[t];
      const y = PY + 60 + i * 30;
      const have = st.armory.ammo[t];
      const users = FIREARMS.filter((d) => d.ammo === t && (!d.infiniteReserve || st.armory.finitePistol)).map((d) => (GameState.owns(d.id) ? d.name : '？？？'));
      this.root.add(this.add.rectangle(x, y, colW, 27, 0x1a1d24, 0.9).setOrigin(0));
      this.text(x + 6, y + 2, a.name, 8, '#ffffff');
      this.text(x + 6, y + 15, users.join('、'), 7, '#90a4ae');
      this.text(x + 110, y + 8, `${have}/${a.max}`, 8, have === 0 ? '#ff6b6b' : '#e8e8e8');
      const full = have >= a.max;
      const ok = !full && st.scrap >= a.price;
      this.button(x + colW - 104, y + 3, 100, 21, full ? '已滿' : `${a.box} 發　${a.price} 廢料`, ok, () => {
        if (GameState.buyAmmo(t) > 0) AudioManager.ui('confirm');
        this.changed();
      });
    });

    const sx = x + colW + 12;
    this.text(sx, PY + 46, '物資', 9, '#f5d76e');
    (Object.keys(SUPPLIES) as SupplyId[]).forEach((id, i) => {
      const s = SUPPLIES[id];
      const price = SUPPLY_PRICE[id];
      const y = PY + 60 + i * 44;
      const have = st.supplies[id];
      this.root.add(this.add.rectangle(sx, y, colW, 40, 0x1a1d24, 0.9).setOrigin(0));
      this.text(sx + 6, y + 3, `${s.name}　${have}/${s.max}`, 8, '#ffffff');
      wrapCJK(this.text(sx + 6, y + 16, s.desc, 7, '#90a4ae'), colW - 118);
      const full = have >= s.max;
      const ok = !full && st.scrap >= price;
      this.button(sx + colW - 104, y + 9, 100, 21, full ? '已滿' : `買 1 個　${price} 廢料`, ok, () => {
        if (GameState.buySupply(id)) AudioManager.ui('confirm');
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
    const found = [...FIREARMS, ...MELEE].filter((w) => GameState.owns(w.id)).length;
    this.text(PX + 10, y + 2, `今晚帶上場：${guns}　｜　近戰 ${melee}`, 8, '#f5d76e');
    this.text(PX + PW - 10, y + 2, `收集 ${found}/${FIREARMS.length + MELEE.length}`, 8, '#90a4ae').setOrigin(1, 0);
  }

  // ── 小元件 ────────────────────────────────────────────

  /**
   * 詳細頁右上的展示框：深色泡棉襯底＋洞洞板，武器放大、底下有影子（右上角對齊 x, y）。
   * silhouette：還沒撿到，只畫黑色剪影。
   */
  private showcase(x: number, y: number, id: string, boxW: number, silhouette: boolean): void {
    const key = `wpn_${id}_icon`;
    if (!this.textures.exists(key)) return;
    const tex = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    const s = Math.max(1, Math.min(4, Math.floor((boxW - 16) / tex.width), Math.floor(30 / tex.height)));
    const w = boxW;
    const h = Math.max(44, tex.height * s + 14);
    const left = x - w;
    const g = this.add.graphics();
    this.root.add(g);
    g.fillStyle(0x3a3e46, 1).fillRect(left, y, w, h);
    g.fillStyle(0x2a2e36, 1).fillRect(left + 3, y + 3, w - 6, h - 6);
    g.fillStyle(0x1c1e24, 1);
    for (let yy = y + 6; yy < y + h - 4; yy += 6) for (let xx = left + 6; xx < x - 4; xx += 6) g.fillRect(xx, yy, 1, 1);
    g.lineStyle(1, 0xf5d76e, 0.35).strokeRect(left + 0.5, y + 0.5, w - 1, h - 1);
    // 頂燈打下來的光
    g.fillStyle(0xf5d76e, 0.05).fillRect(left + 3, y + 3, w - 6, Math.round(h / 3));
    const cx = left + w / 2;
    const cy = y + h / 2;
    if (silhouette) {
      this.root.add(this.add.image(cx, cy, key).setScale(s).setTintFill(0x0e1014));
      return;
    }
    this.root.add(this.add.image(cx + 2, cy + 3, key).setScale(s).setTintFill(0x000000).setAlpha(0.45));
    this.root.add(this.add.image(cx, cy, key).setScale(s));
  }

  private text(x: number, y: number, s: string, size: number, color: string): Phaser.GameObjects.Text {
    const t = pixelText(this, x, y, s, size, color);
    this.root.add(t);
    return t;
  }

  private button(x: number, y: number, w: number, h: number, label: string, enabled: boolean, onPress: () => void, fill?: number): void {
    // 動作會重建整個面板：uiButton 會等這次點擊處理完再做
    this.root.add(uiButton(this, x, y, w, h, label, onPress, { enabled, fill }));
  }
}
