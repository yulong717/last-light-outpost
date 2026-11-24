import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { ensureCrewTexture } from '../art/CrewArt';
import { ensureCityMap, ensureZoneIcons, ZONE_ICON_KEY, zoneIconFrame } from '../art/MapArt';
import { COMPANION_ROLES, crewReady, type CrewMember } from '../data/companions';
import { EXPLORE_TIME, INTEL, SUPPLIES, getZone, type SupplyId } from '../data/explore';
import { DAY_HOURS, ROUTE_EDGES, ROUTE_NODES, clockText, exploreHours, getNode, nearestOutpost, travelHours, type RouteNode } from '../data/route';
import { getOutpostMap } from '../data/scenery';
import { Expedition } from '../explore/Expedition';
import { stars, uiButton, uiPanel, uiTopBar } from '../explore/ui';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import type { DefenseSceneData } from './DefenseScene';

const MAP_X = 8;
const MAP_Y = 32;
const MAP_W = 392;
const MAP_H = 320;
const PANEL_X = 408;
const PANEL_W = GAME_WIDTH - PANEL_X - 8;

export interface ExploreMapData {
  /** 剛逃出學校：還沒有據點可回（序章結束時帶入） */
  forced?: boolean;
}

/**
 * 路線圖：主角帶著隊伍沿路線移動，一邊搜刮、一邊找能過夜的據點。
 * 上方是今天的時間條（08:00～18:00）。走到相鄰地點要花路程時數，搜刮探索點再花 2～4 小時；
 * 走到據點可以在那裡過夜；時間用完就只能退回最後經過的據點防守。
 * 資料在 src/data/route.ts，說明見 docs/ROUTE.md。
 */
