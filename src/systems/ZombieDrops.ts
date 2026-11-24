import Phaser from 'phaser';
import { depthForY } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { DROP_TUNING, ZOMBIE_DROPS, type DropEntry, type DropIcon } from '../data/drops';
import type { Loot } from '../data/explore';
import type { Zombie } from '../entities/Zombie';
import { describeLoot } from '../explore/Expedition';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';

/**
 * 職業霧屍的掉落物（夜晚防守）。數值在 src/data/drops.ts。
 *
 *   const drops = new ZombieDrops(scene, { heal, repair });
 *   drops.onZombieDown(z);           // 霧屍倒下那一幀呼叫一次
 *   drops.update(dt, px, py);        // 每幀；主角靠近就吸過去
 *   drops.collectAll(px, py);        // 撐過一夜：地上剩的自動收回
 */
export interface DropHost {
  /** 回血，回傳實際補了多少 */
  heal: (amount: number) => number;
  /** 修路障，回傳實際修了多少 */
  repair: (amount: number) => number;
}

interface GroundDrop {
  entry: DropEntry;
  img: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Ellipse;
  x: number;
  y: number;
  t: number;
  flying: boolean;
}

/** 7×7 的小像素圖：每個字元一格，'.' 透明 */
const ICONS: Record<DropIcon, { rows: string[]; colors: Record<string, number> }> = {
  ammo: {
    rows: ['.y.y.y.', '.y.y.y.', 'ooooooo', 'oKKKKKo', 'oKKKKKo', 'ooooooo', '.......'],
    colors: { y: 0xf5d76e, o: 0x6b5a2a, K: 0x8a7a3a },
  },
  shells: {
    rows: ['.r.r.r.', '.r.r.r.', '.r.r.r.', '.y.y.y.', 'ooooooo', 'oKKKKKo', 'ooooooo'],
    colors: { r: 0xd84a3a, y: 0xe0b040, o: 0x5a4a2a, K: 0x7a6a3a },
  },
  rifle: {
    rows: ['..y.y..', '..y.y..', '..y.y..', 'ggggggg', 'gGGGGGg', 'gGGGGGg', 'ggggggg'],
    colors: { y: 0xe8c860, g: 0x3a4a2a, G: 0x5a6a3a },
  },
  med: {
    rows: ['wwwwwww', 'wwwrwww', 'wwwrwww', 'wrrrrrw', 'wwwrwww', 'wwwrwww', 'wwwwwww'],
    colors: { w: 0xeeeeee, r: 0xd83a3a },
  },
  heal: {
    rows: ['.......', '..ggg..', '..ggg..', 'ggggggg', '..ggg..', '..ggg..', '.......'],
    colors: { g: 0x7ee08a },
  },
  tool: {
    rows: ['ssss...', 'ssss...', '..bb...', '..bb...', '..bb...', '..bb...', '..bb...'],
    colors: { s: 0xb0b8c0, b: 0x9a6a3a },
  },
  pick: {
    rows: ['.....s.', '....s..', '...s...', '..s....', '.yy....', 'yyy....', '.y.....'],
    colors: { s: 0xc8d0d8, y: 0xd0a040 },
  },
  gun: {
    rows: ['.......', 'kkkkkkk', 'kkkkkkk', 'kkk....', 'kk.....', 'kk.....', '.......'],
    colors: { k: 0x2a2a2a },
  },
  scrap: {
    rows: ['..s.s..', '.sssss.', 'ssdddss', '.sd.ds.', 'ssdddss', '.sssss.', '..s.s..'],
    colors: { s: 0xa8a090, d: 0x6a6458 },
  },
};

function iconKey(icon: DropIcon): string {
  return `drop_${icon}`;
}

