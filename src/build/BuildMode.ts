import Phaser from 'phaser';
import { GROUND_Y, LANE_BOTTOM, LANE_TOP } from '../config';
import { BUILDINGS, SLOTS, type BuildingKind } from '../data/buildings';
import { Fx } from '../fx/Fx';
import { isOverUI } from '../input/InputManager';
import type { Outpost } from './Outpost';

export type Selection = { type: 'slot'; id: string } | { type: 'barricade' } | { type: 'wall' } | null;

export interface BuildGeometry {
  /** 主路障的 x */
  barricadeX: number;
  /** 據點外牆右緣的 x */
  baseX: number;
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
      this.result(this.outpost.upgradeBarricade(), `-${q.cost}`);
    }
  }

  repair(): void {
    const sel = this.selection;
    const before = this.outpost.scrap;
    let ok = false;
    if (sel?.type === 'slot') ok = this.outpost.repair(sel.id);
    else if (sel?.type === 'barricade') ok = this.outpost.repairBarricade();
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
    for (const s of SLOTS) {
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
        g.fillStyle(0xff8a80, 0.08).fillRect(b.slot.x, LANE_TOP, b.turretRange, LANE_BOTTOM - LANE_TOP);
        g.lineStyle(1, 0xff8a80, 0.5).strokeRect(b.slot.x, LANE_TOP, b.turretRange, LANE_BOTTOM - LANE_TOP);
      }
    }
    if (this.hover?.type === 'wall' || sel?.type === 'wall') {
      g.lineStyle(1, sel?.type === 'wall' ? 0xffd24a : 0xffffff, 0.7).strokeRect(1, GROUND_Y - 83, this.geom.baseX + 4, 360 - GROUND_Y + 82);
    }
  }

  // ───────────── 點選 ─────────────

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.active || p.wasTouch) return;
    const next = isOverUI(p.x, p.y) ? null : this.pick(p);
    if (JSON.stringify(next) === JSON.stringify(this.hover)) return;
    if (this.hover?.type === 'barricade' && this.selection?.type !== 'barricade') this.outpost.barricade.setHighlight(false);
    this.hover = next;
    if (next?.type === 'barricade') this.outpost.barricade.setHighlight(true);
    this.scene.input.setDefaultCursor(next ? 'pointer' : 'default');
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.active || isOverUI(p.x, p.y)) return;
    if (p.rightButtonDown()) {
      this.select(null);
      return;
    }
    this.select(this.pick(p));
  }

  private pick(p: Phaser.Input.Pointer): Selection {
    const w = this.scene.cameras.main.getWorldPoint(p.x, p.y);
    // 槽位：以腳底為準，往上涵蓋建築本身（照明燈比較高）
    let best: Selection = null;
    let bestD = Infinity;
    for (const s of SLOTS) {
      const dx = Math.abs(w.x - s.x);
      if (dx > 20 || w.y > s.y + 10 || w.y < s.y - 40) continue;
      const d = dx + Math.abs(w.y - (s.y - 6)) * 0.5;
      if (d < bestD) {
        bestD = d;
        best = { type: 'slot', id: s.id };
      }
    }
    if (best) return best;
    if (Math.abs(w.x - this.geom.barricadeX) <= 18 && w.y >= LANE_TOP - 60 && w.y <= LANE_BOTTOM + 10) {
      return { type: 'barricade' };
    }
    if (w.x <= this.geom.baseX + 6 && w.y >= GROUND_Y - 84) return { type: 'wall' };
    return null;
  }

  private setHighlight(sel: Selection, on: boolean): void {
    if (sel?.type === 'slot') this.outpost.buildings.get(sel.id)?.setHighlight(on);
    else if (sel?.type === 'barricade') this.outpost.barricade.setHighlight(on);
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
      const s = SLOTS.find((x) => x.id === sel.id)!;
      return { x: s.x, y: s.y - 40 };
    }
    if (sel?.type === 'barricade') return { x: this.geom.barricadeX, y: LANE_TOP - 50 };
    return { x: this.geom.baseX / 2 + 4, y: GROUND_Y - 60 };
  }
}
