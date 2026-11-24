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
  type AmmoType,
  type FirearmDef,
  type MeleeDef,
} from '../data/weapons';
import { registerUIRect } from '../input/InputManager';
import { weaponUnlockHint } from '../data/story';
import { GameState } from '../state/GameState';
import { pixelText, wrapCJK } from '../utils/text';

export interface ArmoryData {
  /** 買東西後通知白天介面更新廢料 */
  onChange: () => void;
}

type Tab = 'guns' | 'melee' | 'ammo';

const PX = 20;
const PY = 30;
const PW = GAME_WIDTH - 40;
const PH = GAME_HEIGHT - 40;
/** 左邊用途欄寬、武器卡寬、右邊說明欄寬 */
const ROLE_W = 108;
const CARD_W = 76;
const DETAIL_W = 196;

/**
 * 依「用途」分組：玩家先想「我缺什麼」，再挑那一組裡的槍。
 * 只是顯示用的分組，數值還是在 src/data/weapons.ts。
 */
interface RoleGroup {
  name: string;
  /** 一句話：什麼時候帶它 */
  when: string;
  color: number;
  ids: string[];
}

const GUN_ROLES: RoleGroup[] = [
  { name: '保命副手', when: '換槍快，主槍打空時的退路', color: 0x9ad17a, ids: ['m1911', 'python'] },
  { name: '近身清場', when: '屍群貼到路障前，一槍清一排', color: 0xff8a5a, ids: ['r870', 'coach', 'm1014'] },
  { name: '中距主力', when: '大部分的夜晚都靠它', color: 0x6ab0ff, ids: ['mp5', 'ak47', 'm4a1'] },
  { name: '遠距貫穿', when: '排成一列的霧屍、菁英怪', color: 0xc89aff, ids: ['mosin'] },
  { name: '壓制屍潮', when: '大波次、屍潮夜', color: 0xf5d76e, ids: ['m249'] },
];

const MELEE_ROLES: RoleGroup[] = [
  { name: '快速單殺', when: '省體力，一隻一隻收', color: 0x9ad17a, ids: ['knife', 'machete'] },
  { name: '控場擊飛', when: '被圍住時把整排打開', color: 0x6ab0ff, ids: ['bat', 'sledge'] },
  { name: '破甲處決', when: '戴頭盔的、打暈的一擊收掉', color: 0xff8a5a, ids: ['axe'] },
];

const TAG = { pierce: 0x6a3aa0, crowd: 0xa04a2a, control: 0x2a5a9a, power: 0x8a2a2a, speed: 0x2a7a4a, warn: 0x5a4a1a, neutral: 0x3a3f4a } as const;

