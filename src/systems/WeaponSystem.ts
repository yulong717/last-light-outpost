import Phaser from 'phaser';
import { bulletStops, type DamageInfo } from '../combat/Damage';
import { fullReloadTime, getFirearm, type AmmoType, type FirearmDef } from '../data/weapons';
import type { Zombie } from '../entities/Zombie';
import { DEPTH_FX, PLACEHOLDER_COLORS } from '../config';
import { Fx } from '../fx/Fx';
import { FEEL } from '../feel/FeelConfig';
import { GameEvents } from './GameEvents';

export interface WeaponRuntime {
  def: FirearmDef;
  /** 彈匣（含膛內）目前幾發 */
  ammo: number;
}

export interface ShotResult {
  /** 命中幾次（霰彈每顆彈丸各算一次） */
  hits: number;
  kills: number;
  headshots: number;
  /** 這一槍實際用的散射角（度） */
  spread: number;
  /** 這一槍實際射出的角度（含槍口上揚），弧度 */
  angle: number;
}

/** 各口徑備彈；WeaponSystem 直接扣這個物件（通常就是 GameState.data.armory.ammo） */
export type AmmoPool = Record<AmmoType, number>;

type ReloadPhase = 'fixed' | 'prep' | 'insert' | 'rack';

interface ReloadState {
  phase: ReloadPhase;
  /** 這個階段還剩幾秒 */
  left: number;
  /** 整次換彈預估總長（HUD 進度條用） */
  total: number;
  elapsed: number;
  /** 打空才換：最後要多拉一次 */
  empty: boolean;
}

/** 按扳機的緩衝：冷卻快結束時先按，冷卻一好就射出去（半自動連點不會吃鍵） */
const FIRE_BUFFER = 0.14;

/**
 * 槍械系統：即時命中（hitscan）射擊。
 *
 * 每把槍的差異（見 src/data/weapons.ts）：
 * - 擊發：半自動、全自動、泵動、栓動（泵動／栓動每發之間要上膛，期間不能開火）
 * - 裝填：換彈匣（膛內留一發較快且 +1）、一顆顆塞（隨時可開火打斷）、一次裝滿
 * - 後座：連射散射（bloom）、槍口上揚（climb，連射時準星一路往上飄）、左右亂跳
 * - 彈道：距離衰減、穿透幾隻與每穿一隻的衰減、穿甲（碰到護甲太硬就停）
 */
export class WeaponSystem {
  readonly weapons: WeaponRuntime[];
  current = 0;
  private cooldown = 0;
  private buffer = 0;
  private bloom = 0;
  /** 槍口上揚（度） */
  private climb = 0;
  private rl: ReloadState | null = null;
  /** 栓動／泵動槍打斷換彈後，下一發前要先上膛 */
  private needsRack = false;

  constructor(
    private scene: Phaser.Scene,
    ids: string[],
    private pool: AmmoPool,
  ) {
    const defs = ids.map((id) => getFirearm(id)).filter((d): d is FirearmDef => !!d);
    if (defs.length === 0) defs.push(getFirearm('m1911')!);
    // 入夜時從備彈裝滿彈匣（備彈不夠就裝多少算多少）
    this.weapons = defs.map((def) => ({ def, ammo: this.take(def, def.magazine) }));
  }

  get active(): WeaponRuntime {
    return this.weapons[this.current];
  }

  get reloading(): boolean {
    return this.rl !== null;
  }

  get reloadProgress(): number {
    return this.rl ? Phaser.Math.Clamp(this.rl.elapsed / this.rl.total, 0, 1) : 1;
  }

  /** 這次換彈預估總長（秒） */
  get reloadDuration(): number {
    return this.rl?.total ?? 0;
  }

  /** 槍口上揚（度），給準星往上飄用 */
  get climbDeg(): number {
    return this.climb;
  }

  /** 正在上膛或冷卻（栓動槍拉栓中） */
  get cycling(): boolean {
    return this.cooldown > 0.05;
  }

  /** 這把槍的備彈（無限 = Infinity） */
  reserve(def = this.active.def): number {
    return def.infiniteReserve ? Infinity : this.pool[def.ammo] ?? 0;
  }

