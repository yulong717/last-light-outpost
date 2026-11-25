import Phaser from 'phaser';
import { GROUND_Y, LANE_BOTTOM, LANE_TOP, floorLevels, floorOf } from '../config';
import { BUILDINGS, activeSlots, type BuildingKind } from '../data/buildings';
import { Fx } from '../fx/Fx';
import { isPointerOverUI } from '../input/InputManager';
import type { Outpost } from './Outpost';

/** barricade 的 side：-1 = 第二道路障（雙面據點的左側、多樓層據點的 2F），不填 = 主路障 */
export type Selection = { type: 'slot'; id: string } | { type: 'barricade'; side?: -1 } | { type: 'wall' } | null;

export interface BuildGeometry {
  /** 主路障的 x */
  barricadeX: number;
  /** 據點外牆右緣的 x */
  baseX: number;
  /** 雙面據點：左側路障的 x、小店的範圍（中心與半寬） */
  dual?: { barricadeXL: number; center: number; half: number };
  /** 多樓層據點：第二道路障在第幾層（主路障在 1F）；-1 = 沒有第二道 */
  floors?: { second: number; secondX: number };
  /** 點到槽位以外的東西（雙面據點點隊員換邊、多樓層據點換樓層）：回傳 true 代表這一下已經處理掉 */
  pickExtra?: (x: number, y: number) => boolean;
}

/**
 * 白天的布置模式（戰場這一側）：畫出槽位標記、處理點選、記住目前選的東西。
 * 面板與按鈕在 BuildUIScene，透過 events 的 'changed' 同步。
 *
 * 電腦：滑鼠移過槽位會亮起，左鍵選取，右鍵或 Esc 取消。
 * 手機：點一下選取，點空地取消；所有點擊範圍至少 32px。
 */
export class BuildMode {
  selection: Selection = null;
  readonly events = new Phaser.Events.EventEmitter();
  private active = false;
  private gfx: Phaser.GameObjects.Graphics;
  private hover: Selection = null;
  private esc?: Phaser.Input.Keyboard.Key;
  private pulse = 0;

  constructor(private scene: Phaser.Scene, readonly outpost: Outpost, private geom: BuildGeometry) {
    this.gfx = scene.add.graphics().setDepth(8);
    this.esc = scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.off('pointerdown', this.onDown, this);
      scene.input.off('pointermove', this.onMove, this);
      this.events.removeAllListeners();
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    this.active = true;
    this.gfx.setVisible(true);
    this.select(null);
  }

  exit(): void {
    this.select(null);
    this.active = false;
    this.hover = null;
    this.scene.input.setDefaultCursor('default');
    this.gfx.clear().setVisible(false);
  }

  select(sel: Selection): void {
    this.setHighlight(this.selection, false);
    this.selection = sel;
    this.setHighlight(sel, true);
    this.events.emit('changed');
  }

  // ───────────── 面板按鈕呼叫的動作 ─────────────

  build(kind: BuildingKind): void {
    const sel = this.selection;
    if (sel?.type !== 'slot') return;
    this.result(this.outpost.build(sel.id, kind), `-${BUILDINGS[kind].cost}`);
    this.setHighlight(sel, true);
  }

  upgrade(): void {
    const sel = this.selection;
    if (sel?.type === 'slot') {
      const q = this.outpost.upgradeQuote(sel.id);
      this.result(this.outpost.upgrade(sel.id), `-${q.cost}`);
    } else if (sel?.type === 'barricade') {
      const q = this.outpost.barricadeUpgradeQuote();
      // 兩道路障共用等級；強化完兩道都亮一下
      this.setHighlight(sel, true);
      this.result(this.outpost.upgradeBarricade(), `-${q.cost}`);
    }
  }

  repair(): void {
    const sel = this.selection;
    const before = this.outpost.scrap;
    let ok = false;
    if (sel?.type === 'slot') ok = this.outpost.repair(sel.id);
    else if (sel?.type === 'barricade') ok = this.outpost.repairBarricade(sel.side ?? 1);
    else if (sel?.type === 'wall') ok = this.outpost.repairWall();
    this.result(ok, `-${before - this.outpost.scrap}`);
  }

