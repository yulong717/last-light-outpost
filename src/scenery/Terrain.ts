import Phaser from 'phaser';
import { LANE_BOTTOM, LANE_TOP, clampLaneY, depthForY } from '../config';
import { tone } from '../art/Painter';
import type { PropSystem } from './PropSystem';

/**
 * 據點地形：每個守城據點有自己的地形，讓每一夜打起來不一樣。
 *
 * - block：立體障礙物（圍牆、倒塌的騎樓、花台、貨櫃）。擋住所有人，霧屍會沿著邊緣繞過去，
 *   拿來做出之字形路線、窄口。腳底範圍是 x0..x1 × y0..y1，往上畫 height 高。
 * - mud／water／sand：減速地面（霧屍與主角都會變慢，主角只受一半影響）。
 * - oil：油漬。稍微減速；被爆炸或火碰到會整片燒起來（一夜一次）。
 *
 * 單軸據點只放地面效果，不放 block（整條路會被堵死）。
 */
export type TerrainKind = 'block' | 'mud' | 'water' | 'sand' | 'oil';
export type BlockStyle = 'brick' | 'rubble' | 'concrete' | 'planter' | 'container';

export interface TerrainDef {
  kind: TerrainKind;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** block：畫多高（px） */
  height?: number;
  style?: BlockStyle;
}

/** 地面的速度倍率（霧屍；主角只吃一半） */
const SLOW: Record<Exclude<TerrainKind, 'block'>, number> = { mud: 0.6, water: 0.72, sand: 0.55, oil: 0.8 };
/** 油漬燒多久 */
const OIL_BURN = 7;
/** 霧屍頂到障礙物時，每幀往旁邊滑多少 */
const SLIDE = 1.4;

interface Block {
  def: TerrainDef;
  gfx: Phaser.GameObjects.Graphics;
}

export class Terrain {
  private blocks: Block[] = [];
  private ground: TerrainDef[] = [];
  private burned = new Set<TerrainDef>();

  constructor(private scene: Phaser.Scene, defs: TerrainDef[]) {
    const g = scene.add.graphics().setDepth(1.6);
    for (const d of defs) {
      if (d.kind === 'block') this.blocks.push({ def: d, gfx: this.drawBlock(d) });
      else {
        this.ground.push(d);
        this.drawGround(g, d);
      }
    }
  }

  get empty(): boolean {
    return this.blocks.length === 0 && this.ground.length === 0;
  }

  /** 霧屍在 (x, y) 的速度倍率 */
  speedMul(x: number, y: number): number {
    let m = 1;
    for (const d of this.ground) if (inside(d, x, y)) m *= SLOW[d.kind as keyof typeof SLOW];
    return m;
  }

  /** 主角的速度倍率：地形只影響一半，不然太難操作 */
  playerMul(x: number, y: number): number {
    return 1 - (1 - this.speedMul(x, y)) * 0.5;
  }

  /**
   * 把人推出立體障礙物。從側面撞到就往近的那一側（上或下）滑，
   * 霧屍（有 laneY）把目標路線改到障礙物外，自己繞過去。
   */
  collide(e: { footX: number; footY: number; laneY?: number }): void {
    for (const { def: d } of this.blocks) {
      const m = 3;
      if (e.footX <= d.x0 - m || e.footX >= d.x1 + m || e.footY <= d.y0 - m || e.footY >= d.y1 + m) continue;
      const pushL = e.footX - (d.x0 - m);
      const pushR = d.x1 + m - e.footX;
      const pushU = e.footY - (d.y0 - m);
      const pushD = d.y1 + m - e.footY;
      // 往下推會超出路面、往上推會超出路面時就不考慮那個方向
      const canU = d.y0 - m > LANE_TOP;
      const canD = d.y1 + m < LANE_BOTTOM;
      const minX = Math.min(pushL, pushR);
      const minY = Math.min(canU ? pushU : Infinity, canD ? pushD : Infinity);
      if (minY <= minX) {
        e.footY = clampLaneY(canU && (pushU <= pushD || !canD) ? d.y0 - m : d.y1 + m);
        continue;
      }
      e.footX = pushL < pushR ? d.x0 - m : d.x1 + m;
      // 頂到正面：往比較近、而且有路的那一側繞
      const goUp = canU && (!canD || pushU < pushD);
      if (!canU && !canD) continue;
      e.footY = clampLaneY(e.footY + (goUp ? -SLIDE : SLIDE));
      if (e.laneY !== undefined) e.laneY = clampLaneY(goUp ? d.y0 - 8 : d.y1 + 8);
    }
  }