/** 第一次用到時把圖示畫成貼圖（外圍描一圈黑邊，暗處也看得到） */
function ensureIcon(scene: Phaser.Scene, icon: DropIcon): string {
  const key = iconKey(icon);
  if (scene.textures.exists(key)) return key;
  const { rows, colors } = ICONS[icon];
  const n = rows.length;
  const tex = scene.textures.createCanvas(key, n + 2, n + 2);
  if (!tex) return key;
  const ctx = tex.getContext();
  const at = (x: number, y: number) => (y >= 0 && y < n && x >= 0 && x < n ? rows[y][x] : '.');
  for (let y = -1; y <= n; y++) {
    for (let x = -1; x <= n; x++) {
      const c = at(x, y);
      if (c !== '.') {
        ctx.fillStyle = `#${colors[c].toString(16).padStart(6, '0')}`;
      } else if (at(x - 1, y) !== '.' || at(x + 1, y) !== '.' || at(x, y - 1) !== '.' || at(x, y + 1) !== '.') {
        ctx.fillStyle = '#111111';
      } else continue;
      ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  tex.refresh();
  return key;
}

/** 依掉落表抽一項；武器已擁有就排除，全排除就不掉 */
export function rollDrop(professionId: string, mutations: number, rng = Math.random): DropEntry | null {
  const table = ZOMBIE_DROPS[professionId];
  if (!table) return null;
  if (rng() >= table.chance + mutations * DROP_TUNING.mutationBonus) return null;
  const pool = table.entries.filter((e) => !(e.loot?.weapons ?? []).some((id) => GameState.owns(id)));
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1] ?? null;
}

export class ZombieDrops {
  private drops: GroundDrop[] = [];
  /** 這一夜撿到的東西（結算畫面可以用） */
  readonly picked: string[] = [];

  constructor(private scene: Phaser.Scene, private host: DropHost) {}

  /** 霧屍倒下：擲骰，掉了就在屍體旁彈出來 */
  onZombieDown(z: Zombie): void {
    const entry = rollDrop(z.spec.profession.id, z.spec.mutations.length);
    if (entry) this.spawn(entry, z.footX, z.footY);
  }

  spawn(entry: DropEntry, x: number, y: number): void {
    const key = ensureIcon(this.scene, entry.icon);
    const tx = x + Phaser.Math.Between(-10, 10);
    const ty = y + Phaser.Math.Between(-4, 4);
    const rare = !!entry.loot?.weapons?.length;
    const glow = this.scene.add
      .ellipse(tx, ty, 14, 5, rare ? 0xffd54f : 0xfff59d, rare ? 0.55 : 0.3)
      .setDepth(depthForY(ty) - 0.2);
    const img = this.scene.add.image(x, y - 20, key).setOrigin(0.5, 1).setDepth(depthForY(ty) + 0.1);
    // 從屍體上彈出來、落地
    this.scene.tweens.add({ targets: img, x: tx, duration: 380 });
    this.scene.tweens.add({ targets: img, y: { from: y - 28, to: ty - 1 }, duration: 380, ease: 'Bounce.easeOut' });
    this.scene.tweens.add({ targets: glow, alpha: { from: glow.alpha, to: glow.alpha * 0.3 }, duration: 600, yoyo: true, repeat: -1 });
    if (rare) {
      Fx.of(this.scene)?.popText(tx, ty - 30, '掉了一把武器！', '#ffd54f');
      AudioManager.play('ui_confirm', { semitones: 12, volume: 0.5 });
    }
    this.drops.push({ entry, img, glow, x: tx, y: ty, t: 0, flying: false });
  }

  update(dt: number, px: number, py: number, alive = true): void {
    for (const d of this.drops) {
      d.t += dt;
      if (d.flying) {
        const tx = px;
        const ty = py - 24;
        const dx = tx - d.img.x;
        const dy = ty - d.img.y;
        const dist = Math.hypot(dx, dy);
        const v = Math.min(dist, (220 + d.t * 200) * dt);
        d.img.x += (dx / (dist || 1)) * v;
        d.img.y += (dy / (dist || 1)) * v;
        if (dist < 6) this.take(d, tx, ty);
        continue;
      }
      // 落地後才能撿
      if (d.t > 0.4 && alive && Math.hypot(px - d.x, (py - d.y) * 1.6) < DROP_TUNING.magnet) {
        d.flying = true;
        d.t = 0;
        this.scene.tweens.killTweensOf([d.glow, d.img]);
        d.glow.destroy();
        d.img.setDepth(depthForY(py) + 1);
        continue;
      }
      const left = DROP_TUNING.lifetime - d.t;
      if (left <= 0) {
        this.remove(d);
      } else if (left < DROP_TUNING.blinkFrom) {
        const on = Math.floor(left * (left < 1.5 ? 10 : 5)) % 2 === 0;
        d.img.setAlpha(on ? 1 : 0.25);
      }
    }
    this.drops = this.drops.filter((d) => d.img.active);
  }

  /** 撐過一夜：地上剩的東西都收回據點（不跳字，結算時一起算） */
  collectAll(px: number, py: number): void {
    for (const d of this.drops) this.take(d, px, py, true);
    this.drops = [];
  }

  get count(): number {
    return this.drops.length;
  }

  private take(d: GroundDrop, x: number, y: number, quiet = false): void {
    const e = d.entry;
    const parts: string[] = [];
    if (e.heal) {
      const got = this.host.heal(e.heal);
      if (!e.label) parts.push(`生命 +${got}`);
    }
    if (e.repair) {
      const got = this.host.repair(e.repair);
      if (!e.label) parts.push(`路障 +${got}`);
    }
    if (e.loot) {
      const loot: Loot = e.loot;
      GameState.addLoot(loot);
      if (!e.label) parts.push(...describeLoot(loot));
    }
    const text = e.label ?? parts.join(' ');
    this.picked.push(text);
    this.remove(d);
    if (quiet) return;
    Fx.of(this.scene)?.popText(x, y - 12, text, e.loot?.weapons?.length ? '#ffd54f' : '#c5e1a5');
    AudioManager.play('ui_confirm', { semitones: 7, volume: 0.6 });
  }

  private remove(d: GroundDrop): void {
    this.scene.tweens.killTweensOf([d.glow, d.img]);
    d.img.destroy();
    if (d.glow.active) d.glow.destroy();
  }
}
