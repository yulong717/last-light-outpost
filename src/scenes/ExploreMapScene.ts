import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { ensureCrewTexture } from '../art/CrewArt';
import { ensureCityMap, ensureZoneIcons, ZONE_ICON_KEY, zoneIconFrame } from '../art/MapArt';
import { COMPANION_ROLES, crewReady, type CrewMember } from '../data/companions';
import { EXPLORE_TIME, INTEL, SUPPLIES, ZONES, type SupplyId, type ZoneDef } from '../data/explore';
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
  /** 一定要出發（序章剛結束、無處可回）：沒有「返回據點」 */
  forced?: boolean;
}

/**
 * 城市地圖：選一個區域、挑同行隊員，然後出發。
 * 近區花 1 個時段、遠區 2 個；每區一天只能去一次。
 */
export class ExploreMapScene extends Phaser.Scene {
  private selected: ZoneDef | null = null;
  private squad: string[] = [];
  private panel!: Phaser.GameObjects.Container;
  private markers = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super('ExploreMap');
  }

  private forced = false;

  create(data: ExploreMapData = {}): void {
    this.forced = !!data.forced;
    this.selected = null;
    this.squad = [];
    this.markers.clear();
    AudioManager.setMood('menu');
    const st = GameState.data;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x111318).setOrigin(0);
    this.drawMap();

    // 上方資訊列
    uiTopBar(this, 26);
    pixelText(this, 8, 6, `第 ${st.day} 天・白天　城市地圖`, 9, '#f5d76e');
    const slots = '●'.repeat(st.dayTime) + '○'.repeat(Math.max(0, EXPLORE_TIME.slotsPerDay - st.dayTime));
    pixelText(this, 190, 6, `剩餘時段 ${slots}`, 9, st.dayTime > 0 ? '#e8e8e8' : '#ff8a80');
    pixelText(this, 340, 7, this.suppliesLine(), 8, '#b0bec5');
    if (this.forced) {
      // 剛逃出學校：沒有據點可回，一定要選個方向出發
      const t = pixelText(this, MAP_X + MAP_W / 2, MAP_Y + 8, '學校回不去了：選一個方向出發', 9, '#ffb74d').setOrigin(0.5, 0).setDepth(50);
      this.add.rectangle(t.x, t.y + t.height / 2, t.width + 16, t.height + 6, 0x000000, 0.7).setStrokeStyle(1, 0xffb74d, 0.6).setDepth(49);
    } else {
      uiButton(this, GAME_WIDTH - 92, 2, 88, 22, '◀ 返回據點', () => this.back(), { fill: 0x3a3f4a });
      this.input.keyboard?.once('keydown-ESC', () => this.back());
    }

    this.panel = this.add.container(0, 0).setDepth(100);
    this.refresh();
  }

  private suppliesLine(): string {
    const s = GameState.data.supplies;
    return (Object.keys(SUPPLIES) as SupplyId[]).map((id) => `${SUPPLIES[id].name}${s[id]}`).join(' ');
  }

  private back(): void {
    AudioManager.ui('back');
    const d: DefenseSceneData = {};
    this.scene.start('Defense', d);
  }

  private toMap(z: ZoneDef): { x: number; y: number } {
    return { x: MAP_X + 24 + (z.mapX / 600) * (MAP_W - 48), y: MAP_Y + 10 + ((z.mapY - 90) / 190) * (MAP_H - 50) };
  }

  /** 手繪風的城市：街區、道路、霧，據點在左下 */
  private drawMap(): void {
    // 俯視的像素城市（街區屋頂、公園、河、霧），見 src/art/MapArt.ts
    this.add.image(MAP_X, MAP_Y, ensureCityMap(this, MAP_W, MAP_H)).setOrigin(0);
    ensureZoneIcons(this);
    const g = this.add.graphics();
    // 主要路線：從據點連到每一區（深色外框＋路面＋虛線，開放的區域路線較亮）
    const base = { x: MAP_X + 26, y: MAP_Y + MAP_H - 26 };
    const routes = ZONES.map((z) => {
      const p = this.toMap(z);
      return { open: GameState.zoneOpen(z.id), pts: [base, { x: p.x, y: base.y - (base.y - p.y) * 0.3 }, p] };
    });
    for (const [width, color, alpha] of [
      [7, 0x0a0b0e, 0.9],
      [4, 0x55504a, 1],
    ] as const) {
      for (const r of routes) {
        g.lineStyle(width, r.open || width === 7 ? color : 0x2e3036, alpha);
        g.beginPath();
        g.moveTo(r.pts[0].x, r.pts[0].y);
        for (const q of r.pts.slice(1)) g.lineTo(q.x, q.y);
        g.strokePath();
      }
    }
    for (const r of routes.filter((x) => x.open)) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 4; d < len - 2; d += 8) {
          const t = d / len;
          g.fillStyle(0xf5d76e, 0.55).fillRect(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t), 2, 2);
        }
      }
    }
    g.lineStyle(1, 0xf5d76e, 0.4).strokeRect(MAP_X, MAP_Y, MAP_W, MAP_H);
    // 據點：圍牆＋燈光
    this.add.circle(base.x, base.y, 22, 0xf5d76e, 0.08);
    this.add.circle(base.x, base.y, 13, 0xf5d76e, 0.1);
    this.add.rectangle(base.x, base.y, 16, 16, 0x2e4a2a).setStrokeStyle(2, 0x9ad17a, 0.95);
    this.add.rectangle(base.x, base.y, 6, 6, 0xf5d76e);
    pixelText(this, base.x + 12, base.y - 4, '據點', 8, '#9ad17a');

    const st = GameState.data;
    for (const z of ZONES) {
      const p = this.toMap(z);
      const locked = !GameState.zoneOpen(z.id);
      const done = st.exploredToday.includes(z.id);
      const c = this.add.container(p.x, p.y);
      const r = z.time === 2 ? 11 : 9;
      const dot = this.add.circle(0, 0, r, locked ? 0x3a3d44 : z.color, done ? 0.35 : 0.95).setStrokeStyle(2, locked ? 0x000000 : 0xffffff, locked ? 0.8 : 0.7);
      const ring = this.add.circle(0, 0, r + 4).setStrokeStyle(2, 0xffffff, 0.9).setVisible(false);
      const name = pixelText(this, 0, r + 4, z.name, 8, locked ? '#6b7280' : done ? '#8a8f99' : '#ffffff').setOrigin(0.5, 0);
      const sub = pixelText(this, 0, r + 17, locked ? '主線推進後開放' : done ? '今天已去過' : stars(z.risk), 7, locked ? '#6b7280' : '#ff8a6a').setOrigin(0.5, 0);
      const nameBg = this.add.rectangle(0, r + 4, Math.max(40, z.name.length * 9 + 8), 26, 0x000000, 0.55).setOrigin(0.5, 0);
      c.add([nameBg, ring, dot, name, sub]);
      const icon = zoneIconFrame(z.id);
      if (icon >= 0) c.add(this.add.image(0, 0, ZONE_ICON_KEY, icon).setAlpha(locked ? 0.45 : done ? 0.6 : 1));
      if (st.intel?.zone === z.id && !locked) {
        const bang = pixelText(this, r + 2, -r - 10, '!', 12, '#ffd24a');
        c.add(bang);
        this.tweens.add({ targets: bang, y: bang.y - 3, duration: 500, yoyo: true, repeat: -1 });
      }
      // 主線劇情的地點：金色旗子
      if (GameState.isStoryZone(z.id) && !done) {
        const flag = pixelText(this, -r - 4, -r - 14, '★主線', 8, '#f5d76e').setOrigin(1, 0);
        c.add(flag);
        this.tweens.add({ targets: flag, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
      }
      c.setData('ring', ring);
      dot.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
        AudioManager.ui('tap');
        this.selected = z;
        this.refresh();
      });
      this.markers.set(z.id, c);
    }
  }

  private refresh(): void {
    this.panel.removeAll(true);
    for (const [id, c] of this.markers) (c.getData('ring') as Phaser.GameObjects.Arc).setVisible(this.selected?.id === id);
    const add = (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => this.panel.add(o);
    const st = GameState.data;
    const y0 = MAP_Y;
    add(uiPanel(this, PANEL_X, y0, PANEL_W, MAP_H));
    const z = this.selected;
    if (!z) {
      add(pixelText(this, PANEL_X + 10, y0 + 10, '選一個區域出發搜刮', 9, '#f5d76e'));
      const lines = [
        '近的區域花 1 個時段，遠的花 2 個。',
        '沒用完的時段，入夜時換成免費修路障',
        '和少量廢料。',
        '',
        '每走一站會遇到隨機事件：QTE、',
        '無聲潛入或條件戰鬥。噪音越高越危險，',
        '隨時可以撤退，帶著背包回家。',
        '主角倒下的話，這趟搜到的全部丟失。',
      ];
      lines.forEach((l, i) => add(pixelText(this, PANEL_X + 10, y0 + 32 + i * 15, l, 8, '#c8c8c8')));
      const ch = GameState.chapter;
      if (ch) {
        const zn = ZONES.find((q) => q.id === ch.zone)?.name ?? '';
        add(pixelText(this, PANEL_X + 10, y0 + 216, `主線　${ch.title}`, 8, '#f5d76e'));
        const when = GameState.chapterReady() ? `到「${zn}」走完全程：${ch.objective}` : `第 ${ch.minDay} 天開始。先四處搜刮、壯大隊伍。`;
        add(pixelText(this, PANEL_X + 10, y0 + 230, when, 7, '#e0d4a0').setWordWrapWidth(PANEL_W - 20, true));
      }
      if (st.intel) {
        const iz = ZONES.find((q) => q.id === st.intel!.zone);
        const info = INTEL[st.intel.kind];
        add(pixelText(this, PANEL_X + 10, y0 + 170, `今日情報：${iz?.name ?? ''}`, 8, '#ffd24a'));
        add(pixelText(this, PANEL_X + 10, y0 + 184, `${info.name}　${info.desc}`, 7, '#e0c070').setWordWrapWidth(PANEL_W - 20, true));
      }
      return;
    }

    const locked = !GameState.zoneOpen(z.id);
    const done = st.exploredToday.includes(z.id);
    add(pixelText(this, PANEL_X + 10, y0 + 8, z.name, 10, '#f5d76e'));
    add(pixelText(this, PANEL_X + PANEL_W - 10, y0 + 10, z.time === 2 ? '遠・2 時段' : '近・1 時段', 8, '#c8c8c8').setOrigin(1, 0));
    add(pixelText(this, PANEL_X + 10, y0 + 26, z.blurb, 8, '#c8c8c8').setWordWrapWidth(PANEL_W - 20, true));
    add(pixelText(this, PANEL_X + 10, y0 + 62, `風險 ${stars(z.risk)}`, 8, '#ff8a6a'));
    add(pixelText(this, PANEL_X + 110, y0 + 62, `${z.nodes} 個地點`, 8, '#c8c8c8'));
    add(pixelText(this, PANEL_X + 10, y0 + 76, `可能找到：${z.tags.join('、')}`, 8, '#9ad17a'));
    let y = y0 + 92;
    if (GameState.isStoryZone(z.id)) {
      const ch = GameState.chapter!;
      add(pixelText(this, PANEL_X + 10, y, `★主線　${ch.title}`, 8, '#f5d76e'));
      add(pixelText(this, PANEL_X + 10, y + 13, `最後一站：${ch.objective}`, 7, '#e0d4a0').setWordWrapWidth(PANEL_W - 20, true));
      y += 30;
    }
    if (st.intel?.zone === z.id) {
      const info = INTEL[st.intel.kind];
      add(pixelText(this, PANEL_X + 10, y, `情報：${info.name}`, 8, '#ffd24a'));
      add(pixelText(this, PANEL_X + 10, y + 13, info.desc, 7, '#e0c070').setWordWrapWidth(PANEL_W - 20, true));
      y += 30;
    }

    // 同行隊員
    add(pixelText(this, PANEL_X + 10, y, `同行隊員（最多 ${EXPLORE_TIME.maxSquad} 位）`, 8, '#f5d76e'));
    y += 14;
    const crew = st.crew;
    if (crew.length === 0) add(pixelText(this, PANEL_X + 10, y, '沒有隊員，只能獨自出發。', 8, '#90a4ae'));
    crew.slice(0, 6).forEach((m, i) => this.crewRow(m, PANEL_X + 8, y + i * 22));
    y += Math.min(6, crew.length) * 22 + 4;

    const reason = locked ? '主線推進後開放' : done ? '今天已經去過' : st.dayTime < z.time ? '時段不夠' : '';
    add(
      uiButton(this, PANEL_X + 8, y0 + MAP_H - 34, PANEL_W - 16, 26, reason || `出發 ▶`, () => this.depart(z), {
        enabled: !reason,
        fill: 0x7a2a22,
        size: 9,
      }),
    );
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
    const attrs = `腳${m.attrs.agi} 手${m.attrs.hand} 膽${m.attrs.nerve}`;
    this.panel.add(pixelText(this, x + 90, y + 4, COMPANION_ROLES[m.role].title, 8, ready ? '#c8c8c8' : '#6b7280'));
    this.panel.add(pixelText(this, x + w - 6, y + 4, ready ? attrs : `負傷・休養 ${m.injuredDays} 天`, 7, ready ? '#b0bec5' : '#ef9a9a').setOrigin(1, 0));
    if (!ready) return;
    bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => {
      AudioManager.ui('tap');
      if (on) this.squad = this.squad.filter((id) => id !== m.id);
      else if (this.squad.length < EXPLORE_TIME.maxSquad) this.squad.push(m.id);
      this.refresh();
    });
  }

  private depart(z: ZoneDef): void {
    AudioManager.ui('confirm');
    const squad = GameState.data.crew.filter((c) => this.squad.includes(c.id));
    Expedition.start(z, squad);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Expedition'));
  }
}