  /** 每幀：躲在障礙物後面的人看得到（障礙物變半透明）、油漬碰到火就燒起來 */
  update(who: { footX: number; footY: number }[], props?: PropSystem): void {
    for (const b of this.blocks) {
      const d = b.def;
      const h = d.height ?? 30;
      const hidden = who.some((e) => e.footY < d.y0 && e.footY > d.y0 - h - 30 && e.footX > d.x0 - 8 && e.footX < d.x1 + 8);
      b.gfx.setAlpha(hidden ? 0.5 : 1);
    }
    if (!props) return;
    for (const d of this.ground) {
      if (d.kind !== 'oil' || this.burned.has(d) || !props.fireTouches(d.x0, d.x1, d.y0, d.y1)) continue;
      this.burned.add(d);
      const cx = (d.x0 + d.x1) / 2;
      const r = (d.x1 - d.x0) / 2;
      for (let y = d.y0 + 6; y <= d.y1; y += 16) props.ignite(cx, y, r, OIL_BURN);
    }
  }

  // ───────────── 畫 ─────────────

  private drawGround(g: Phaser.GameObjects.Graphics, d: TerrainDef): void {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    const cx = d.x0 + w / 2;
    const cy = d.y0 + h / 2;
    const rnd = new Phaser.Math.RandomDataGenerator([`${d.kind}${d.x0}${d.y0}`]);
    switch (d.kind) {
      case 'water': {
        g.fillStyle(0x1a2a36, 0.75).fillEllipse(cx, cy, w, h);
        g.fillStyle(0x2a4456, 0.6).fillEllipse(cx - w * 0.05, cy - h * 0.08, w * 0.8, h * 0.6);
        for (let i = 0; i < 6; i++) g.fillStyle(0x8ab0c8, 0.5).fillRect(cx - w * 0.35 + rnd.between(0, w * 0.6), cy - h * 0.3 + rnd.between(0, h * 0.5), rnd.between(6, 14), 1);
        break;
      }
      case 'mud': {
        g.fillStyle(0x3a2a1c, 0.8).fillEllipse(cx, cy, w, h);
        for (let i = 0; i < 18; i++) g.fillStyle(rnd.pick([0x4a3622, 0x2a1e14]), 0.9).fillEllipse(d.x0 + rnd.between(8, w - 8), d.y0 + rnd.between(4, h - 4), rnd.between(4, 10), rnd.between(2, 4));
        break;
      }
      case 'sand': {
        // 沙坑：水泥邊框＋沙
        g.fillStyle(0x8a8a86, 1).fillRect(d.x0 - 3, d.y0 - 2, w + 6, h + 4);
        g.fillStyle(0xc8a868, 1).fillRect(d.x0, d.y0, w, h);
        for (let i = 0; i < 40; i++) g.fillStyle(rnd.pick([0xb89858, 0xd8b878]), 1).fillRect(d.x0 + rnd.between(1, w - 3), d.y0 + rnd.between(1, h - 2), 2, 1);
        break;
      }
      case 'oil': {
        g.fillStyle(0x0c0c10, 0.8).fillEllipse(cx, cy, w, h);
        g.fillStyle(0x1a1a24, 0.9).fillEllipse(cx + w * 0.1, cy - h * 0.1, w * 0.6, h * 0.5);
        // 油膜的彩虹反光
        for (const [c, k] of [[0x6a3ac0, 0.2], [0x2a9a8a, 0.35], [0xc8a030, 0.5]] as const) g.fillStyle(c, 0.35).fillRect(cx - w * 0.3 + w * k, cy - h * 0.15 + h * k * 0.3, w * 0.18, 1);
        break;
      }
    }
  }