export class ExploreMapScene extends Phaser.Scene {
  private selected: RouteNode | null = null;
  private squad: string[] = [];
  private panel!: Phaser.GameObjects.Container;
  private markers = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super('ExploreMap');
  }

  create(): void {
    this.selected = null;
    this.squad = [];
    this.markers.clear();
    AudioManager.setMood('menu');
    const st = GameState.data;
    // 序章之前的舊存檔：從據點出發
    st.route ??= { node: 'street', hours: DAY_HOURS, lastOutpost: 'street' };
    // 預設帶上能出戰的前兩位
    this.squad = st.crew.filter((c) => crewReady(c) && !c.standby).slice(0, EXPLORE_TIME.maxSquad).map((c) => c.id);

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x111318).setOrigin(0);
    this.drawMap();
    this.drawTopBar();
    this.panel = this.add.container(0, 0).setDepth(100);
    this.selected = getNode(st.route.node) ?? null;
    this.refresh();
    if (st.route.hours <= 0) this.time.delayedCall(400, () => this.nightfall());
  }

  private get route() {
    return GameState.data.route!;
  }

  // ── 上方：天數、時間條、用品 ──

  private drawTopBar(): void {
    const st = GameState.data;
    const r = this.route;
    uiTopBar(this, 26);
    pixelText(this, 8, 6, `第 ${st.day} 天`, 9, '#f5d76e');
    const x0 = 64;
    const w = 220;
    pixelText(this, x0, 7, '08:00', 7, '#9aa3ad');
    const bx = x0 + 34;
    const bw = w - 68;
    const used = (DAY_HOURS - r.hours) / DAY_HOURS;
    this.add.rectangle(bx, 8, bw, 9, 0x000000).setOrigin(0).setDepth(99);
    this.add.rectangle(bx + 1, 9, (bw - 2) * (1 - used), 7, r.hours <= 2 ? 0xef6c3a : 0xf5d76e).setOrigin(0).setDepth(99);
    for (let h = 1; h < DAY_HOURS; h++) this.add.rectangle(bx + (bw * h) / DAY_HOURS, 9, 1, 7, 0x000000, 0.5).setOrigin(0).setDepth(99);
    pixelText(this, bx + bw + 4, 7, '18:00', 7, '#9aa3ad');
    pixelText(this, x0 + w + 6, 6, `${clockText(r.hours)}・剩 ${r.hours} 小時`, 9, r.hours <= 2 ? '#ff8a65' : '#e8e8e8');
    pixelText(this, 420, 7, this.suppliesLine(), 8, '#b0bec5');
  }

  private suppliesLine(): string {
    const s = GameState.data.supplies;
    return (Object.keys(SUPPLIES) as SupplyId[]).map((id) => `${SUPPLIES[id].name}${s[id]}`).join(' ');
  }

  private toMap(n: { x: number; y: number }): { x: number; y: number } {
    return { x: MAP_X + 24 + (n.x / 600) * (MAP_W - 48), y: MAP_Y + 10 + ((n.y - 90) / 190) * (MAP_H - 50) };
  }

  private locked(n: RouteNode): boolean {
    return n.kind === 'explore' && !GameState.zoneOpen(n.zone!);
  }

  // ── 地圖：路線、地點、目前位置 ──

  private drawMap(): void {
    this.add.image(MAP_X, MAP_Y, ensureCityMap(this, MAP_W, MAP_H)).setOrigin(0);
    ensureZoneIcons(this);
    const here = this.route.node;
    const g = this.add.graphics();
    for (const [width, color] of [
      [7, 0x0a0b0e],
      [4, 0x55504a],
    ] as const) {
      for (const [a, b] of ROUTE_EDGES) {
        const pa = this.toMap(getNode(a)!);
        const pb = this.toMap(getNode(b)!);
        g.lineStyle(width, color, 0.95).lineBetween(pa.x, pa.y, pb.x, pb.y);
      }
    }
    // 從目前位置出去的路：金色虛線＋路程時數
    for (const [a, b, h] of ROUTE_EDGES) {
      if (a !== here && b !== here) continue;
      const pa = this.toMap(getNode(a)!);
      const pb = this.toMap(getNode(b)!);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      for (let d = 4; d < len - 2; d += 7) {
        const t = d / len;
        g.fillStyle(0xf5d76e, 0.85).fillRect(Math.round(pa.x + (pb.x - pa.x) * t), Math.round(pa.y + (pb.y - pa.y) * t), 2, 2);
      }
      // 標籤放在偏向目的地那一側，避免壓到目前位置的名字
      const [from, to] = a === here ? [pa, pb] : [pb, pa];
      const mx = from.x + (to.x - from.x) * 0.6;
      const my = from.y + (to.y - from.y) * 0.6;
      this.add.rectangle(mx, my, 22, 11, 0x000000, 0.75).setStrokeStyle(1, 0xf5d76e, 0.6);
      pixelText(this, mx, my, `${h}h`, 7, '#f5d76e').setOrigin(0.5);
    }
    g.lineStyle(1, 0xf5d76e, 0.4).strokeRect(MAP_X, MAP_Y, MAP_W, MAP_H);

    const st = GameState.data;
    for (const n of ROUTE_NODES) {
      const p = this.toMap(n);
      const locked = this.locked(n);
      const done = n.kind === 'explore' && st.exploredToday.includes(n.zone!);
      const c = this.add.container(p.x, p.y);
      const ring = this.add.circle(0, 0, 14).setStrokeStyle(2, 0xffffff, 0.9).setVisible(false);
      c.add(ring);
      let hit: Phaser.GameObjects.Shape;
      if (n.kind === 'outpost') {
        // 據點：方形圍牆＋燈光；最後經過的據點多一圈光
        if (this.route.lastOutpost === n.id) c.add(this.add.circle(0, 0, 18, 0xf5d76e, 0.12));
        hit = this.add.rectangle(0, 0, 16, 16, 0x2e4a2a).setStrokeStyle(2, 0x9ad17a, 0.95);
        c.add([hit, this.add.rectangle(0, 0, 6, 6, 0xf5d76e)]);
      } else if (n.kind === 'start') {
        hit = this.add.circle(0, 0, 7, 0x3a3d44).setStrokeStyle(2, 0x9aa3ad, 0.8);
        c.add(hit);
      } else {
        const z = getZone(n.zone!)!;
        const r = z.time === 2 ? 11 : 9;
        hit = this.add.circle(0, 0, r, locked ? 0x3a3d44 : z.color, done ? 0.35 : 0.95).setStrokeStyle(2, locked ? 0x000000 : 0xffffff, locked ? 0.8 : 0.7);
        c.add(hit);
        const icon = zoneIconFrame(z.id);
        if (icon >= 0) c.add(this.add.image(0, 0, ZONE_ICON_KEY, icon).setAlpha(locked ? 0.45 : done ? 0.6 : 1));
        if (st.intel?.zone === z.id && !locked) {
          const bang = pixelText(this, r + 2, -r - 10, '!', 12, '#ffd24a');
          c.add(bang);
          this.tweens.add({ targets: bang, y: bang.y - 3, duration: 500, yoyo: true, repeat: -1 });
        }
        if (GameState.isStoryZone(z.id) && !done) {
          const flag = pixelText(this, -r - 4, -r - 14, '★主線', 8, '#f5d76e').setOrigin(1, 0);
          c.add(flag);
          this.tweens.add({ targets: flag, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
        }
      }
      const color = n.kind === 'outpost' ? '#9ad17a' : locked ? '#6b7280' : done ? '#8a8f99' : '#ffffff';
      const name = pixelText(this, 0, 12, n.name, 7, color).setOrigin(0.5, 0);
      c.add([this.add.rectangle(0, 12, name.width + 6, 11, 0x000000, 0.6).setOrigin(0.5, 0), name]);
      c.setData('ring', ring);
      hit.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        AudioManager.ui('tap');
        this.selected = n;
        this.refresh();
      });
      this.markers.set(n.id, c);
    }
    // 目前位置：主角的小旗子
    const hp = this.toMap(getNode(here)!);
    const me = this.add.container(hp.x, hp.y - 18);
    me.add([this.add.rectangle(0, 0, 3, 14, 0xe8e8e8).setOrigin(0.5, 0), this.add.triangle(6, 3, 0, 0, 10, 4, 0, 8, 0xef5350)]);
    pixelText(this, hp.x, hp.y - 30, '你在這裡', 7, '#ffcc80').setOrigin(0.5);
    this.tweens.add({ targets: me, y: me.y - 2, duration: 500, yoyo: true, repeat: -1 });
  }

  // ── 右側面板 ──

  private refresh(): void {
    this.panel.removeAll(true);
    for (const [id, c] of this.markers) (c.getData('ring') as Phaser.GameObjects.Arc).setVisible(this.selected?.id === id);
    const add = (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => this.panel.add(o);
    const r = this.route;
    const y0 = MAP_Y;
    add(uiPanel(this, PANEL_X, y0, PANEL_W, MAP_H));
    const n = this.selected;
    if (!n) return;
    const here = n.id === r.node;
    const hours = here ? 0 : travelHours(r.node, n.id);
    const locked = this.locked(n);
    const kindLabel = n.kind === 'outpost' ? '據點' : n.kind === 'start' ? '' : '探索點';
    add(pixelText(this, PANEL_X + 10, y0 + 8, n.name, 10, n.kind === 'outpost' ? '#9ad17a' : '#f5d76e'));
    add(pixelText(this, PANEL_X + PANEL_W - 10, y0 + 10, here ? '目前位置' : hours === null ? '不相鄰' : `${kindLabel}・路程 ${hours} 小時`, 8, '#c8c8c8').setOrigin(1, 0));
    let y = y0 + 26;
    const text = (t: string, color = '#c8c8c8', size = 8) => {
      const o = pixelText(this, PANEL_X + 10, y, t, size, color).setWordWrapWidth(PANEL_W - 20, true);
      add(o);
      y += o.height + 4;
    };

    if (n.kind === 'outpost') {
      const map = getOutpostMap(n.map);
      text(map.blurb);
      for (const p of map.perks) text(`・${p}`, '#9ad17a');
      if (GameState.data.outpostMap !== map.id && GameState.data.buildings.length) text('換到這裡過夜：舊據點的建築拆掉，退回一半廢料。', '#ffcc80', 7);
    } else if (n.kind === 'explore') {
      const z = getZone(n.zone!)!;
      text(z.blurb);
      text(`風險 ${stars(z.risk)}　搜刮 ${exploreHours(z)} 小時　${z.nodes} 個地點`, '#ff8a6a');
      text(`可能找到：${z.tags.join('、')}`, '#9ad17a');
      if (GameState.isStoryZone(z.id)) text(`★主線　${GameState.chapter!.title}：${GameState.chapter!.objective}`, '#f5d76e', 7);
      const st = GameState.data;
      if (st.intel?.zone === z.id) text(`情報：${INTEL[st.intel.kind].name}　${INTEL[st.intel.kind].desc}`, '#ffd24a', 7);
    } else if (n.blurb) text(n.blurb);

    // 動作按鈕（由下往上排）
    const bw = PANEL_W - 16;
    let by = y0 + MAP_H - 34;
    const button = (label: string, why: string, fn: () => void, fill = 0x7a2a22) => {
      add(uiButton(this, PANEL_X + 8, by, bw, 26, why || label, fn, { enabled: !why, fill, size: 9 }));
      by -= 32;
    };
    if (!here && hours === null) {
      text('要從相鄰的地點過去（金色虛線是現在能走的路）。', '#90a4ae', 7);
      return;
    }
    const left = r.hours;
    if (n.kind === 'outpost') {
      if (here) button('在這裡過夜 ▶', '', () => this.settle(n), 0x2e4a2a);
      else button(`前往（${hours} 小時）`, hours! > left ? '時間不夠' : '', () => this.move(n, hours!), 0x2a3a5a);
    } else if (n.kind === 'explore') {
      const z = getZone(n.zone!)!;
      const cost = (hours ?? 0) + exploreHours(z);
      const done = GameState.data.exploredToday.includes(z.id);
      const why = locked ? '主線推進後開放' : done ? '今天已經搜過' : cost > left ? `時間不夠（要 ${cost} 小時）` : '';
      button(here ? `搜刮（${exploreHours(z)} 小時）▶` : `前往並搜刮（共 ${cost} 小時）▶`, why, () => this.explore(n, hours ?? 0));
      if (!here) button(`只是路過（${hours} 小時）`, locked ? '主線推進後開放' : hours! > left ? '時間不夠' : '', () => this.move(n, hours!), 0x2a3a5a);
      // 同行隊員
      if (!locked && !done) {
        add(pixelText(this, PANEL_X + 10, y + 2, `同行隊員（最多 ${EXPLORE_TIME.maxSquad} 位）`, 8, '#f5d76e'));
        const crew = GameState.data.crew.slice(0, Math.max(0, Math.floor((by + 26 - (y + 18)) / 22)));
        if (crew.length === 0) add(pixelText(this, PANEL_X + 10, y + 16, '沒有隊員，只能獨自出發。', 8, '#90a4ae'));
        crew.forEach((m, i) => this.crewRow(m, PANEL_X + 8, y + 16 + i * 22));
      }
    }
  }

  private crewRow(m: CrewMember, x: number, y: number): void {
    const ready = crewReady(m);
    const on = this.squad.includes(m.id);
    const w = PANEL_W - 16;
    const bg = this.add
      .rectangle(x, y, w, 20, on ? 0x3a4a2a : 0x1c2029, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, on ? 0x9ad17a : 0xffffff, on ? 0.8 : 0.12);
    this.panel.add(bg);
    const key = ensureCrewTexture(this, m) ?? 'player';
    const img = this.add.image(x - 16, y - 4, key, 0).setOrigin(0, 0).setCrop(18, 4, 26, 20);
    if (key === 'player') img.setTint(COMPANION_ROLES[m.role].tint);
    this.panel.add(img);
    this.panel.add(pixelText(this, x + 36, y + 4, m.name, 8, ready ? '#ffffff' : '#6b7280'));
    this.panel.add(pixelText(this, x + 90, y + 4, COMPANION_ROLES[m.role].title, 8, ready ? '#c8c8c8' : '#6b7280'));
    const attrs = `腳${m.attrs.agi} 手${m.attrs.hand} 膽${m.attrs.nerve}`;
    this.panel.add(pixelText(this, x + w - 6, y + 4, ready ? attrs : `負傷・休養 ${m.injuredDays} 天`, 7, ready ? '#b0bec5' : '#ef9a9a').setOrigin(1, 0));
    if (!ready) return;
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      AudioManager.ui('tap');
      if (on) this.squad = this.squad.filter((id) => id !== m.id);
      else if (this.squad.length < EXPLORE_TIME.maxSquad) this.squad.push(m.id);
      this.refresh();
    });
  }

  // ── 動作 ──

  /** 沿路線移動到相鄰地點 */
  private move(n: RouteNode, hours: number): void {
    AudioManager.ui('confirm');
    GameState.travel(n.id, hours);
    GameState.save();
    this.scene.restart();
  }

  /** 走過去（如果不在那裡）並搜刮這一區：時數先扣，打完回到路線圖 */
  private explore(n: RouteNode, hours: number): void {
    AudioManager.ui('confirm');
    const z = getZone(n.zone!)!;
    GameState.travel(n.id, hours + exploreHours(z));
    const squad = GameState.data.crew.filter((c) => this.squad.includes(c.id));
    Expedition.start(z, squad);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Expedition'));
  }

  /** 在這個據點過夜：換據點就拆舊建築退一半廢料，然後進入據點的白天布置 → 入夜 */
  private settle(n: RouteNode): void {
    AudioManager.ui('confirm');
    const refund = GameState.settleAt(n.id);
    GameState.data.dayTime = 0;
    GameState.save();
    const d: DefenseSceneData = refund > 0 ? { refund } : {};
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Defense', d));
  }

  /** 天黑了：只能退回最後經過的據點（今天還沒經過據點就去最近的一個） */
  private nightfall(): void {
    const r = this.route;
    const to = getNode(r.lastOutpost) ?? nearestOutpost(r.node);
    if (!to) return;
    const w = 340;
    const x = (GAME_WIDTH - w) / 2;
    const y = 120;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0).setDepth(200).setInteractive();
    const panel = uiPanel(this, x, y, w, 110, 0xef6c3a).setDepth(201);
    void panel;
    pixelText(this, GAME_WIDTH / 2, y + 14, '天黑了', 12, '#ff8a65').setOrigin(0.5, 0).setDepth(202);
    pixelText(this, GAME_WIDTH / 2, y + 40, `來不及再找地方。你們退回「${to.name}」守夜。`, 8, '#e0e0e0').setOrigin(0.5, 0).setDepth(202);
    for (const o of uiButton(this, GAME_WIDTH / 2 - 70, y + 72, 140, 26, '守住今晚 ▶', () => this.settle(to), { fill: 0x7a2a22, size: 9 })) {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(203);
    }
  }
}
