import Phaser from 'phaser';
import {
  BARRICADE_HP_PER_SCRAP,
  BARRICADE_LEVELS,
  BASE_HP_PER_SCRAP,
  BUILDINGS,
  ECONOMY,
  LAMP,
  SANDBAG_HALF_H,
  SLOTS,
  SPIKES,
  investedCost,
  type BuildingKind,
  type SlotDef,
} from '../data/buildings';
import { Building } from '../entities/Building';
import type { Barricade } from '../entities/Barricade';
import type { Zombie } from '../entities/Zombie';
import { GameState } from '../state/GameState';

/** 建造／升級／修理的報價；cost 為 0 或 null 代表不能做 */
export interface Quote {
  cost: number;
  /** 不能做的原因（例如已滿級、耐久全滿） */
  blocked?: string;
}

/**
 * 據點：管理所有槽位上的建築、主路障與外牆的修理強化，以及廢料的扣款。
 * 狀態都寫回 GameState，跨夜保留。
 *
 * 夜晚時 DefenseScene 透過 blockerFor / speedMul 把建築效果交給霧屍，
 * 並每幀呼叫 update 讓陷阱和砲塔運作。
 */
export class Outpost {
  readonly buildings = new Map<string, Building>();

  constructor(private scene: Phaser.Scene, readonly barricade: Barricade) {
    const st = GameState.data;
    const lv = Phaser.Math.Clamp(st.barricadeLevel, 1, BARRICADE_LEVELS.length);
    barricade.setHp(st.barricadeHp, BARRICADE_LEVELS[lv - 1].maxHp);
    for (const b of st.buildings) {
      const slot = SLOTS.find((s) => s.id === b.slot);
      if (!slot || !BUILDINGS[b.kind]) continue;
      this.buildings.set(slot.id, new Building(scene, slot, b.kind, b.level, b.hp));
    }
  }

  get scrap(): number {
    return GameState.data.scrap;
  }

  slot(id: string): SlotDef | undefined {
    return SLOTS.find((s) => s.id === id);
  }

  // ───────────── 夜晚：建築效果 ─────────────

  /**
   * 霧屍在 (x, y) 時，前方最近、還站著的沙包牆。
   * minFront：已經有的擋路線（路障或外牆），比它更後面的沙包不用管。
   */
  blockerFor(x: number, y: number, minFront: number): { blockX: number; hit: (d: number, y: number) => void } | null {
    let best: Building | null = null;
    for (const b of this.buildings.values()) {
      if (b.kind !== 'sandbag' || !b.working) continue;
      if (Math.abs(y - b.slot.y) > SANDBAG_HALF_H) continue;
      // 霧屍已經在沙包後面（左邊）就不擋
      if (x < b.frontX - 2 || b.frontX <= minFront) continue;
      if (!best || b.frontX > best.frontX) best = b;
    }
    if (!best) return null;
    const target = best;
    return { blockX: target.frontX, hit: (d, hy) => target.takeDamage(d, hy) };
  }

  speedMul(x: number, y: number): number {
    let mul = 1;
    for (const b of this.buildings.values()) {
      if (!b.working) continue;
      if (b.kind === 'spikes' && b.covers(x, y)) mul *= SPIKES.slow[b.level - 1];
      else if (b.kind === 'lamp' && b.lit(x, y)) mul *= LAMP.slow[b.level - 1];
    }
    return mul;
  }

  /** 回傳這一幀被建築擊殺的數量 */
  update(dt: number, zombies: Zombie[]): number {
    let kills = 0;
    for (const b of this.buildings.values()) kills += b.update(dt, zombies);
    return kills;
  }

  // ───────────── 白天：建造與修理 ─────────────

  buildQuote(slotId: string, kind: BuildingKind): Quote {
    const slot = this.slot(slotId);
    if (!slot || !slot.kinds.includes(kind)) return { cost: 0, blocked: '這裡不能蓋' };
    if (this.buildings.has(slotId)) return { cost: 0, blocked: '已經有建築' };
    return { cost: BUILDINGS[kind].cost };
  }

  upgradeQuote(slotId: string): Quote {
    const b = this.buildings.get(slotId);
    if (!b) return { cost: 0, blocked: '沒有建築' };
    if (b.level >= BUILDINGS[b.kind].maxLevel) return { cost: 0, blocked: '已滿級' };
    return { cost: BUILDINGS[b.kind].cost * b.level };
  }