  /** 立體方塊：頂面亮、正面暗，依腳底最前緣排深度 */
  private drawBlock(d: TerrainDef): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics().setDepth(depthForY(d.y1));
    const h = d.height ?? 30;
    const w = d.x1 - d.x0;
    const depth = d.y1 - d.y0;
    const rnd = new Phaser.Math.RandomDataGenerator([`blk${d.x0}${d.y0}`]);
    const pal: Record<BlockStyle, { top: number; front: number; line: number }> = {
      brick: { top: 0x9a5a44, front: 0x7a3e2e, line: 0x5a2a1e },
      rubble: { top: 0x8a8680, front: 0x5e5a56, line: 0x3e3a38 },
      concrete: { top: 0xa8a8a2, front: 0x7a7a76, line: 0x5a5a56 },
      planter: { top: 0x4a7a3a, front: 0x8a8a84, line: 0x6a6a66 },
      container: { top: 0x3a6a8a, front: 0x2a5a7a, line: 0x1a3a50 },
    };
    const style = d.style ?? 'concrete';
    const c = pal[style];
    // 地上的影子
    g.fillStyle(0x000000, 0.3).fillRect(d.x0 + 3, d.y0 + 2, w, depth);
    // 頂面（腳底範圍往上 h）
    g.fillStyle(c.top, 1).fillRect(d.x0, d.y0 - h, w, depth);
    g.fillStyle(tone(c.top, 0.2), 1).fillRect(d.x0, d.y0 - h, w, 1);
    // 正面
    g.fillStyle(c.front, 1).fillRect(d.x0, d.y1 - h, w, h);
    g.fillStyle(tone(c.front, -0.25), 1).fillRect(d.x0, d.y1 - 2, w, 2);
    g.fillStyle(tone(c.front, 0.15), 1).fillRect(d.x0, d.y1 - h, w, 1);
    switch (style) {
      case 'brick':
        for (let y = d.y1 - h + 4; y < d.y1; y += 5) {
          g.fillStyle(c.line, 1).fillRect(d.x0, y, w, 1);
          const off = ((y - d.y1) / 5) % 2 ? 0 : 5;
          for (let x = d.x0 + off; x < d.x1; x += 10) g.fillRect(x, y - 4, 1, 4);
        }
        // 牆頂的水泥蓋
        g.fillStyle(0xb8b4ac, 1).fillRect(d.x0 - 1, d.y0 - h - 2, w + 2, 3);
        break;
      case 'rubble':
        // 崩塌的樓板與露出的鋼筋
        for (let i = 0; i < 14; i++) {
          const rx = d.x0 + rnd.between(0, w - 10);
          const ry = d.y0 - h + rnd.between(-6, depth - 2);
          g.fillStyle(rnd.pick([0x9a968e, 0x6e6a64, 0x7e7a72]), 1).fillRect(rx, ry, rnd.between(6, 16), rnd.between(3, 7));
        }
        for (let i = 0; i < 4; i++) g.lineStyle(1, 0x6a3a22, 1).lineBetween(d.x0 + 8 + i * (w / 4), d.y1 - h + 4, d.x0 + 4 + i * (w / 4), d.y1 - h - 10 - i * 3);
        for (let x = d.x0 + 4; x < d.x1 - 4; x += 9) g.fillStyle(c.line, 1).fillRect(x, d.y1 - h + 6 + rnd.between(0, h - 12), 5, 1);
        break;
      case 'concrete':
        for (let x = d.x0 + 12; x < d.x1; x += 24) g.fillStyle(c.line, 1).fillRect(x, d.y1 - h + 2, 1, h - 3);
        g.fillStyle(0xd8b030, 1).fillRect(d.x0, d.y1 - h + 4, w, 2);
        break;
      case 'planter':
        // 花台：水泥盆＋枯掉的灌木
        for (let i = 0; i < 10; i++) g.fillStyle(rnd.pick([0x3a5a2a, 0x5a6a3a, 0x6a5a3a]), 1).fillEllipse(d.x0 + rnd.between(4, w - 4), d.y0 - h + rnd.between(0, depth), rnd.between(6, 12), rnd.between(4, 8));
        break;
      case 'container':
        for (let x = d.x0 + 3; x < d.x1; x += 5) g.fillStyle(c.line, 1).fillRect(x, d.y1 - h + 2, 1, h - 4);
        g.fillStyle(0xc8c8c0, 1).fillRect(d.x0 + w / 2 - 6, d.y1 - h + 8, 12, 5);
        break;
    }
    return g;
  }
}

function inside(d: TerrainDef, x: number, y: number): boolean {
  return x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1;
}
