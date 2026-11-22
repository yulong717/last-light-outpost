import Phaser from 'phaser';
import { DEPTH_FX, LANE_BOTTOM, LANE_TOP, clampLaneY, depthForY } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { PROPS, propKey } from '../art/PropArt';
import { getFirearm } from '../data/weapons';
import { PROP_TUNING, type InteractKind } from '../data/scenery';
import type { Loot } from '../data/explore';
import type { Player } from '../entities/Player';
import type { Zombie, ZombieTarget } from '../entities/Zombie';
import { CameraFeel } from '../feel/CameraFeel';
import { rumble } from '../feel/Haptics';
import { Fx } from '../fx/Fx';
import { FX } from '../fx/FxTextures';
import { GameEvents } from '../systems/GameEvents';
import { pixelText } from '../utils/text';
import { addLightGlow, type PlacedProp, type SceneryResult } from './SceneryBuilder';

/**
 * 可互動的場景道具（夜晚防守與探索戰鬥共用）：
 * - 油桶／加油機：打兩槍爆炸，近戰點燃後幾秒爆炸，會連鎖、留下火堆
 * - 汽車：被打到響警報，附近霧屍被吸過去拆車；潛入時按 E 敲車窗當誘餌
 * - 木箱：打爛掉物資，物資自己飛向主角
 * - 燈：射掉變暗；電箱按 E 斷電，全部熄燈
 * - 門：戰鬥時霧屍從門裡衝出來，按 E 封住
 * - 窗：打破
 * - 掩體：擋路，霧屍要繞；潛入時躲在後面比較不會被看到
 *
 * 射擊命中：訂閱 player:shoot，沿彈道檢查道具；近戰：訂閱 player:melee-swing。
 */

export interface PropHost {
  player: Player;
  zombies: () => Zombie[];
  /** 夥伴、保護目標等其他會被炸到的人 */
  others?: () => ZombieTarget[];
  onKill: (n: number) => void;
  /** 探索：發出噪音 */
  onNoise?: (n: number) => void;
  /** 撿到物資 */
  onLoot: (loot: Loot, x: number, y: number) => void;
  /** 物資箱掉什麼 */
  rollLoot: () => Loot;
  /** 潛入中（警報變成誘餌、開槍會驚動） */
  stealth?: () => boolean;
}

export interface PropObj {
  def: PlacedProp;
  kind: InteractKind | null;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  broken: boolean;
  /** 燈 */
  glow?: Phaser.GameObjects.GameObject[];
  /** 車：警報剩幾秒、今天用過了沒 */
  alarm: number;
  alarmUsed: boolean;
  alarmSfx: number;
  lure?: ZombieTarget;
  /** 油桶：點燃倒數 */
  fuse: number;
  /** 門：封住了沒、封門進度 */
  boarded: boolean;
  open: boolean;
  /** 給畫面標示的小字 */
  tag?: Phaser.GameObjects.Text;
}

interface Fire {
  x: number;
  y: number;
  r: number;
  t: number;
  emitter: Phaser.GameObjects.Particles.ParticleEmitter;
}

interface Pickup {
  img: Phaser.GameObjects.Image;
  loot: Loot;
  t: number;
}

/** 可以被按 E 互動的東西 */
export interface Interaction {
  prop: PropObj;
  label: string;
}

/** 掩體的擋路範圍：底部一條橢圓 */
const COVER_DEPTH = 9;

export class PropSystem {
  readonly props: PropObj[] = [];
  private fires: Fire[] = [];
  private pickups: Pickup[] = [];
  private darkLayer?: Phaser.GameObjects.Rectangle;
  private baseDark = 0;
  powerOff = false;
  private boarding: { prop: PropObj; t: number; bar: Phaser.GameObjects.Rectangle; bg: Phaser.GameObjects.Rectangle } | null = null;
  private time = 0;

  constructor(
    private scene: Phaser.Scene,
    private host: PropHost,
    res: SceneryResult,
    opt: { interactive?: boolean } = {},
  ) {
    for (const d of res.props) this.add(d, res.light, opt.interactive !== false);
    if (res.setting === 'int' || res.darkness > 0.1) {
      this.baseDark = res.darkness;
      this.darkLayer = scene.add.rectangle(0, 0, 640, 360, 0x05070c, res.darkness).setOrigin(0).setScrollFactor(0).setDepth(41);
    }
    const bus = GameEvents.of(scene);
    bus.on('player:shoot', (e) => this.onShot(e.x, e.y, e.angle, e.weaponId));
    bus.on('player:melee-swing', (e) => scene.time.delayedCall(110, () => this.onMelee(e.x, e.y, e.heavy)));
  }