  demolish(): void {
    const sel = this.selection;
    if (sel?.type !== 'slot') return;
    const refund = this.outpost.refund(sel.id);
    this.result(this.outpost.demolish(sel.id), `+${refund}`);
  }

  // ───────────── 每幀 ─────────────

  update(dt: number): void {
    if (!this.active) return;
    if (this.esc && Phaser.Input.Keyboard.JustDown(this.esc)) this.select(null);
    this.pulse += dt;
    this.draw();
  }

  private draw(): void {
    const g = this.gfx.clear();
    const a = 0.45 + Math.sin(this.pulse * 5) * 0.15;
    for (const s of activeSlots()) {
      const selected = this.selection?.type === 'slot' && this.selection.id === s.id;
      const hovered = this.hover?.type === 'slot' && this.hover.id === s.id;
      const built = this.outpost.buildings.has(s.id);
      const color = selected ? 0xffd24a : built ? 0x9ad17a : 0xffffff;
      const alpha = selected ? 0.95 : hovered ? 0.8 : built ? 0.25 : a;
      // 地上的橢圓框：空槽位畫虛線角，看起來像「可以蓋這裡」
      g.lineStyle(1, color, alpha).strokeEllipse(s.x, s.y, 36, 12);
      if (built) {
        // 等級：槽位右下角幾個小方塊
        const lv = this.outpost.buildings.get(s.id)!.level;
        for (let i = 0; i < lv; i++) g.fillStyle(0xf5d76e, 0.9).fillRect(s.x + 12 + i * 4, s.y + 4, 3, 3);
      } else {
        g.fillStyle(color, alpha * 0.25).fillEllipse(s.x, s.y, 36, 12);
        // 加號
        g.fillStyle(color, alpha).fillRect(s.x - 3, s.y - 1, 7, 1).fillRect(s.x, s.y - 4, 1, 7);
      }
    }
    // 選取的建築有範圍的話畫出來
    const sel = this.selection;
    if (sel?.type === 'slot') {
      const b = this.outpost.buildings.get(sel.id);
      if (b?.kind === 'lamp') {
        const r = b.lampRadius;
        g.lineStyle(1, 0xffd27a, 0.6).strokeEllipse(b.slot.x, b.slot.y, r * 2, (r * 2) / 1.6);
      } else if (b?.kind === 'turret') {
        // 多樓層：只畫那一層的範圍（砲塔還是會打別層，只是優先同一層）
        const [y0, y1] = floorLevels() ? [b.slot.y - 50, b.slot.y + 6] : [LANE_TOP, LANE_BOTTOM];
        g.fillStyle(0xff8a80, 0.08).fillRect(b.slot.x, y0, b.turretRange, y1 - y0);
        g.lineStyle(1, 0xff8a80, 0.5).strokeRect(b.slot.x, y0, b.turretRange, y1 - y0);
      }
    }
    if (this.hover?.type === 'wall' || sel?.type === 'wall') {
      const d = this.geom.dual;
      const col = sel?.type === 'wall' ? 0xffd24a : 0xffffff;
      const lv = floorLevels();
      if (d) g.lineStyle(1, col, 0.7).strokeRect(d.center - d.half, GROUND_Y - 130, d.half * 2, 130);
      else if (lv) g.lineStyle(1, col, 0.7).strokeRect(1, Math.min(...lv) - 70, this.geom.baseX + 4, 360 - Math.min(...lv) + 69);
      else g.lineStyle(1, col, 0.7).strokeRect(1, GROUND_Y - 83, this.geom.baseX + 4, 360 - GROUND_Y + 82);
    }
  }