  private take(def: FirearmDef, n: number): number {
    if (def.infiniteReserve) return n;
    const got = Math.min(n, this.pool[def.ammo] ?? 0);
    this.pool[def.ammo] -= got;
    return got;
  }

  /** 結算時把彈匣裡的子彈退回備彈 */
  unloadAll(): void {
    for (const w of this.weapons) {
      if (!w.def.infiniteReserve) this.pool[w.def.ammo] += w.ammo;
      w.ammo = 0;
    }
  }

  private capacity(w: WeaponRuntime): number {
    return w.def.magazine + (w.def.chamber && w.def.reload === 'magazine' && w.ammo > 0 ? 1 : 0);
  }

  select(index: number): void {
    if (index < 0 || index >= this.weapons.length || index === this.current) return;
    this.cancelReload();
    this.current = index;
    // 換槍時間：手槍快、機槍慢
    this.cooldown = this.active.def.swapTime;
    this.bloom = 0;
    this.climb = 0;
    this.needsRack = false;
    GameEvents.of(this.scene).emit('player:weapon-switch', { weaponId: this.active.def.id });
  }

  next(): void {
    this.select((this.current + 1) % this.weapons.length);
  }

  reload(): void {
    const w = this.active;
    const d = w.def;
    if (this.rl || w.ammo >= this.capacity(w) || this.reserve() <= 0) return;
    const empty = w.ammo === 0;
    const total = fullReloadTime(d, w.ammo);
    if (d.reload === 'single') {
      this.rl = { phase: 'prep', left: d.reloadTime, total, elapsed: 0, empty: empty || this.needsRack };
    } else {
      this.rl = { phase: 'fixed', left: total, total, elapsed: 0, empty };
    }
    GameEvents.of(this.scene).emit('player:reload-start', { weaponId: d.id, duration: total, style: d.reload, empty });
  }

  /**
   * 中斷換彈（換槍、近戰、一顆顆塞時開火）。
   * 換彈匣中斷 = 白換；一顆顆塞的已經塞進去的保留。
   */
  cancelReload(): void {
    if (!this.rl) return;
    const d = this.active.def;
    if (d.reload === 'single' && this.rl.empty && this.active.ammo > 0 && this.rl.phase !== 'rack') this.needsRack = true;
    this.rl = null;
    GameEvents.of(this.scene).emit('player:reload-cancel', { weaponId: d.id });
  }

  /**
   * 目前的散射角（度）：基礎散射 + 連射累積 + 移動懲罰。
   * @param moveFactor 0 = 站定、1 = 全速移動
   */
  spreadNow(moveFactor: number): number {
    const d = this.active.def;
    return d.spread + this.bloom + d.moveSpread * FEEL.aim.movePenalty * Phaser.Math.Clamp(moveFactor, 0, 1);
  }

  update(dt: number): void {
    const d = this.active.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.buffer = Math.max(0, this.buffer - dt);
    this.bloom = Math.max(0, this.bloom - d.bloomRecover * dt);
    // 冷卻（上膛）中槍口還沒回來，回正從冷卻結束才開始，連射時才會一路往上飄
    if (this.cooldown <= 0 || d.action !== 'auto') this.climb = Math.max(0, this.climb - d.climbRecover * dt);
    if (this.rl) this.tickReload(dt);
  }

  private tickReload(dt: number): void {
    const rl = this.rl!;
    const w = this.active;
    const d = w.def;
    const bus = GameEvents.of(this.scene);
    rl.elapsed += dt;
    rl.left -= dt;
    if (rl.left > 0) return;

    switch (rl.phase) {
      case 'fixed': {
        const want = this.capacity(w) - w.ammo;
        w.ammo += this.take(d, want);
        this.finishReload();
        return;
      }
      case 'prep':
        rl.phase = 'insert';
        // 打空又有橋夾：一次壓滿（時間 = 兩顆的份）
        rl.left += d.clip && w.ammo === 0 && this.reserve() >= d.clip ? d.perRound! * 2 : d.perRound!;
        return;
      case 'insert': {
        const clip = !!d.clip && w.ammo === 0 && this.reserve() >= d.clip;
        w.ammo += this.take(d, clip ? d.clip! : 1);
        bus.emit('player:reload-round', { weaponId: d.id, loaded: w.ammo, magazine: d.magazine, clip });
        if (w.ammo >= d.magazine || this.reserve() <= 0) {
          if (rl.empty) {
            rl.phase = 'rack';
            rl.left += d.rackTime ?? 0.3;
          } else this.finishReload();
        } else rl.left += d.perRound!;
        return;
      }
      case 'rack':
        bus.emit('player:rack', { weaponId: d.id });
        this.needsRack = false;
        this.finishReload();
        return;
    }
  }