  private add(d: PlacedProp, light: number, interactive: boolean): void {
    const art = PROPS[d.id];
    if (!art) return;
    const tube = d.id === 'tubelight';
    const img = this.scene.add.image(d.x, d.y, propKey(d.id), d.frame).setOrigin(0.5, tube ? 0 : 1).setFlipX(d.flip).setScale(d.scale);
    img.setDepth(d.wall ? 5 + d.x / 10000 : depthForY(d.y));
    const kind = interactive ? d.kind : null;
    const hpBase = kind === 'barrel' ? (d.id === 'pump' ? PROP_TUNING.pump.hp : PROP_TUNING.barrel.hp) : kind === 'car' ? PROP_TUNING.car.hp : kind === 'crate' ? PROP_TUNING.crate.hp : 1;
    const o: PropObj = {
      def: d,
      kind,
      img,
      x: d.x,
      y: d.y,
      w: art.w * d.scale,
      h: art.h * d.scale,
      hp: hpBase,
      broken: d.frame === 1 && kind !== 'door',
      alarm: 0,
      alarmUsed: d.frame === 1,
      alarmSfx: 0,
      fuse: 0,
      boarded: false,
      open: d.id === 'door' && d.frame === 1,
    };
    if (d.id === 'tubelight' || d.id === 'lamppost') {
      o.glow = addLightGlow(this.scene, d, light);
      // 偶爾閃一下
      if (Math.random() < 0.4) this.flicker(o);
    }
    this.props.push(o);
  }

  private flicker(o: PropObj): void {
    const loop = () => {
      if (o.broken || !o.img.active) return;
      const off = !this.powerOff && Math.random() < 0.15;
      if (!this.powerOff) for (const g of o.glow ?? []) (g as Phaser.GameObjects.Image).setVisible(!off);
      if (!this.powerOff) o.img.setFrame(off ? 1 : 0);
      this.scene.time.delayedCall(off ? Phaser.Math.Between(40, 120) : Phaser.Math.Between(300, 2600), loop);
    };
    loop();
  }

  // ── 命中判定 ──