  // ───────────── 點選 ─────────────

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active || p.wasTouch) return;
    const next = isPointerOverUI(p) ? null : this.pick(p);
    if (JSON.stringify(next) === JSON.stringify(this.hover)) return;
    if (this.hover?.type === 'barricade' && !this.sameSel(this.hover, this.selection)) this.outpost.barricadeOf(this.hover.side ?? 1).setHighlight(false);
    this.hover = next;
    if (next?.type === 'barricade') this.outpost.barricadeOf(next.side ?? 1).setHighlight(true);
    this.scene.input.setDefaultCursor(next ? 'pointer' : 'default');
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.active || isPointerOverUI(p)) return;
    if (p.rightButtonDown()) {
      this.select(null);
      return;
    }
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    if (this.geom.pickExtra?.(w.x, w.y)) return;
    this.select(this.pick(p));
  }

  private pick(p: Phaser.Input.Pointer): Selection {
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    // 槽位：以腳底為準，往上涵蓋建築本身（照明燈比較高）
    let best: Selection = null;
    let bestD = Infinity;
    for (const s of activeSlots()) {
      const dx = Math.abs(w.x - s.x);
      if (dx > 20 || w.y > s.y + 10 || w.y < s.y - 40) continue;
      const d = dx + Math.abs(w.y - (s.y - 6)) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = { type: 'slot', id: s.id };
      }
    }
    if (best) return best;
    const fl = this.geom.floors;
    if (fl) {
      // 多樓層：點到哪一層的路障（往上涵蓋路障本身的高度）
      const f = floorOf(w.y + 24);
      if (f === 0 && Math.abs(w.x - this.geom.barricadeX) <= 18) return { type: 'barricade' };
      if (f === fl.second && Math.abs(w.x - fl.secondX) <= 18) return { type: 'barricade', side: -1 };
      const top = Math.min(...(floorLevels() ?? [GROUND_Y]));
      if (w.x <= this.geom.baseX + 6 && w.y >= top - 70) return { type: 'wall' };
      return null;
    }
    const inBand = w.y >= LANE_TOP - 60 && w.y <= LANE_BOTTOM + 10;
    if (Math.abs(w.x - this.geom.barricadeX) <= 18 && inBand) return { type: 'barricade' };
    const d = this.geom.dual;
    if (d) {
      if (Math.abs(w.x - d.barricadeXL) <= 18 && inBand) return { type: 'barricade', side: -1 };
      // 小店：點店面（地平線上方）
      if (Math.abs(w.x - d.center) <= d.half && w.y >= GROUND_Y - 130 && w.y < GROUND_Y + 4) return { type: 'wall' };
      return null;
    }
    if (w.x <= this.geom.baseX + 6 && w.y >= GROUND_Y - 84) return { type: 'wall' };
    return null;
  }

  private setHighlight(sel: Selection, on: boolean): void {
    if (sel?.type === 'slot') this.outpost.buildings.get(sel.id)?.setHighlight(on);
    else if (sel?.type === 'barricade') this.outpost.barricadeOf(sel.side ?? 1).setHighlight(on);
  }

  private sameSel(a: Selection, b: Selection): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** 操作結果：成功跳出花費字樣，失敗（多半是廢料不足）跳紅字 */
  private result(ok: boolean, text: string): void {
    const pos = this.anchor();
    const fx = Fx.of(this.scene);
    if (ok) fx?.popText(pos.x, pos.y, `${text} 廢料`, '#f5d76e');
    else fx?.popText(pos.x, pos.y, '廢料不足', '#ff6b6b');
    this.events.emit('changed');
  }

  private anchor(): { x: number; y: number } {
    const sel = this.selection;
    if (sel?.type === 'slot') {
      const s = activeSlots().find((x) => x.id === sel.id)!;
      return { x: s.x, y: s.y - 40 };
    }
    if (sel?.type === 'barricade') {
      const fy = this.outpost.barricadeOf(sel.side ?? 1).floorY;
      const x = sel.side && this.geom.dual ? this.geom.dual.barricadeXL : sel.side && this.geom.floors ? this.geom.floors.secondX : this.geom.barricadeX;
      return { x, y: fy !== undefined ? fy - 66 : LANE_TOP - 50 };
    }
    if (this.geom.dual) return { x: this.geom.dual.center, y: GROUND_Y - 60 };
    return { x: this.geom.baseX / 2 + 4, y: GROUND_Y - 60 };
  }
}