  private finishReload(): void {
    this.rl = null;
    GameEvents.of(this.scene).emit('player:reload-end', { weaponId: this.active.def.id });
  }

  /** 嘗試開火；沒開成功回傳 null。 */
  tryFire(
    fromX: number,
    fromY: number,
    aimX: number,
    aimY: number,
    held: boolean,
    pressed: boolean,
    zombies: Zombie[],
    moveFactor = 0,
  ): ShotResult | null {
    const w = this.active;
    const d = w.def;
    const bus = GameEvents.of(this.scene);
    if (pressed) this.buffer = FIRE_BUFFER;
    const wants = d.action === 'auto' ? held || this.buffer > 0 : this.buffer > 0;

    if (this.rl) {
      // 一顆顆塞的槍：有子彈就能開火打斷換彈
      if (wants && d.reload === 'single' && w.ammo > 0 && this.rl.phase !== 'rack') {
        this.cancelReload();
        if (this.needsRack) {
          // 打空後塞了幾顆，先上膛才能打
          this.needsRack = false;
          this.cooldown = d.rackTime ?? 0.3;
          bus.emit('player:rack', { weaponId: d.id });
          return null;
        }
      } else {
        if (pressed) bus.emit('player:dryfire', { weaponId: d.id });
        return null;
      }
    }
    if (this.cooldown > 0 || !wants) return null;
    if (w.ammo <= 0) {
      this.buffer = 0;
      bus.emit('player:dryfire', { weaponId: d.id });
      this.reload();
      return null;
    }
    if (this.needsRack) {
      this.needsRack = false;
      this.cooldown = d.rackTime ?? 0.3;
      bus.emit('player:rack', { weaponId: d.id });
      return null;
    }

    this.buffer = 0;
    w.ammo -= 1;
    this.cooldown = 1 / d.fireRate;
    const aim = Math.atan2(aimY - fromY, aimX - fromX);
    // 槍口上揚：畫面上「往上」，面向左時角度方向相反
    const up = Math.cos(aim) >= 0 ? -1 : 1;
    const base = aim + Phaser.Math.DegToRad(up * this.climb + Phaser.Math.FloatBetween(-d.yawJitter, d.yawJitter));
    const spread = this.spreadNow(moveFactor);
    const result: ShotResult = { hits: 0, kills: 0, headshots: 0, spread, angle: base };

    for (let i = 0; i < d.pellets; i++) {
      // 霰彈：彈丸平均分布在扇形裡再加一點亂數，不會全部擠在中間
      const t = d.pellets > 1 ? (i / (d.pellets - 1)) * 2 - 1 : 0;
      const jitter = d.pellets > 1 ? Phaser.Math.FloatBetween(-0.35, 0.35) : Phaser.Math.FloatBetween(-1, 1);
      const angle = base + Phaser.Math.DegToRad(Phaser.Math.Clamp(t + jitter, -1, 1) * spread);
      this.castRay(fromX, fromY, angle, d, zombies, result);
    }

    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloomPerShot);
    this.climb = Math.min(d.climbMax, this.climb + d.climbPerShot);
    bus.emit('player:shoot', {
      weaponId: d.id,
      x: fromX,
      y: fromY,
      angle: base,
      pellets: d.pellets,
      ammoLeft: w.ammo,
      magazine: d.magazine,
    });
    if (d.cycleSound && w.ammo > 0) {
      bus.emit('player:cycle', { weaponId: d.id, kind: d.cycleSound, x: fromX, y: fromY, delay: Math.min(0.3, 0.35 / d.fireRate) });
    }
    if (w.ammo === 0) this.reload();
    return result;
  }

  /** 距離衰減倍率 */
  private falloff(def: FirearmDef, dist: number): number {
    if (dist <= def.falloffStart) return 1;
    const k = Phaser.Math.Clamp((dist - def.falloffStart) / (def.falloffEnd - def.falloffStart), 0, 1);
    return 1 - (1 - def.falloffMin) * k;
  }

  private castRay(
    fromX: number,
    fromY: number,
    angle: number,
    def: FirearmDef,
    zombies: Zombie[],
    result: ShotResult,
  ): void {
    const ray = new Phaser.Geom.Line(
      fromX,
      fromY,
      fromX + Math.cos(angle) * def.range,
      fromY + Math.sin(angle) * def.range,
    );

    const hits: { z: Zombie; x: number; y: number; dist: number }[] = [];
    for (const z of zombies) {
      if (z.dead) continue;
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, z.getHitRect());
      if (pts.length === 0) continue;
      const p = pts.reduce((a, b) =>
        Phaser.Math.Distance.Between(fromX, fromY, a.x, a.y) <= Phaser.Math.Distance.Between(fromX, fromY, b.x, b.y) ? a : b,
      );
      hits.push({ z, x: p.x, y: p.y, dist: Phaser.Math.Distance.Between(fromX, fromY, p.x, p.y) });
    }
    hits.sort((a, b) => a.dist - b.dist);

    let endX = ray.x2;
    let endY = ray.y2;
    let carry = 1;
    const dirX = Math.cos(angle);
    const fx = Fx.of(this.scene);
    for (const h of hits.slice(0, def.pierce)) {
      const head = h.z.isHeadshot(h.y);
      const info: DamageInfo = {
        amount: def.damage * carry * this.falloff(def, h.dist) * (head ? def.headshotMul : 1),
        type: def.damageType,
        penetration: def.penetration,
        knockback: def.knockback,
        stagger: def.stagger,
        headshot: head,
        dirX,
        source: 'player',
        weaponId: def.id,
      };
      if (head) result.headshots++;
      result.hits++;
      // 血落在這隻霧屍腳下（2.5D：每隻的地面 y 不同）
      fx?.bulletHit(h.x, h.y, dirX, h.z.footY, head);
      const stopped = bulletStops(info, h.z.armor);
      const killed = h.z.takeHit(info);
      if (killed) {
        result.kills++;
        // 爆頭擊殺卡肉久一點，一般擊殺輕輕頓一下
        fx?.freeze(head ? 55 : 25);
      }
      GameEvents.of(this.scene).emit('enemy:hit', { enemyId: h.z.def.id, x: h.x, y: h.y, damage: info.amount, headshot: head, killed });
      if (!fx) this.spawnHitSpark(h.x, h.y, head);
      endX = h.x;
      endY = h.y;
      carry *= def.pierceFalloff;
      // 子彈被護甲擋住就不再往後穿
      if (stopped) break;
    }
    this.drawTracer(fromX, fromY, endX, endY);
  }

  private drawTracer(x1: number, y1: number, x2: number, y2: number): void {
    const fx = Fx.of(this.scene);
    if (fx) {
      fx.bulletTracer(x1, y1, x2, y2);
      return;
    }
    const g = this.scene.add.graphics().setDepth(DEPTH_FX);
    g.lineStyle(1, PLACEHOLDER_COLORS.bullet, 0.9);
    g.lineBetween(x1, y1, x2, y2);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 70, onComplete: () => g.destroy() });
  }

  private spawnHitSpark(x: number, y: number, head: boolean): void {
    const size = head ? 4 : 2;
    const r = this.scene.add.rectangle(x, y, size, size, head ? 0xff5252 : 0xaa2222).setDepth(DEPTH_FX + 1);
    this.scene.tweens.add({
      targets: r,
      y: y + 6,
      alpha: 0,
      duration: 220,
      onComplete: () => r.destroy(),
    });
  }
}