  /** 道具在畫面上的受擊框 */
  private rect(o: PropObj): Phaser.Geom.Rectangle {
    if (o.def.id === 'lamppost') {
      // 只有燈頭打得到
      const hx = o.x + (o.def.flip ? -6 : 6);
      return new Phaser.Geom.Rectangle(hx - 5, o.y - 80, 10, 8);
    }
    if (o.def.id === 'tubelight') return new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y, o.w, o.h + 2);
    return new Phaser.Geom.Rectangle(o.x - o.w / 2, o.y - o.h, o.w, o.h);
  }

  private onShot(x: number, y: number, angle: number, weaponId: string): void {
    const def = getFirearm(weaponId);
    const range = def?.range ?? 400;
    const dmg = (def?.damage ?? 20) * (def?.pellets ?? 1) * 0.6;
    const ray = new Phaser.Geom.Line(x, y, x + Math.cos(angle) * range, y + Math.sin(angle) * range);
    // 只打中彈道上最近的一個道具；油桶、燈、窗、車、箱子都算
    let best: { o: PropObj; d: number; px: number; py: number } | null = null;
    for (const o of this.props) {
      if (!o.kind || o.broken || o.kind === 'door' || o.kind === 'fusebox' || o.kind === 'cover') continue;
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, this.rect(o));
      if (!pts.length) continue;
      // 2.5D：子彈從主角的高度射出，離主角腳底太遠（遠近差很多）的地面道具不算
      if (!o.def.wall && Math.abs(o.y - this.host.player.footY) > 34 && o.kind !== 'light') continue;
      for (const p of pts) {
        const d = Phaser.Math.Distance.Between(x, y, p.x, p.y);
        if (!best || d < best.d) best = { o, d, px: p.x, py: p.y };
      }
    }
    if (best) this.damage(best.o, dmg, best.px, best.py, Math.sign(Math.cos(angle)) || 1, 'bullet');
  }

  private onMelee(x: number, y: number, heavy: boolean): void {
    const p = this.host.player;
    for (const o of this.props) {
      if (!o.kind || o.broken || o.def.wall) continue;
      const dx = o.x - p.footX;
      if (dx * p.facing < -o.w / 2 || Math.abs(dx) > o.w / 2 + 26 || Math.abs(o.y - p.footY) > 16) continue;
      const hx = o.x - (o.w / 2) * p.facing;
      this.damage(o, heavy ? 30 : 18, hx, o.y - o.h / 2, p.facing, 'melee');
      return;
    }
    void x;
    void y;
  }

  /** 道具受到傷害 */
  damage(o: PropObj, amount: number, hx: number, hy: number, dir: number, src: 'bullet' | 'melee' | 'blast'): void {
    const fx = Fx.of(this.scene);
    switch (o.kind) {
      case 'barrel':
        fx?.sparks(hx, hy, -dir, o.y, 4);
        if (src === 'melee') {
          // 近戰：油漏出來點燃，快跑！
          if (o.fuse <= 0) {
            o.fuse = PROP_TUNING.barrel.fuse;
            fx?.popText(o.x, o.y - o.h - 8, '著火了！快跑', '#ffb74d');
            AudioManager.play('reload_out', { semitones: -10, volume: 0.6 });
            this.fireAt(o.x, o.y - o.h, 6, PROP_TUNING.barrel.fuse, true);
          }
          return;
        }
        o.hp -= amount;
        o.img.setFrame(Math.min(1, this.frames(o) - 1));
        AudioManager.play('barricade_hit', { semitones: 10, volume: 0.5 });
        if (o.hp <= 0 || src === 'blast') this.explode(o);
        else if (o.fuse <= 0) {
          o.fuse = 0.9;
          this.fireAt(o.x, o.y - o.h + 4, 4, 0.9, true);
        }
        return;
      case 'car':
        fx?.sparks(hx, hy, -dir, o.y, 5);
        AudioManager.play('barricade_hit', { semitones: 6, volume: 0.45 });
        if (src === 'blast') {
          o.hp -= amount;
          if (o.hp <= 0) this.wreckCar(o);
        }
        this.startAlarm(o);
        return;
      case 'crate':
        fx?.woodChips(hx, hy, o.y, 5);
        AudioManager.play('barricade_hit', { semitones: 2, volume: 0.5 });
        o.hp -= amount;
        this.shake(o);
        if (o.hp <= 0 || src === 'blast') this.breakCrate(o);
        return;
      case 'light':
        this.breakLight(o);
        return;
      case 'window':
        this.breakWindow(o);
        return;
    }
  }

  private frames(o: PropObj): number {
    return PROPS[o.def.id]?.frames ?? 1;
  }

  private shake(o: PropObj): void {
    this.scene.tweens.add({ targets: o.img, x: o.x + 1.5, duration: 30, yoyo: true, repeat: 1, onComplete: () => o.img.setX(o.x) });
  }

  // ── 油桶 ──

  private explode(o: PropObj): void {
    if (o.broken) return;
    o.broken = true;
    o.fuse = 0;
    const pump = o.def.id === 'pump';
    const t = pump ? PROP_TUNING.pump : PROP_TUNING.barrel;
    const x = o.x;
    const y = o.y;
    if (pump || this.frames(o) > 1) o.img.setFrame(this.frames(o) - 1).setTint(0x3a2a20);
    else o.img.setVisible(false);
    if (o.def.id === 'barrel' || o.def.id === 'gascan') o.img.setVisible(false);
    this.blast(x, y, t.radius, t.damage, o);
    this.fireAt(x, y, t.radius * 0.45, 5);
    this.host.onNoise?.(25);
  }

  /** 爆炸：傷害霧屍、主角、夥伴、其他道具（油桶會連鎖） */
  blast(x: number, y: number, r: number, damage: number, source?: PropObj): void {
    const scene = this.scene;
    const flash = scene.add.circle(x, y - 10, 8, 0xfff1a0, 0.95).setDepth(DEPTH_FX + 1).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: flash, radius: r * 0.9, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
    const ring = scene.add.ellipse(x, y, 10, 5).setStrokeStyle(3, 0xff9a4a, 0.9).setDepth(DEPTH_FX);
    scene.tweens.add({ targets: ring, width: r * 2.2, height: r * 1.1, alpha: 0, duration: 340, onComplete: () => ring.destroy() });
    // 火球與黑煙
    scene.add.particles(x, y - 10, FX.smoke, {
      speed: { min: 20, max: 90 },
      angle: { min: 200, max: 340 },
      lifespan: { min: 600, max: 1400 },
      scale: { start: 1.6, end: 3.2 },
      alpha: { start: 0.7, end: 0 },
      tint: [0xffd060, 0xff7a20, 0x3a3030, 0x2a2626],
      quantity: 22,
      emitting: false,
    }).setDepth(DEPTH_FX).explode(22);
    const fx = Fx.of(scene);
    fx?.dust(x, y, 16);
    fx?.muzzleLight(x, y - 14, 4);
    fx?.stain(x, y, 2);
    CameraFeel.of(scene)?.addTrauma(0.6);
    rumble(200, 1);
    AudioManager.play('explosion', { volume: 1 });

    const inR = (tx: number, ty: number) => Math.hypot(tx - x, (ty - y) * 1.6);
    let kills = 0;
    for (const z of this.host.zombies()) {
      if (z.dead || !z.active) continue;
      const d = inR(z.footX, z.footY);
      if (d > r) continue;
      if (z.takeDamage(damage * (1 - (d / r) * 0.5), 16, { dirX: Math.sign(z.footX - x) || 1, type: 'blast' })) kills++;
    }
    if (kills) {
      this.host.onKill(kills);
      if (kills >= 2) fx?.popText(x, y - 50, `連環爆 ×${kills}`, '#ffb74d');
    }
    const p = this.host.player;
    const pd = inR(p.footX, p.footY);
    if (p.alive && pd < r) p.takeDamage(PROP_TUNING.barrel.playerDamage * (1 - (pd / r) * 0.6), x, y);
    for (const t of this.host.others?.() ?? []) {
      const d = inR(t.x, t.y);
      if (t.alive && d < r) t.hit(PROP_TUNING.barrel.playerDamage * 0.8 * (1 - (d / r) * 0.6), x, y);
    }
    // 連鎖：附近的道具
    for (const o of this.props) {
      if (o === source || o.broken || !o.kind) continue;
      const d = inR(o.x, o.y);
      if (d > r * 1.1) continue;
      if (o.kind === 'barrel') {
        // 錯開一下，看得出一顆接一顆
        scene.time.delayedCall(PROP_TUNING.barrel.chainDelay * 1000, () => this.explode(o));
      } else if (o.kind !== 'door' && o.kind !== 'fusebox' && o.kind !== 'cover') {
        this.damage(o, damage, o.x, o.y - o.h / 2, Math.sign(o.x - x) || 1, 'blast');
      }
    }
  }

  /** 火堆：持續燒傷走過的霧屍與主角 */
  private fireAt(x: number, y: number, r: number, secs: number, small = false): void {
    const emitter = this.scene.add.particles(x, y, FX.px2, {
      x: { min: -r, max: r },
      y: { min: -2, max: 2 },
      speedY: { min: small ? -30 : -60, max: -15 },
      speedX: { min: -8, max: 8 },
      lifespan: { min: 300, max: small ? 500 : 900 },
      scale: { start: small ? 1 : 1.8, end: 0.3 },
      alpha: { start: 1, end: 0 },
      tint: [0xffe080, 0xff9a30, 0xff5a20, 0xc83020],
      frequency: small ? 40 : 14,
      blendMode: Phaser.BlendModes.ADD,
    }).setDepth(depthForY(y) + 0.5);
    if (small) {
      this.scene.time.delayedCall(secs * 1000, () => emitter.destroy());
      return;
    }
    const glow = this.scene.add.image(x, y - 10, FX.glow).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff8a30).setAlpha(0.6).setScale(r / 40).setDepth(42);
    this.scene.tweens.add({ targets: glow, alpha: 0.35, duration: 120, yoyo: true, repeat: -1 });
    this.fires.push({ x, y, r, t: secs, emitter });
    this.scene.time.delayedCall(secs * 1000, () => glow.destroy());
  }

  // ── 汽車 ──

  private startAlarm(o: PropObj, force = false): void {
    if ((o.alarmUsed && !force) || o.broken || o.alarm > 0) return;
    o.alarmUsed = true;
    o.alarm = PROP_TUNING.car.alarmTime;
    o.alarmSfx = 0;
    this.host.onNoise?.(PROP_TUNING.car.noise);
    Fx.of(this.scene)?.popText(o.x, o.y - o.h - 10, '警報大作！', '#ffd24a');
    o.lure = {
      x: o.x,
      y: clampLaneY(o.y + 4),
      alive: true,
      lure: 0.25,
      hit: (d: number) => {
        o.hp -= d;
        this.shake(o);
        Fx.of(this.scene)?.sparks(o.x, o.y - 12, 1, o.y, 2);
        if (o.hp <= 0) this.wreckCar(o);
      },
    };
    o.tag = pixelText(this.scene, o.x, o.y - o.h - 6, '((( 警報 )))', 7, '#ffd24a').setOrigin(0.5).setDepth(70).setStroke('#000000', 3);
  }

  private wreckCar(o: PropObj): void {
    if (o.broken) return;
    o.broken = true;
    o.alarm = 0;
    if (o.lure) o.lure.alive = false;
    o.tag?.destroy();
    o.img.setFrame(1);
    this.fireAt(o.x, o.y - 6, o.w * 0.3, 6);
    Fx.of(this.scene)?.popText(o.x, o.y - o.h - 6, '警報停了', '#90a4ae');
  }

  /** 正在響的車（給霧屍當目標） */
  lureTargets(): ZombieTarget[] {
    return this.props.filter((o) => o.alarm > 0 && o.lure?.alive).map((o) => o.lure!);
  }

  /** 正在響的車的位置（潛入關卡把巡邏的霧屍引過去） */
  alarms(): { x: number; y: number }[] {
    return this.props.filter((o) => o.alarm > 0).map((o) => ({ x: o.x, y: o.y }));
  }

  // ── 木箱、燈、窗 ──

  private breakCrate(o: PropObj): void {
    if (o.broken) return;
    o.broken = true;
    o.img.setFrame(this.frames(o) - 1);
    Fx.of(this.scene)?.woodChips(o.x, o.y - 8, o.y, 10);
    const loot = this.host.rollLoot();
    const icon = this.scene.add.image(o.x, o.y - 10, FX.px2).setScale(3).setTint(0xf5d76e).setDepth(DEPTH_FX);
    this.scene.tweens.add({ targets: icon, y: o.y - 28, duration: 220, yoyo: true, ease: 'Quad.easeOut' });
    this.pickups.push({ img: icon, loot, t: 0 });
  }

  private breakLight(o: PropObj): void {
    if (o.broken) return;
    o.broken = true;
    o.img.setFrame(1);
    for (const g of o.glow ?? []) (g as Phaser.GameObjects.Image).setVisible(false);
    const hx = o.def.id === 'tubelight' ? o.x : o.x + (o.def.flip ? -6 : 6);
    const hy = o.def.id === 'tubelight' ? o.y + 6 : o.y - 76;
    Fx.of(this.scene)?.sparks(hx, hy, 1, o.def.id === 'tubelight' ? LANE_TOP + 10 : o.y, 10);
    AudioManager.play('glass_break', { volume: 0.5 });
    this.host.onNoise?.(4);
    this.refreshDark();
  }

  private breakWindow(o: PropObj): void {
    if (o.broken) return;
    o.broken = true;
    o.img.setFrame(1);
    Fx.of(this.scene)?.sparks(o.x, o.y - o.h / 2, 1, o.y + 20, 12);
    AudioManager.play('glass_break');
    this.host.onNoise?.(6);
  }

  /** 剩下幾盞燈亮著 → 調整畫面暗度 */
  private refreshDark(): void {
    if (!this.darkLayer) return;
    const lights = this.props.filter((o) => o.kind === 'light');
    const lit = this.powerOff ? 0 : lights.filter((o) => !o.broken).length;
    const ratio = lights.length ? lit / lights.length : 1;
    const target = this.baseDark + (1 - ratio) * 0.3;
    this.scene.tweens.add({ targets: this.darkLayer, fillAlpha: target, duration: 200 });
  }

  // ── 按 E 互動 ──

  /** 主角附近能互動的東西（電箱、門、潛入時的車） */
  nearestInteraction(): Interaction | null {
    const p = this.host.player;
    let best: Interaction | null = null;
    let bestD = 40;
    for (const o of this.props) {
      let label = '';
      if (o.kind === 'fusebox' && !this.powerOff) label = '斷電';
      else if (o.kind === 'door' && !o.boarded && !o.broken) label = '封住門';
      else if (o.kind === 'car' && !o.alarmUsed && !o.broken && this.host.stealth?.()) label = '敲車窗（引開霧屍）';
      if (!label) continue;
      const dy = o.def.wall ? Math.max(0, p.footY - LANE_TOP - 18) : Math.abs(p.footY - o.y);
      const d = Math.abs(p.footX - o.x) - o.w / 2 + dy;
      if (d < bestD) {
        bestD = d;
        best = { prop: o, label };
      }
    }
    return best;
  }

  interact(it: Interaction): void {
    const o = it.prop;
    if (o.kind === 'fusebox') {
      this.cutPower(o);
    } else if (o.kind === 'door') {
      if (this.boarding) return;
      const bg = this.scene.add.rectangle(o.x - 12, o.y - o.h - 8, 24, 4, 0x000000).setOrigin(0, 0.5).setDepth(70);
      const bar = this.scene.add.rectangle(o.x - 11, o.y - o.h - 8, 0, 2, 0x9ad17a).setOrigin(0, 0.5).setDepth(71);
      this.boarding = { prop: o, t: 0, bar, bg };
      AudioManager.play('barricade_hit', { semitones: 4, volume: 0.5 });
    } else if (o.kind === 'car') {
      // 敲一下車窗，3 秒後才響：給主角時間躲起來
      AudioManager.play('glass_break', { volume: 0.25, semitones: 6 });
      Fx.of(this.scene)?.popText(o.x, o.y - o.h - 6, '3 秒後響！快躲', '#ffd24a');
      o.alarmUsed = true;
      this.scene.time.delayedCall(3000, () => this.startAlarm(o, true));
    }
  }

  private cutPower(o: PropObj): void {
    this.powerOff = true;
    o.img.setFrame(1);
    AudioManager.play('reload_in', { semitones: -12, volume: 0.8 });
    for (const l of this.props) {
      if (l.kind !== 'light') continue;
      l.img.setFrame(1);
      for (const g of l.glow ?? []) (g as Phaser.GameObjects.Image).setVisible(false);
    }
    Fx.of(this.scene)?.popText(o.x, o.y - o.h - 8, '斷電了', '#90caf9');
    this.refreshDark();
  }

  // ── 門 ──

  /** 還能讓霧屍衝出來的門 */
  spawnDoors(): PropObj[] {
    return this.props.filter((o) => o.kind === 'door' && !o.boarded);
  }

  /** 霧屍破門而出：門被撞開（之後一直開著） */
  burstDoor(o: PropObj): { x: number; y: number } {
    if (!o.open) {
      o.open = true;
      o.img.setFrame(1);
      Fx.of(this.scene)?.woodChips(o.x, o.y - 24, LANE_TOP + 4, 6);
      Fx.of(this.scene)?.dust(o.x, LANE_TOP + 4, 6);
      AudioManager.play('barricade_break', { semitones: 6, volume: 0.5 });
      CameraFeel.of(this.scene)?.addTrauma(0.15);
    }
    return { x: o.x, y: LANE_TOP + 2 };
  }

  // ── 潛入 ──

  /** 躲在掩體後面（離鏡頭較遠的那一側）＝隱蔽 */
  isHidden(x: number, y: number): boolean {
    for (const o of this.props) {
      if (o.kind !== 'cover' && o.kind !== 'car') continue;
      if (o.def.wall || o.h < 14) continue;
      if (Math.abs(x - o.x) < o.w / 2 - 2 && y < o.y && y > o.y - 16) return true;
    }
    return false;
  }

  /** 站在燈光下 */
  isLit(x: number, y: number): boolean {
    if (this.powerOff) return false;
    for (const o of this.props) {
      if (o.kind !== 'light' || o.broken) continue;
      const cy = o.def.id === 'tubelight' ? LANE_TOP + 40 : o.y + 6;
      if (Math.abs(x - o.x) < 50 && Math.abs(y - cy) < 26) return true;
    }
    return false;
  }

  // ── 每格 ──

  /** 把人推出掩體的範圍（霧屍會沿著邊緣滑過去） */
  collide(e: { footX: number; footY: number }): void {
    for (const o of this.props) {
      if (o.def.wall || (o.kind !== 'cover' && o.kind !== 'car' && o.def.id !== 'pump') || o.w < 14) continue;
      const rx = o.w / 2 + 2;
      const ry = COVER_DEPTH;
      const dx = e.footX - o.x;
      const dy = e.footY - (o.y - ry + 3);
      const k = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      if (k >= 1 || k === 0) continue;
      // 推到橢圓邊上（往 y 方向推比較省力，才會繞路而不是卡住）
      const s = 1 / Math.sqrt(k);
      const nx = o.x + dx * s;
      const ny = o.y - ry + 3 + dy * s;
      if (Math.abs(dy) * 1.2 > Math.abs(dx) / rx * ry || Math.abs(dx) < rx * 0.6) {
        e.footY = clampLaneY(dy >= 0 ? Math.max(ny, e.footY) : Math.min(ny, e.footY));
        if (e.footY === LANE_TOP || e.footY === LANE_BOTTOM) e.footX = nx;
      } else e.footX = nx;
    }
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.host.player;
    // 油桶點燃倒數
    for (const o of this.props) {
      if (o.fuse > 0 && !o.broken) {
        o.fuse -= dt;
        o.img.setTint(Math.floor(o.fuse * 10) % 2 ? 0xffffff : 0xff8a6a);
        if (o.fuse <= 0) this.explode(o);
      }
      if (o.alarm > 0) {
        o.alarm -= dt;
        o.alarmSfx -= dt;
        if (o.alarmSfx <= 0) {
          o.alarmSfx = 1.2;
          AudioManager.play('car_alarm');
        }
        // 方向燈閃爍
        o.img.setTint(Math.floor(this.time * 5) % 2 ? 0xffffff : 0xffe08a);
        o.tag?.setAlpha(Math.floor(this.time * 5) % 2 ? 1 : 0.4);
        if (o.alarm <= 0) {
          o.img.clearTint();
          o.tag?.destroy();
          if (o.lure) o.lure.alive = false;
        }
      }
    }
    // 火堆
    for (const f of this.fires) {
      f.t -= dt;
      for (const z of this.host.zombies()) {
        if (!z.dead && Math.abs(z.footX - f.x) < f.r && Math.abs(z.footY - f.y) < 12) {
          if (z.takeDamage(22 * dt, 0, { dirX: 1, type: 'blast' })) this.host.onKill(1);
        }
      }
      if (p.alive && Math.abs(p.footX - f.x) < f.r && Math.abs(p.footY - f.y) < 10) p.takeDamage(6, f.x, f.y);
      if (f.t <= 0) {
        f.emitter.stop();
        this.scene.time.delayedCall(900, () => f.emitter.destroy());
      }
    }
    this.fires = this.fires.filter((f) => f.t > 0);
    // 物資飛向主角
    for (const k of this.pickups) {
      k.t += dt;
      if (k.t < 0.5) continue;
      const tx = p.footX;
      const ty = p.footY - 24;
      const dx = tx - k.img.x;
      const dy = ty - k.img.y;
      const d = Math.hypot(dx, dy);
      const v = Math.min(d, (200 + k.t * 300) * dt);
      k.img.x += (dx / (d || 1)) * v;
      k.img.y += (dy / (d || 1)) * v;
      if (d < 8) {
        k.img.destroy();
        this.host.onLoot(k.loot, tx, ty);
        AudioManager.play('ui_confirm', { semitones: 7, volume: 0.6 });
      }
    }
    this.pickups = this.pickups.filter((k) => k.img.active);
    // 封門
    const b = this.boarding;
    if (b) {
      const far = Math.abs(p.footX - b.prop.x) > 40 || !p.alive;
      b.t += dt;
      b.bar.width = 22 * Math.min(1, b.t / PROP_TUNING.boardTime);
      if (far) {
        b.bar.destroy();
        b.bg.destroy();
        this.boarding = null;
      } else if (b.t >= PROP_TUNING.boardTime) {
        b.prop.boarded = true;
        b.prop.img.setFrame(2);
        b.bar.destroy();
        b.bg.destroy();
        this.boarding = null;
        AudioManager.play('barricade_hit', { semitones: -2 });
        Fx.of(this.scene)?.popText(b.prop.x, b.prop.y - b.prop.h - 6, '門封住了', '#9ad17a');
      }
    }
  }
}