/** 槍的特性標籤（從數值推出來，不用另外寫） */
function gunTags(d: FirearmDef): [string, number][] {
  const t: [string, number][] = [];
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
    this.root.add(uiPanel(this, PX, PY, PW, PH));

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

  // ── 槍械／近戰：依用途分組的卡片 ─────────────────────

  private drawGuns(): void {
    this.roleGrid(GUN_ROLES, (id) => {
      const d = FIREARMS.find((f) => f.id === id);
      return d ? { name: d.name, price: d.price, inUse: GameState.data.armory.loadout.indexOf(d.id) } : null;
    });
    const d = FIREARMS.find((f) => f.id === this.selected) ?? FIREARMS[0];
    this.gunDetail(d);
  }

  private drawMelee(): void {
    this.roleGrid(MELEE_ROLES, (id) => {
      const m = MELEE.find((x) => x.id === id);
      return m ? { name: m.name, price: m.price, inUse: GameState.data.armory.melee === m.id ? 0 : -1 } : null;
    });
    const m = MELEE.find((d) => d.id === this.selected) ?? MELEE[0];
    this.meleeDetail(m);
  }

  /** 左側：每一列是一種用途（色條＋用途名＋一句話），後面排這個用途的武器卡 */
  private roleGrid(roles: RoleGroup[], info: (id: string) => { name: string; price: number; inUse: number } | null): void {
    const st = GameState.data;
    const top = PY + 30;
    const rowH = Math.min(52, Math.floor((PH - 30 - 30) / roles.length));
    roles.forEach((r, i) => {
      const y = top + i * rowH;
      // 用途標籤
      this.root.add(this.add.rectangle(PX + 8, y, 3, rowH - 6, r.color).setOrigin(0));
      this.text(PX + 15, y + 2, r.name, 9, '#' + r.color.toString(16).padStart(6, '0'));
      wrapCJK(this.text(PX + 15, y + 16, r.when, 7, '#90a4ae'), ROLE_W - 14);
      r.ids.forEach((id, k) => {
        const w = info(id);
        if (!w) return;
        const x = PX + 8 + ROLE_W + k * (CARD_W + 4);
        const owned = GameState.owns(id);
        const locked = !GameState.inShop(id);
        const tag = w.inUse >= 0 ? (this.tab === 'guns' ? `上場 ${w.inUse + 1}` : '裝備中') : owned ? (GameState.crewHolder(id) ? `${GameState.crewHolder(id)!.name} 拿著` : '擁有') : locked ? '未進貨' : `${w.price} 廢料`;
        const color = w.inUse >= 0 ? '#9ad17a' : owned ? '#c8c8c8' : locked ? '#6b7280' : st.scrap >= w.price ? '#f5d76e' : '#ff6b6b';
        this.card(x, y, rowH - 6, id, w.name, tag, color, id === this.selected, locked && !owned, () => {
          this.selected = id;
          this.redraw();
        });
      });
    });
  }

  private card(x: number, y: number, h: number, id: string, name: string, tag: string, tagColor: string, active: boolean, dim: boolean, onPress: () => void): void {
    const bg = this.add
      .rectangle(x, y, CARD_W, h, active ? 0x3a3320 : 0x1a1d24, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, active ? 0xf5d76e : 0xffffff, active ? 0.8 : 0.08)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => !active && bg.setFillStyle(0x262a34, 0.95));
    bg.on('pointerout', () => !active && bg.setFillStyle(0x1a1d24, 0.95));
    bg.on('pointerdown', (_p: unknown, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      AudioManager.ui('tap');
      this.time.delayedCall(0, onPress);
    });
    this.root.add(bg);
    const icon = this.icon(x + CARD_W / 2, y + 10, id, 1);
    if (dim) icon.setTint(0x555a66);
    this.text(x + CARD_W / 2, y + h - 25, name, 8, dim ? '#8a8f99' : '#ffffff').setOrigin(0.5, 0);
    this.text(x + CARD_W / 2, y + h - 12, tag, 7, tagColor).setOrigin(0.5, 0);
  }

  /** 右側：大圖、用途一句話、星等、特性標籤、按鈕 */
  private detailHeader(id: string, name: string, sub: string, desc: string, role?: RoleGroup): { x: number; y: number; w: number } {
    const x = PX + PW - DETAIL_W - 8;
    const w = DETAIL_W;
    this.root.add(this.add.rectangle(x - 6, PY + 28, w + 10, PH - 56, 0x13161d, 0.95).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.08));
    let y = PY + 32;
    this.showcase(x + w, y, id, w);
    y += 50;
    const nm = this.text(x, y, name, 11, '#ffffff');
    this.text(x + nm.width + 6, y + 4, sub, 7, '#90a4ae');
    y += 17;
    const t = wrapCJK(this.text(x, y, desc, 8, '#c8c8c8').setLineSpacing(2), w);
    y += t.height + 6;
    if (role) {
      const c = '#' + role.color.toString(16).padStart(6, '0');
      const r = wrapCJK(this.text(x, y, `用途｜${role.name}：${role.when}`, 7, c), w);
      y += r.height + 6;
    }
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

  private gunDetail(d: FirearmDef): void {
    const st = GameState.data;
    const role = GUN_ROLES.find((r) => r.ids.includes(d.id));
    let { x, y, w } = this.detailHeader(d.id, d.name, d.model, d.desc, role);
    // 星等兩欄
    this.pips(x, y, '威力', (d.damage * d.pellets) / MAX.dmg);
    this.pips(x + w / 2, y, '火力', dps(d) / MAX.dps);
    this.pips(x, y + 12, '射程', Math.min(d.range, d.falloffEnd) / MAX.range);
    this.pips(x + w / 2, y + 12, '好控', control(d));
    y += 28;
    const reserve = d.infiniteReserve && !st.armory.finitePistol ? '無限' : `${st.armory.ammo[d.ammo]}`;
    y = this.chips(x, y, w, gunTags(d));
    this.text(x, y + 2, `彈匣 ${d.magazine}　${AMMO[d.ammo].name}　備彈 ${reserve}`, 7, '#90a4ae');
    const by = PY + PH - 58;
    const owned = GameState.owns(d.id);
    if (!owned) {
      const locked = !GameState.inShop(d.id);
      const ok = !locked && st.scrap >= d.price;
      this.button(x, by, w, 24, locked ? weaponUnlockHint(d.id) : `購買　${d.price} 廢料`, ok, () => {
        if (GameState.buyWeapon(d.id)) AudioManager.ui('confirm');
        this.changed();
      });
      return;
    }
    const inLoadout = st.armory.loadout.includes(d.id);
    const crewHolder = GameState.crewHolder(d.id);
    const canAdd = st.armory.loadout.length < MAX_GUNS && !crewHolder;
    const label = inLoadout
      ? st.armory.loadout.length > 1 ? '卸下' : '至少要帶一把槍'
      : crewHolder ? `${crewHolder.name} 拿著，先到名冊收回`
      : canAdd ? '帶上場' : `最多帶 ${MAX_GUNS} 把，先卸下一把`;
    this.button(x, by, w, 24, label, inLoadout ? st.armory.loadout.length > 1 : canAdd, () => {
      GameState.toggleLoadout(d.id);
      this.changed();
    });
  }

  private meleeDetail(m: MeleeDef): void {
    const st = GameState.data;
    const swing = m.windup + m.active + m.recovery;
    let { x, y, w } = this.detailHeader(m.id, m.name, m.damageType === 'blunt' ? '鈍器' : '刀刃', m.desc, MELEE_ROLES.find((r) => r.ids.includes(m.id)));
    this.pips(x, y, '傷害', m.damage / MAX.melee);
    this.pips(x + w / 2, y, '出手', Phaser.Math.Clamp(1 - (swing - 0.25) / 0.9, 0.05, 1));
    this.pips(x, y + 12, '範圍', m.arc / 160);
    this.pips(x + w / 2, y + 12, '省力', 1 - m.stamina / 45);
    y += 28;
    const tags: [string, number][] = [];
    if (m.maxTargets >= 3) tags.push([`一次掃 ${m.maxTargets} 隻`, TAG.crowd]);
    else tags.push(['單體', TAG.neutral]);
    if (m.knockback >= 24) tags.push(['擊飛', TAG.control]);
    if (m.stagger >= 0.6) tags.push(['打暈', TAG.control]);
    if (m.penetration >= 0.5) tags.push(['破頭盔', TAG.pierce]);
    if (m.staggerBonus > 1) tags.push(['處決暈眩', TAG.power]);
    if (m.steps) tags.push([`${m.steps.length} 段連擊`, TAG.speed]);
    else if (m.comboEvery > 1) tags.push([`${m.comboEvery} 連砍`, TAG.speed]);
    if (m.heft > 0 && !m.steps) tags.push(['每下重新掄', TAG.warn]);
    if (swing <= 0.4) tags.push(['出手快', TAG.speed]);
    if (swing >= 0.9) tags.push(['起手慢', TAG.warn]);
    y = this.chips(x, y, w, tags);
    this.text(x, y + 2, this.sys.game.device.input.touch ? '「近戰」鍵快揮，「持刀」切成近戰模式，按住連續揮' : '右鍵／V／E 快揮，4／X 切成近戰模式，按住連續揮', 7, '#90a4ae');
    const by = PY + PH - 58;
    if (!GameState.owns(m.id)) {
      const locked = !GameState.inShop(m.id);
      const ok = !locked && st.scrap >= m.price;
      this.button(x, by, w, 24, locked ? weaponUnlockHint(m.id) : `購買　${m.price} 廢料`, ok, () => {
        if (GameState.buyWeapon(m.id)) {
          GameState.equipMelee(m.id);
          AudioManager.ui('confirm');
        }
        this.changed();
      });
      return;
    }
    const eq = st.armory.melee === m.id;
    const holder = GameState.crewHolder(m.id);
    this.button(x, by, w, 24, eq ? '裝備中' : holder ? `${holder.name} 拿著，先到名冊收回` : '裝備', !eq && !holder, () => {
      GameState.equipMelee(m.id);
      this.changed();
    });
  }

  // ── 彈藥 ──────────────────────────────────────────────

  private drawAmmo(): void {
    const st = GameState.data;
    const x = PX + 12;
    const w = PW - 24;
    this.text(x, PY + 32, st.armory.finitePistol ? '你的 M1911 是撿來的，子彈要自己買。彈匣裡剩的天亮會退回備彈。' : 'M1911 備彈無限。其他槍的子彈要在這裡買，彈匣裡剩的天亮會退回備彈。', 8, '#90a4ae');
    (Object.keys(AMMO) as AmmoType[]).forEach((t, i) => {
      const a = AMMO[t];
      const y = PY + 52 + i * 34;
      const have = st.armory.ammo[t];
      const users = FIREARMS.filter((d) => d.ammo === t && (!d.infiniteReserve || st.armory.finitePistol)).map((d) => d.name);
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

  /**
   * 詳細頁右上的展示架：深色泡棉襯底＋洞洞板，武器放大 3 倍、底下有影子（右上角對齊 x, y）。
   * 回傳展示架寬度，讓說明文字讓開。
   */
  private showcase(x: number, y: number, id: string, boxW?: number): number {
    const key = `wpn_${id}_icon`;
    if (!this.textures.exists(key)) return 0;
    const tex = this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    const s = boxW ? Math.max(2, Math.min(4, Math.floor((boxW - 16) / tex.width), Math.floor(30 / tex.height))) : tex.width > 34 ? 2 : 3;
    const w = boxW ?? tex.width * s + 16;
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
    const shadow = this.add.image(cx + 2, cy + 3, key).setScale(s).setTintFill(0x000000).setAlpha(0.45);
    this.root.add(shadow);
    this.root.add(this.add.image(cx, cy, key).setScale(s));
    return w;
  }

  /** 武器圖示（WeaponArt 產生的 wpn_<id>_icon），沒有圖就給個空的佔位 */
  private icon(x: number, y: number, id: string, scale = 1): Phaser.GameObjects.Image {
    const key = `wpn_${id}_icon`;
    const img = this.add.image(x, y, this.textures.exists(key) ? key : '__MISSING').setScale(scale);
    if (!this.textures.exists(key)) img.setVisible(false);
    this.root.add(img);
    return img;
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