  repairQuote(slotId: string): Quote {
    const b = this.buildings.get(slotId);
    if (!b || !b.canBreak) return { cost: 0, blocked: '不需要修理' };
    const missing = 1 - b.hp / b.maxHp;
    if (missing <= 0) return { cost: 0, blocked: '耐久全滿' };
    return { cost: Math.max(1, Math.ceil(BUILDINGS[b.kind].cost * ECONOMY.repairRatio * missing)) };
  }

  refund(slotId: string): number {
    const b = this.buildings.get(slotId);
    return b ? Math.floor(investedCost(b.kind, b.level) * ECONOMY.refundRatio) : 0;
  }

  build(slotId: string, kind: BuildingKind): boolean {
    const q = this.buildQuote(slotId, kind);
    if (!this.pay(q)) return false;
    this.buildings.set(slotId, new Building(this.scene, this.slot(slotId)!, kind));
    this.persist();
    return true;
  }

  upgrade(slotId: string): boolean {
    const q = this.upgradeQuote(slotId);
    if (!this.pay(q)) return false;
    const b = this.buildings.get(slotId)!;
    b.setLevel(b.level + 1);
    this.persist();
    return true;
  }

  repair(slotId: string): boolean {
    const q = this.repairQuote(slotId);
    if (!this.pay(q)) return false;
    this.buildings.get(slotId)!.repair();
    this.persist();
    return true;
  }

  demolish(slotId: string): boolean {
    const b = this.buildings.get(slotId);
    if (!b) return false;
    GameState.data.scrap += this.refund(slotId);
    b.destroy();
    this.buildings.delete(slotId);
    this.persist();
    return true;
  }

  // 主路障

  barricadeUpgradeQuote(): Quote {
    const lv = GameState.data.barricadeLevel;
    if (lv >= BARRICADE_LEVELS.length) return { cost: 0, blocked: '已滿級' };
    return { cost: BARRICADE_LEVELS[lv - 1].upgradeCost };
  }

  barricadeRepairQuote(): Quote {
    const missing = this.barricade.maxHp - this.barricade.hp;
    if (missing <= 0) return { cost: 0, blocked: '耐久全滿' };
    return { cost: Math.ceil(missing / BARRICADE_HP_PER_SCRAP) };
  }

  upgradeBarricade(): boolean {
    if (!this.pay(this.barricadeUpgradeQuote())) return false;
    const st = GameState.data;
    st.barricadeLevel += 1;
    const max = BARRICADE_LEVELS[st.barricadeLevel - 1].maxHp;
    // 強化時順便補上多出來的耐久
    this.barricade.setHp(this.barricade.hp + (max - this.barricade.maxHp), max);
    this.persist();
    return true;
  }

  /** 修理主路障；錢不夠時能修多少修多少 */
  repairBarricade(): boolean {
    const q = this.barricadeRepairQuote();
    if (q.blocked || this.scrap <= 0) return false;
    const spend = Math.min(q.cost, this.scrap);
    GameState.data.scrap -= spend;
    this.barricade.setHp(this.barricade.hp + spend * BARRICADE_HP_PER_SCRAP);
    this.persist();
    return true;
  }

  // 據點外牆

  wallRepairQuote(): Quote {
    const st = GameState.data;
    const missing = st.baseMaxHp - st.baseHp;
    if (missing <= 0) return { cost: 0, blocked: '耐久全滿' };
    return { cost: Math.ceil(missing / BASE_HP_PER_SCRAP) };
  }

  repairWall(): boolean {
    const q = this.wallRepairQuote();
    if (q.blocked || this.scrap <= 0) return false;
    const st = GameState.data;
    const spend = Math.min(q.cost, this.scrap);
    st.scrap -= spend;
    st.baseHp = Math.min(st.baseMaxHp, st.baseHp + spend * BASE_HP_PER_SCRAP);
    this.persist();
    return true;
  }

  // ───────────── 存檔 ─────────────

  /** 把建築與路障的現況寫回 GameState（夜晚結束、每次白天操作後呼叫） */
  persist(): void {
    const st = GameState.data;
    st.barricadeHp = this.barricade.hp;
    st.barricadeMaxHp = this.barricade.maxHp;
    st.buildings = [...this.buildings.values()].map((b) => ({
      slot: b.slot.id,
      kind: b.kind,
      level: b.level,
      hp: b.hp,
    }));
  }

  private pay(q: Quote): boolean {
    if (q.blocked || q.cost <= 0 || this.scrap < q.cost) return false;
    GameState.data.scrap -= q.cost;
    return true;
  }
}
