import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GROUND_Y, LANE_BOTTOM, LANE_TOP, clampLaneY, depthForY } from '../config';
import { attachAudio } from '../audio/AudioBridge';
import { AudioManager } from '../audio/AudioManager';
import { ensureCrewTexture } from '../art/CrewArt';
import { COMPANION_ROLES, type CrewMember } from '../data/companions';
import { NOISE, type FieldSpec } from '../data/explore';
import type { FirearmDef } from '../data/weapons';
import { Player } from '../entities/Player';
import { WeaponRig } from '../entities/WeaponRig';
import { Zombie, type ZombieContext, type ZombieTarget } from '../entities/Zombie';
import { Expedition } from '../explore/Expedition';
import { throwGrenade, useMedkit } from '../explore/Supplies';
import { CameraFeel } from '../feel/CameraFeel';
import { Crosshair } from '../feel/Crosshair';
import { FEEL } from '../feel/FeelConfig';
import { rumble } from '../feel/Haptics';
import { ScreenFeedback } from '../feel/ScreenFeedback';
import { createAtmosphere } from '../fx/Atmosphere';
import { Fx } from '../fx/Fx';
import { InputManager, queueAction, registerUIRect } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { GameEvents } from '../systems/GameEvents';
import { MeleeSystem } from '../systems/MeleeSystem';
import { WeaponSystem } from '../systems/WeaponSystem';
import { prewarmLooks, spawnEnemy } from '../systems/ZombieFactory';
import { PROFESSIONS } from '../data/zombies';
import { Rng, randomSeed } from '../utils/rng';
import { pixelText } from '../utils/text';
import { propKey } from '../art/PropArt';
import { PROP_TUNING } from '../data/scenery';
import { describeLoot, mergeLoot } from '../explore/Expedition';
import { PropSystem, type Interaction } from '../scenery/PropSystem';
import { fieldScenery } from '../scenery/locations';
import type { PlacedProp, SceneryResult } from '../scenery/SceneryBuilder';

export interface FieldResult {
  /** clean：潛入全程沒被發現；win：達成目標；failed：保護目標陣亡；down：主角倒下 */
  result: 'clean' | 'win' | 'failed' | 'down';
  kills: number;
}

export interface ExploreFieldData {
  spec: FieldSpec;
  /** 哪個事件：決定場景佈置（停車場、公車、倉庫…） */
  eventId?: string;
  onDone: (r: FieldResult) => void;
}

const WORLD_W = 960;
const EXIT_X = WORLD_W - 34;
/** 潛入：霧屍基本視野 */
const VISION = 120;
const VISION_DY = 30;
/** 背後多近可以暗殺 */
const TAKEDOWN_X = 28;
const TAKEDOWN_Y = 12;

/** 潛入關卡裡還沒被驚動的霧屍：來回巡邏、停下、轉頭 */
interface Sleeper {
  z: Zombie;
  minX: number;
  maxX: number;
  dir: 1 | -1;
  pause: number;
  /** 警覺 0..1，滿了就發現主角 */
  alert: number;
  icon: Phaser.GameObjects.Text;
  cone: Phaser.GameObjects.Graphics;
}

interface Follower {
  m: CrewMember;
  img: Phaser.GameObjects.Image;
  ox: number;
  oy: number;
  x: number;
  y: number;
  cd: number;
  down: boolean;
}

/**
 * 探索裡的小關卡：沿用夜晚的主角、槍械、近戰、霧屍系統，換一套目標。
 * - 潛入（stealth）：霧屍在巡邏，有視野範圍；躲在陰影裡比較難被發現，從背後按 E 暗殺。
 *   被發現就全員驚醒，變成戰鬥（還是可以衝到出口）。
 * - 條件戰鬥（fight）：消滅全部／撐過時間／保護倖存者，可能禁止開槍。
 * 彈藥直接從據點的備彈扣，同行隊員會跟著開槍，也會受傷。
 */
export class ExploreFieldScene extends Phaser.Scene {
  private spec!: FieldSpec;
  private eventId?: string;
  private scenery!: SceneryResult;
  private props!: PropSystem;
  private interaction: Interaction | null = null;
  private interactHint!: Phaser.GameObjects.Text;
  private hiddenHint!: Phaser.GameObjects.Text;
  private onDone!: (r: FieldResult) => void;
  private exp!: Expedition;
  private player!: Player;
  private weapons!: WeaponSystem;
  private melee!: MeleeSystem;
  /** 主角手上的武器（和夜晚一樣會換彈、拉栓、揮砍） */
  private rig!: WeaponRig;
  private input2!: InputManager;
  private fx!: Fx;
  private camFeel!: CameraFeel;
  private crosshair!: Crosshair;
  private screenFx!: ScreenFeedback;
  private zombies: Zombie[] = [];
  private sleepers: Sleeper[] = [];
  private followers: Follower[] = [];
  private shadows: Phaser.Geom.Rectangle[] = [];
  private alerted = false;
  private ended = false;
  private kills = 0;
  private elapsed = 0;
  private toSpawn = 0;
  private spawnTimer = 0;
  private spawnEvery = 2;
  private rng = new Rng(randomSeed());
  private survivor?: { img: Phaser.GameObjects.Image; hp: number; maxHp: number; x: number; y: number; bar: (r: number) => void };
  private goalText!: Phaser.GameObjects.Text;
  private infoText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private setHp!: (r: number) => void;
  private setNoise!: (r: number) => void;
  private takedownHint!: Phaser.GameObjects.Text;
  private noGunCooldown = 0;
  private unregister: (() => void)[] = [];

  constructor() {
    super('ExploreField');
  }

  init(data: ExploreFieldData): void {
    this.spec = data.spec;
    this.eventId = data.eventId;
    this.onDone = data.onDone;
  }

  create(): void {
    const exp = Expedition.current!;
    this.exp = exp;
    this.zombies = [];
    this.sleepers = [];
    this.followers = [];
    this.shadows = [];
    this.alerted = this.spec.mode === 'fight';
    this.ended = false;
    this.kills = 0;
    this.elapsed = 0;
    this.survivor = undefined;
    this.unregister = [];
    AudioManager.setMood('night');

    this.cameras.main.setBounds(0, 0, WORLD_W, GAME_HEIGHT);
    this.drawBackdrop();
    this.fx = Fx.attach(this);
    this.camFeel = CameraFeel.attach(this);
    createAtmosphere(this, { groundY: LANE_TOP + 14 });

    this.player = new Player(this, 60, (LANE_TOP + LANE_BOTTOM) / 2, 100);
    this.player.hp = Math.max(1, exp.hp);
    this.fx.attachShadow(this.player.sprite, 22);
    this.rig = new WeaponRig(this);
    this.rig.setWeapon(GameState.data.armory.loadout[0] ?? 'm1911');
    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0);
    cam.setDeadzone(140, GAME_HEIGHT);
    cam.fadeIn(250, 0, 0, 0);

    const armory = GameState.data.armory;
    this.weapons = new WeaponSystem(this, armory.loadout, armory.ammo);
    this.melee = new MeleeSystem(this, armory.melee);
    this.input2 = new InputManager(this);
    this.crosshair = new Crosshair(this);
    this.screenFx = new ScreenFeedback(this);
    attachAudio(this);
    this.wireFeedback();
    this.wireRig();

    this.spawnFollowers();
    this.props = new PropSystem(this, {
      player: this.player,
      zombies: () => this.zombies,
      others: () => this.context().others ?? [],
      onKill: (n) => (this.kills += n),
      onNoise: (n) => {
        exp.addNoise(n);
        if (n >= 20) this.raiseAlarm();
      },
      onLoot: (loot, x, y) => {
        mergeLoot(exp.bag, loot);
        this.fx.popText(x, y - 10, describeLoot(loot)[0] ?? '物資', '#f5d76e');
      },
      rollLoot: () => exp.rollLoot('small'),
      stealth: () => !this.alerted,
    }, this.scenery);
    const zone = exp.zone;
    prewarmLooks(this, Object.keys(zone.zombies));
    const count = exp.zombieCount(this.spec);
    if (this.spec.mode === 'stealth') this.setupStealth(count);
    else this.setupFight(count);
    this.buildHud();

    this.input.keyboard?.on('keydown-G', this.grenade, this);
    this.input.keyboard?.on('keydown-H', this.medkit, this);
    this.input.keyboard?.on('keydown-F', this.interact, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-G', this.grenade, this);
      this.input.keyboard?.off('keydown-H', this.medkit, this);
      this.input.keyboard?.off('keydown-F', this.interact, this);
      this.unregister.forEach((fn) => fn());
    });
  }

  // ── 場景 ──

  /** 場景：依區域與事件擺出對應的環境（停車場有車、倉庫有貨架、公車頂有倖存者…） */
  private drawBackdrop(): void {
    const keep: [number, number][] = [[0, 110]];
    if (this.spec.goal === 'reach') keep.push([EXIT_X - 50, WORLD_W]);
    this.scenery = fieldScenery(this, this.exp.zone.id, this.eventId, WORLD_W, keep);
    // 出口（潛入目標）：一扇亮著綠光的門
    if (this.spec.goal === 'reach') {
      const y = GROUND_Y + 1;
      this.add.image(EXIT_X, y, propKey('door'), 1).setOrigin(0.5, 1).setDepth(5);
      const glow = this.add.rectangle(EXIT_X, y - 24, 30, 52, 0x9ad17a, 0.14).setDepth(6);
      this.tweens.add({ targets: glow, alpha: 0.03, duration: 700, yoyo: true, repeat: -1 });
      pixelText(this, EXIT_X, y - 58, '出口', 8, '#9ad17a').setOrigin(0.5).setDepth(70).setStroke('#000000', 3);
    }
  }

  /** 場景佈置裡標記成「保護目標」的擺件（公車、避難所的門） */
  private protectPiece(): PlacedProp | undefined {
    return this.scenery.props.find((p) => p.role === 'protect');
  }

  private spawnFollowers(): void {
    const offsets = [
      { ox: -22, oy: -16 },
      { ox: -30, oy: 14 },
    ];
    this.exp.squad.forEach((m, i) => {
      if ((this.exp.crewHp.get(m.id) ?? 0) <= 0) return;
      const key = ensureCrewTexture(this, m) ?? 'player';
      const o = offsets[i % offsets.length];
      const x = this.player.footX + o.ox;
      const y = clampLaneY(this.player.footY + o.oy);
      const img = this.add.image(x, y, key, 0).setOrigin(0.5, 63 / 64);
      if (key === 'player') img.setTint(COMPANION_ROLES[m.role].tint);
      this.followers.push({ m, img, ox: o.ox, oy: o.oy, x, y, cd: 1 + i * 0.4, down: false });
    });
  }

  /** 依區域權重挑敵人：還沒解鎖的不出；潛入只挑人形（動物不會乖乖站崗） */
  private pickProfession(humansOnly: boolean): string {
    const z = this.exp.zone.zombies;
    const day = GameState.data.day;
    const ids = Object.keys(z).filter((id) => {
      const p = PROFESSIONS[id];
      return p && p.unlockDay <= day && (!humansOnly || (p.body ?? 'human') === 'human');
    });
    return this.rng.weighted(ids, (k) => z[k]) ?? 'basic';
  }

  /** 生一隻（屍犬、屍鴉成群出現）；回傳第一隻 */
  private makeZombie(x: number, y: number, humansOnly = false): Zombie {
    const id = this.pickProfession(humansOnly);
    const n = humansOnly ? 1 : (PROFESSIONS[id]?.pack ?? 1);
    const day = GameState.data.day;
    let first: Zombie | null = null;
    for (let i = 0; i < n; i++) {
      const z = spawnEnemy(this, id, x + i * 14 * Math.sign(x - this.player.footX || 1), clampLaneY(y + this.rng.int(-14, 14) * (i ? 1 : 0)), { day });
      this.zombies.push(z);
      first ??= z;
    }
    return first!;
  }

  // ── 潛入 ──

  private setupStealth(count: number): void {
    // 潛行：腳步放輕，走得比較慢
    this.player.speedMul = 0.75;
    // 陰影區：躲在裡面比較不容易被看到
    for (let i = 0; i < 4; i++) {
      const x = 160 + i * 190 + this.rng.int(-30, 30);
      const w = this.rng.int(60, 90);
      const r = new Phaser.Geom.Rectangle(x, LANE_TOP - 6, w, LANE_BOTTOM - LANE_TOP + 12);
      this.shadows.push(r);
      this.add.rectangle(r.x, r.y, r.width, r.height, 0x000000, 0.42).setOrigin(0).setDepth(9);
    }
    const span = (EXIT_X - 80 - 220) / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      const x = 220 + span * (i + 0.5) + this.rng.int(-20, 20);
      const y = this.rng.int(LANE_TOP + 6, LANE_BOTTOM - 6);
      const z = this.makeZombie(x, y, true);
      const range = this.rng.int(20, 70);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      z.setFlipX(dir < 0);
      const icon = pixelText(this, x, y - 70, '', 10, '#ffd24a').setOrigin(0.5).setDepth(70).setStroke('#000000', 3);
      const cone = this.add.graphics().setDepth(8);
      this.sleepers.push({ z, minX: x - range, maxX: x + range, dir, pause: this.rng.float(0, 2), alert: 0, icon, cone });
    }
  }

  private inShadow(x: number, y: number): boolean {
    return this.shadows.some((r) => r.contains(x, y));
  }

  private updateSleepers(dt: number): void {
    const p = this.player;
    const range = VISION * this.exp.stealthMul();
    const hidden = this.inShadow(p.footX, p.footY) || this.props.isHidden(p.footX, p.footY);
    const lit = !hidden && this.props.isLit(p.footX, p.footY);
    const light = (lit ? PROP_TUNING.stealthLit : 1) * (this.props.powerOff ? PROP_TUNING.stealthDark : 1);
    this.hiddenHint.setVisible(p.alive && (hidden || lit)).setText(hidden ? '隱蔽中' : '燈光下！').setColor(hidden ? '#9ad17a' : '#ffd24a');
    this.hiddenHint.setPosition(p.footX, p.footY - 62);
    const alarms = this.props.alarms();
    let best: Sleeper | null = null;
    for (const s of this.sleepers) {
      const z = s.z;
      if (z.dead) {
        s.icon.destroy();
        s.cone.destroy();
        continue;
      }
      // 車子警報：附近巡邏的霧屍被吸過去，之後就在車旁邊晃
      const near = alarms.find((a) => Math.abs(a.x - z.footX) < PROP_TUNING.car.lureRange * 0.6);
      if (near) {
        s.minX = near.x - 24;
        s.maxX = near.x + 24;
        s.alert = Math.max(0, s.alert - dt * 0.8);
        const dir = near.x > z.footX ? 1 : -1;
        if (Math.abs(near.x - z.footX) > 20) {
          s.dir = dir;
          s.pause = 0;
          z.footX += dir * 30 * dt;
          z.footY += Phaser.Math.Clamp(near.y + 6 - z.footY, -20 * dt, 20 * dt);
          z.setFlipX(dir < 0);
          z.idle(dt);
          s.icon.setPosition(z.footX, z.footY - 64 * z.def.scale!).setText('♪').setColor('#90caf9').setScale(1);
          s.cone.clear();
          continue;
        }
      }
      // 巡邏
      if (s.pause > 0) {
        s.pause -= dt;
        if (s.pause <= 0 && this.rng.chance(0.5)) s.dir = s.dir === 1 ? -1 : 1;
      } else {
        z.footX += s.dir * 14 * dt;
        if (z.footX < s.minX || z.footX > s.maxX) {
          z.footX = Phaser.Math.Clamp(z.footX, s.minX, s.maxX);
          s.dir = s.dir === 1 ? -1 : 1;
          s.pause = this.rng.float(1, 2.6);
        } else if (this.rng.chance(dt * 0.15)) s.pause = this.rng.float(0.8, 2);
      }
      z.setFlipX(s.dir < 0);
      z.idle(s.pause > 0 ? 0 : dt);

      // 視野
      const dx = p.footX - z.footX;
      const dy = Math.abs(p.footY - z.footY);
      const ahead = dx * s.dir > 0;
      let rate = 0;
      if (p.alive && ahead && Math.abs(dx) < range && dy < VISION_DY) {
        rate = (0.5 + (1 - Math.abs(dx) / range) * 1.8) * light;
        if (hidden) rate *= 0.3;
        if (p.moveFactor > 0.7) rate *= 1.3;
      } else if (Math.hypot(dx, dy * 1.6) < 26 && p.moveFactor > 0.3) {
        // 貼太近、腳步太大聲也會被聽到
        rate = 0.7;
      }
      s.alert = rate > 0 ? Math.min(1, s.alert + rate * dt) : Math.max(0, s.alert - 0.35 * dt);
      s.icon.setPosition(z.footX, z.footY - 64 * z.def.scale!).setText(s.alert > 0.05 ? '?' : '');
      s.icon.setColor(s.alert > 0.6 ? '#ff6b6b' : '#ffd24a').setScale(0.8 + s.alert * 0.6);
      // 視野錐（地面上的淡色扇形）
      s.cone.clear();
      s.cone.fillStyle(s.alert > 0.5 ? 0xff6b6b : 0xfff3a0, 0.07 + s.alert * 0.12);
      s.cone.fillTriangle(z.footX, z.footY, z.footX + s.dir * range, z.footY - VISION_DY, z.footX + s.dir * range, z.footY + VISION_DY);
      if (s.alert >= 1) {
        this.raiseAlarm(z);
        return;
      }
      // 背後暗殺
      const behind = dx * s.dir < 0 && Math.abs(dx) < TAKEDOWN_X && dy < TAKEDOWN_Y;
      if (behind && p.alive) best = s;
    }
    this.sleepers = this.sleepers.filter((s) => !s.z.dead);
    this.takedownHint.setVisible(!!best);
    if (best) {
      this.takedownHint.setPosition(best.z.footX, best.z.footY - 78);
      if (this.input2.state.meleePressed) {
        this.takedown(best);
        this.input2.state.meleePressed = false;
      }
    }
  }

  private takedown(s: Sleeper): void {
    const z = s.z;
    this.player.facing = z.footX > this.player.footX ? 1 : -1;
    AudioManager.play('melee_slash', { volume: 0.6 });
    // 安靜的一刀：不會吵醒其他霧屍
    if (z.takeDamage(99999, 0, { dirX: this.player.facing, type: 'slash' })) this.kills++;
    this.fx.blood(z.footX, z.footY - 30, this.player.facing, z.footY, 8, 0.6);
    this.fx.popText(z.footX, z.footY - 60, '暗殺', '#c8e6c9');
    this.camFeel.addTrauma(0.1);
  }

  /** 被發現了：所有霧屍醒來，變成戰鬥 */
  private raiseAlarm(by?: Zombie): void {
    if (this.alerted) return;
    this.alerted = true;
    this.player.speedMul = 1;
    for (const s of this.sleepers) {
      s.icon.destroy();
      s.cone.destroy();
    }
    this.sleepers = [];
    this.takedownHint.setVisible(false);
    if (by) {
      this.fx.popText(by.footX, by.footY - 70, '！', '#ff6b6b');
      GameEvents.of(this).emit('enemy:groan', { enemyId: by.def.id, x: by.footX, y: by.footY });
    }
    AudioManager.play('wave_horn', { volume: 0.6 });
    this.exp.addNoise(15);
    this.goalText.setText('被發現了！殺光牠們，或衝到出口').setColor('#ff8a80');
  }

  // ── 戰鬥 ──

  private setupFight(count: number): void {
    const spec = this.spec;
    const first = Math.ceil(count / 2);
    for (let i = 0; i < first; i++) {
      const right = i % 3 !== 2;
      const x = right ? this.rng.int(420, WORLD_W - 30) : this.rng.int(-30, 10);
      this.makeZombie(x, this.rng.int(LANE_TOP, LANE_BOTTOM));
    }
    this.toSpawn = count - first;
    if (spec.goal === 'survive' || spec.goal === 'protect') {
      // 限時：源源不絕
      const secs = spec.seconds ?? 25;
      this.toSpawn = Math.round(count * 1.6);
      this.spawnEvery = secs / (this.toSpawn + 2);
    } else this.spawnEvery = 2.2;
    this.spawnTimer = this.spawnEvery;
    if (spec.goal === 'protect') {
      // 保護目標：場景有指定（公車頂上的人、避難所的門）就用它，否則是站在路中間的倖存者
      const piece = this.protectPiece();
      const x = piece?.x ?? 300;
      const y = piece && !piece.wall ? piece.y + 2 : piece ? LANE_TOP + 4 : (LANE_TOP + LANE_BOTTOM) / 2;
      const door = piece?.id === 'barricadedoor';
      // 站在公車頂：畫在車頂上，霧屍圍在車邊抓
      const standY = piece?.id === 'bus' ? piece.y - 40 : y;
      const img = door
        ? this.add.image(x, GROUND_Y + 1, propKey('barricadedoor')).setOrigin(0.5, 1).setDepth(6)
        : this.add.image(x, standY, 'player', 0).setOrigin(0.5, 63 / 64).setTint(0xd8c090).setFlipX(true).setDepth(depthForY(y) + 1);
      if (!door) this.fx.attachShadow(img as unknown as Phaser.GameObjects.Sprite, 20);
      if (piece?.id === 'bus') this.tweens.add({ targets: img, y: standY - 2, duration: 300, yoyo: true, repeat: -1 });
      const top = door ? GROUND_Y - 62 : standY - 70;
      const label = pixelText(this, x, top, door ? '避難所的門' : '倖存者', 8, '#ffd24a').setOrigin(0.5).setDepth(70);
      label.setStroke('#000000', 3);
      this.add.rectangle(x - 16, top + 10, 32, 4, 0x000000).setDepth(70);
      const bar = this.add.rectangle(x - 15, top + 11, 30, 2, 0x9ad17a).setOrigin(0, 0.5).setDepth(71);
      bar.setX(x - 15);
      this.survivor = {
        img,
        hp: 120,
        maxHp: 120,
        x,
        y,
        bar: (r) => {
          bar.width = 30 * Math.max(0, r);
        },
      };
      this.player.footX = x - 40;
    }
  }

  private spawnEdge(): void {
    // 室內：有門的話，霧屍有時候破門而出（封住的門不會）
    const doors = this.props.spawnDoors().filter((d) => Math.abs(d.x - this.player.footX) > 90);
    if (doors.length && this.rng.chance(0.45)) {
      const at = this.props.burstDoor(this.rng.pick(doors));
      this.makeZombie(at.x, at.y);
      return;
    }
    const cam = this.cameras.main;
    const left = this.rng.chance(0.35);
    const x = left ? Math.max(-30, cam.scrollX - 24) : Math.min(WORLD_W + 30, cam.scrollX + GAME_WIDTH + 24);
    this.makeZombie(x, this.rng.int(LANE_TOP, LANE_BOTTOM));
  }

  // ── HUD ──

  private buildHud(): void {
    const fix = <T extends Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T): T => {
      o.setScrollFactor(0);
      o.setDepth(200);
      return o;
    };
    fix(this.add.rectangle(0, 0, GAME_WIDTH, 24, 0x000000, 0.5).setOrigin(0));
    fix(pixelText(this, 6, 6, '生命', 8));
    this.setHp = this.hudBar(32, 8, 70, 7, 0xef5350);
    fix(pixelText(this, 110, 6, '噪音', 8, '#ffcc80'));
    this.setNoise = this.hudBar(136, 8, 60, 7, 0xffa726);
    const title = this.spec.mode === 'stealth' ? `潛入：${this.spec.title}` : this.spec.meleeOnly ? `${this.spec.title}（禁止開槍）` : this.spec.title;
    this.goalText = fix(pixelText(this, GAME_WIDTH / 2, 30, title, 9, '#ffd24a').setOrigin(0.5, 0).setStroke('#000000', 3));
    this.infoText = fix(pixelText(this, GAME_WIDTH - 6, 6, '', 8).setOrigin(1, 0));
    const touch = this.sys.game.device.input.touch;
    const wx = touch ? 210 : 6;
    this.ammoText = fix(pixelText(this, wx, GAME_HEIGHT - 28, '', 9));
    const help =
      this.spec.mode === 'stealth'
        ? touch
          ? '躲進陰影・從背後按近戰暗殺'
          : 'WASD 移動・躲進陰影或掩體後・從背後按 E 暗殺・F 互動・G 手榴彈・H 醫療包'
        : touch
          ? ''
          : 'F 互動（封門・斷電）・射擊油桶引爆・G 手榴彈・H 醫療包';
    fix(pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 14, help, 7, '#90a4ae').setOrigin(0.5));
    this.interactHint = pixelText(this, 0, 0, '', 8, '#90caf9').setOrigin(0.5).setDepth(70).setStroke('#000000', 3).setVisible(false);
    this.hiddenHint = pixelText(this, 0, 0, '', 7, '#9ad17a').setOrigin(0.5).setDepth(70).setStroke('#000000', 3).setVisible(false);
    this.takedownHint = pixelText(this, 0, 0, touch ? '近戰：暗殺' : 'E 暗殺', 8, '#c8e6c9').setOrigin(0.5).setDepth(70).setStroke('#000000', 3).setVisible(false);
    this.tweens.add({ targets: this.takedownHint, alpha: 0.5, duration: 400, yoyo: true, repeat: -1 });

    if (touch) {
      this.touchButton(GAME_WIDTH - 38, GAME_HEIGHT - 38, '換彈', () => queueAction('reload'));
      this.touchButton(GAME_WIDTH - 76, GAME_HEIGHT - 38, '換槍', () => queueAction('next'));
      this.touchButton(GAME_WIDTH - 38, GAME_HEIGHT - 76, '近戰', () => queueAction('melee'));
      this.touchButton(GAME_WIDTH - 76, GAME_HEIGHT - 76, '手雷', () => this.grenade());
      this.touchButton(GAME_WIDTH - 114, GAME_HEIGHT - 38, '醫療', () => this.medkit());
      this.touchButton(GAME_WIDTH - 114, GAME_HEIGHT - 76, '互動', () => this.interact());
    }
  }

  private hudBar(x: number, y: number, w: number, h: number, color: number): (r: number) => void {
    const bg = this.add.rectangle(x, y, w, h, 0x000000).setOrigin(0).setScrollFactor(0).setDepth(200);
    const bar = this.add.rectangle(x + 1, y + 1, w - 2, h - 2, color).setOrigin(0).setScrollFactor(0).setDepth(201);
    void bg;
    return (r) => (bar.width = (w - 2) * Phaser.Math.Clamp(r, 0, 1));
  }

  private touchButton(x: number, y: number, label: string, fn: () => void): void {
    const b = this.add.circle(x + 16, y + 16, 16, 0x000000, 0.45).setStrokeStyle(1, 0xffffff, 0.5).setScrollFactor(0).setDepth(200);
    pixelText(this, x + 16, y + 16, label, 7).setOrigin(0.5).setScrollFactor(0).setDepth(201);
    b.setInteractive().on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      fn();
    });
    this.unregister.push(registerUIRect({ x, y, w: 32, h: 32 }));
  }

  private refreshHud(): void {
    const p = this.player;
    this.setHp(p.hp / p.maxHp);
    this.setNoise(this.exp.noise / NOISE.max);
    const w = this.weapons.active;
    const res = this.weapons.reserve();
    this.ammoText.setText(
      this.spec.meleeOnly ? `近戰：${this.melee.def.name}` : `${w.def.name}  ${w.ammo}/${w.def.magazine}  ${res === Infinity ? '∞' : res}${this.weapons.reloading ? '  換彈中…' : ''}`,
    );
    const s = GameState.data.supplies;
    const parts = [`手雷 ${s.grenade}`, `醫療 ${s.medkit}`];
    if (this.spec.seconds && this.spec.mode === 'fight') parts.unshift(`剩 ${Math.max(0, Math.ceil(this.spec.seconds - this.elapsed))} 秒`);
    else if (this.alerted) parts.unshift(`剩 ${this.zombies.length + this.toSpawn} 隻`);
    this.infoText.setText(parts.join('　'));
  }

  // ── 輔助用品 ──

  private interact(): void {
    if (this.ended || !this.interaction) return;
    this.props.interact(this.interaction);
  }

  private grenade(): void {
    if (this.ended) return;
    const inp = this.input2.state;
    const ok = throwGrenade(this, this.player, inp.aimX, inp.aimY, () => this.zombies, (n) => (this.kills += n));
    if (ok) {
      this.exp.addNoise(20);
      this.raiseAlarm();
    }
  }

  private medkit(): void {
    if (this.ended) return;
    useMedkit(this, this.player);
  }

  // ── 主迴圈 ──

  update(_t: number, deltaMs: number): void {
    if (this.ended) return;
    const dt = Math.min(deltaMs / 1000, 0.05) * this.fx.timeScale;
    const realDt = Math.min(deltaMs / 1000, 0.05);
    this.elapsed += dt;
    const inp = this.input2.update();
    const p = this.player;

    // 潛入中：近戰鍵先拿來暗殺
    if (!this.alerted) this.updateSleepers(dt);

    if (inp.selectWeapon >= 0) this.weapons.select(inp.selectWeapon);
    if (inp.nextWeapon) this.weapons.next();
    if (inp.reloadPressed && !this.melee.busy) this.weapons.reload();
    this.weapons.update(dt);
    if (inp.meleePressed && p.alive) {
      this.weapons.cancelReload();
      this.melee.trySwing(p);
    }
    const meleeRes = this.melee.update(dt, p, this.zombies);
    this.kills += meleeRes.kills;
    if (this.alerted) p.speedMul = this.weapons.active.def.moveMul;
    p.update(dt, inp.moveX, inp.moveY, inp.aimX, { minX: 20, maxX: WORLD_W - 16 });

    // 手上的武器先擺好姿勢，子彈從真正的槍口射出
    this.rig.setWeapon(this.weapons.active.def.id);
    const mp = this.melee.pose;
    this.rig.setMelee(mp ? { id: this.melee.def.id, ...mp } : null);
    this.updateRig(dt, inp.aimX, inp.aimY);
    const muzzleX = this.rig.muzzle.x;
    const muzzleY = this.rig.muzzle.y;
    this.noGunCooldown = Math.max(0, this.noGunCooldown - realDt);
    if (this.spec.meleeOnly) {
      if (inp.firePressed && this.noGunCooldown <= 0) {
        this.noGunCooldown = 1.2;
        const warn = pixelText(this, GAME_WIDTH / 2, 52, this.sys.game.device.input.touch ? '不能開槍！按「近戰」' : '不能開槍！用近戰（E／右鍵）', 9, '#ff8a80')
          .setOrigin(0.5, 0)
          .setScrollFactor(0)
          .setDepth(210)
          .setStroke('#000000', 3);
        this.tweens.add({ targets: warn, alpha: 0, delay: 700, duration: 400, onComplete: () => warn.destroy() });
      }
    } else {
      const shot = p.alive && !this.melee.busy
        ? this.weapons.tryFire(muzzleX, muzzleY, inp.aimX, inp.aimY, inp.fireHeld, inp.firePressed, this.zombies, p.moveFactor)
        : null;
      if (shot) {
        this.rig.fire();
        this.shotFeedback(muzzleX, muzzleY, shot.angle);
        this.kills += shot.kills;
        this.exp.addNoise(NOISE.perShot);
        // 潛入中開槍：全部驚醒
        this.raiseAlarm();
      }
    }
    const aimDist = Phaser.Math.Distance.Between(muzzleX, muzzleY, inp.aimX, inp.aimY);
    const climbY = Math.tan(Phaser.Math.DegToRad(this.weapons.climbDeg)) * Math.abs(inp.aimX - muzzleX);
    this.crosshair.update(realDt, inp.aimX, inp.aimY - climbY, this.weapons.spreadNow(p.moveFactor), aimDist, p.alive);
    this.screenFx.update(realDt, p.hp, p.maxHp);

    this.updateFollowers(dt);
    this.props.update(dt);
    this.props.collide(p);
    for (const z of this.zombies) if (!z.dead && z.spec.body !== 'crow') this.props.collide(z);
    this.interaction = p.alive ? this.props.nearestInteraction() : null;
    const it = this.interaction;
    this.interactHint.setVisible(!!it);
    if (it) {
      const touch = this.sys.game.device.input.touch;
      this.interactHint.setText(`${touch ? '互動' : 'F'}：${it.label}`).setPosition(it.prop.x, it.prop.y - it.prop.h - 12);
    }

    if (this.alerted) {
      const ctx = this.context();
      for (const z of this.zombies) z.update(dt, ctx);
      if (this.toSpawn > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = this.spawnEvery;
          this.toSpawn--;
          this.spawnEdge();
        }
      }
    }
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    for (let i = 0; i < this.zombies.length; i++) {
      for (let j = i + 1; j < this.zombies.length; j++) Zombie.separate(this.zombies[i], this.zombies[j]);
    }
    this.refreshHud();
    this.checkEnd();
  }

  private context(): ZombieContext {
    const others: ZombieTarget[] = [];
    for (const f of this.followers) {
      if (f.down) continue;
      others.push({ x: f.x, y: f.y, alive: true, hit: (d) => this.hurtFollower(f, d) });
    }
    const sv = this.survivor;
    if (sv && sv.hp > 0) {
      others.push({
        x: sv.x,
        y: sv.y,
        alive: true,
        hit: (d) => {
          sv.hp = Math.max(0, sv.hp - d);
          sv.bar(sv.hp / sv.maxHp);
          sv.img.setTintFill(0xffffff);
          this.time.delayedCall(60, () => (sv.img.texture.key === 'player' ? sv.img.setTint(0xd8c090) : sv.img.clearTint()));
        },
      });
    }
    others.push(...this.props.lureTargets());
    return {
      blockX: -100000,
      hitBlock: () => {},
      player: { x: this.player.footX, y: this.player.footY, alive: this.player.alive },
      hitPlayer: (d, fx, fy) => this.player.takeDamage(d, fx, fy),
      others,
      zombies: this.zombies,
      aggroRange: 4000,
    };
  }

  /** 隊員跟在主角身後；戰鬥中定時開槍援護 */
  private updateFollowers(dt: number): void {
    const p = this.player;
    for (const f of this.followers) {
      if (f.down) continue;
      const tx = p.footX + f.ox * p.facing;
      const ty = clampLaneY(p.footY + f.oy);
      f.x += (tx - f.x) * Math.min(1, dt * 3);
      f.y += (ty - f.y) * Math.min(1, dt * 3);
      const bob = Math.abs(Math.sin(this.elapsed * 8 + f.ox)) * Math.min(1, Math.abs(tx - f.x) / 10) * 1.5;
      f.img.setPosition(Math.round(f.x), Math.round(f.y - bob)).setDepth(depthForY(f.y));
      if (!this.alerted || this.spec.meleeOnly) {
        f.img.setFlipX(p.facing < 0);
        continue;
      }
      f.cd -= dt;
      const gun = COMPANION_ROLES[f.m.role].gun;
      let target: Zombie | null = null;
      let bestD = gun.range;
      for (const z of this.zombies) {
        if (z.dead) continue;
        const d = Math.hypot(z.footX - f.x, (z.footY - f.y) * 1.4);
        if (d < bestD) {
          bestD = d;
          target = z;
        }
      }
      if (target) f.img.setFlipX(target.footX < f.x);
      if (target && f.cd <= 0) {
        f.cd = 1 / gun.fireRate + 0.3;
        const head = this.rng.chance(gun.headChance + (f.m.attrs.aim - 3) * 0.05);
        const sx = f.x + (target.footX < f.x ? -12 : 12);
        const sy = f.y - 40;
        const ty2 = target.footY - (head ? 52 : 34) * (target.def.scale ?? 1);
        this.fx.bulletTracer(sx, sy, target.footX, ty2);
        this.fx.muzzleLight(sx, sy, 0.6);
        GameEvents.of(this).emit('ally:shoot', { role: f.m.role, x: sx, y: sy, angle: Math.atan2(ty2 - sy, target.footX - sx), weaponId: gun.weaponId });
        const killed = target.takeDamage(gun.damage * 1.6, gun.knockback, { headshot: head, dirX: Math.sign(target.footX - f.x) || 1 });
        if (killed) this.kills++;
        this.exp.addNoise(1);
      }
    }
  }

  private hurtFollower(f: Follower, d: number): void {
    const hp = Math.max(0, (this.exp.crewHp.get(f.m.id) ?? 0) - d);
    this.exp.crewHp.set(f.m.id, hp);
    f.img.setTintFill(0xffffff);
    this.time.delayedCall(60, () => (f.img.texture.key === 'player' ? f.img.setTint(COMPANION_ROLES[f.m.role].tint) : f.img.clearTint()));
    if (hp <= 0 && !f.down) {
      f.down = true;
      this.fx.popText(f.x, f.y - 60, `${f.m.name} 倒下了！`, '#ff8a80');
      this.tweens.add({ targets: f.img, angle: f.img.flipX ? 90 : -90, alpha: 0.6, duration: 300 });
      GameEvents.of(this).emit('ally:hurt', { name: f.m.name, role: f.m.role, amount: d, hp: 0, maxHp: COMPANION_ROLES[f.m.role].maxHp, x: f.x, y: f.y });
    }
  }

  private checkEnd(): void {
    const p = this.player;
    if (!p.alive) return this.finish('down');
    const s = this.spec;
    if (this.survivor && this.survivor.hp <= 0) return this.finish('failed');
    if (s.goal === 'reach' && p.footX >= EXIT_X - 10) return this.finish(this.alerted ? 'win' : 'clean');
    if (this.alerted && (s.goal === 'clear' || s.goal === 'reach') && this.zombies.length === 0 && this.toSpawn === 0) {
      return this.finish(s.mode === 'stealth' ? 'win' : 'win');
    }
    if ((s.goal === 'survive' || s.goal === 'protect') && this.elapsed >= (s.seconds ?? 25)) return this.finish('win');
  }

  private finish(result: FieldResult['result']): void {
    if (this.ended) return;
    this.ended = true;
    this.exp.hp = Math.max(0, this.player.hp);
    this.exp.kills += this.kills;
    this.weapons.unloadAll();
    const msg = { clean: '神不知鬼不覺', win: '任務完成', failed: '倖存者沒能撐住……', down: '你倒下了' }[result];
    const ok = result === 'clean' || result === 'win';
    const t = pixelText(this, GAME_WIDTH / 2, 140, msg, 16, ok ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setScrollFactor(0).setDepth(250).setStroke('#000000', 4);
    t.setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
    AudioManager.play(ok ? 'stinger_win' : 'stinger_lose');
    // 限時目標達成時，場上的霧屍退回霧裡
    for (const z of this.zombies) this.tweens.add({ targets: z, alpha: 0, duration: 600 });
    this.time.delayedCall(1300, () => {
      this.cameras.main.fadeOut(250, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const cb = this.onDone;
        const kills = this.kills;
        this.scene.stop();
        cb({ result, kills });
      });
    });
  }

  private wireFeedback(): void {
    const bus = GameEvents.of(this);
    bus.on('enemy:hit', (e) => this.crosshair.hit(e.headshot ? 'headshot' : e.killed ? 'kill' : 'hit'));
    bus.on('player:hurt', (e) => {
      const h = FEEL.hurt;
      const strength = Math.min(1, e.amount / 15);
      this.camFeel.addTrauma(h.trauma * (0.6 + 0.4 * strength));
      this.screenFx.hurt(strength);
      this.fx.freeze(h.hitStop);
      rumble(90, 0.5 + 0.5 * strength);
    });
    // 腫脹霧屍爆開：波及主角與其他霧屍
    bus.on('enemy:burst', (e) => {
      const inRange = (x: number, y: number) => Math.hypot(x - e.x, (y - e.y) * 1.6) <= e.radius;
      if (this.player.alive && inRange(this.player.footX, this.player.footY)) this.player.takeDamage(e.damage, e.x, e.y);
      this.camFeel.addTrauma(0.3);
      for (const z of this.zombies) if (!z.dead && inRange(z.footX, z.footY)) z.takeDamage(e.damage, 6, { dirX: Math.sign(z.footX - e.x) || 1, type: 'blast' });
    });
  }

  private shotFeedback(x: number, y: number, angle: number): void {
    const def: FirearmDef = this.weapons.active.def;
    this.camFeel.kick(angle, def.cameraKick);
    this.camFeel.addTrauma(def.trauma);
    this.crosshair.fired();
    this.fx.muzzleLight(x, y, def.pellets > 1 ? 1.3 : 1);
    if (def.selfKnockback > 0) this.player.push(-Math.cos(angle) * def.selfKnockback);
    if (def.cls !== 'revolver' && def.id !== 'coach' && !def.cycleSound) {
      const ej = this.rig.eject;
      this.fx.ejectShell(ej.x, ej.y, this.player.footY + 2, this.player.facing, shellKey(def));
    }
    this.fx.muzzleSmoke(x, y, angle);
  }

  /** 主角的武器姿勢：從肩膀指向瞄準點，角度限制在面向的前方 ±70°（同 DefenseScene） */
  private updateRig(dt: number, aimX: number, aimY: number): void {
    const p = this.player;
    const sx = p.footX + 3 * p.facing;
    const sy = p.footY - 35;
    let a = Math.atan2(aimY - sy, aimX - sx);
    const lim = Phaser.Math.DegToRad(70);
    if (p.facing > 0) a = Phaser.Math.Clamp(a, -lim, lim);
    else a = Math.PI + Phaser.Math.Clamp(Phaser.Math.Angle.Wrap(a - Math.PI), -lim, lim);
    this.rig.setVisible(p.alive);
    this.rig.update(dt, { footX: p.footX, footY: p.footY, facing: p.facing, aim: a, bob: p.bob, depth: p.sprite.depth });
  }

  /** 換彈、上膛的動作跟著武器系統的事件走 */
  private wireRig(): void {
    const bus = GameEvents.of(this);
    bus.on('player:reload-start', (e) => this.rig.startReload(e.duration, !!e.empty));
    bus.on('player:reload-round', (e) => this.rig.roundIn(!!e.clip));
    bus.on('player:reload-cancel', () => this.rig.endReload());
    bus.on('player:reload-end', () => this.rig.endReload());
    bus.on('player:rack', () => this.rig.rack());
    bus.on('player:cycle', (e) => {
      this.rig.cycle(e.delay);
      this.time.delayedCall((e.delay + 0.12) * 1000, () => {
        const ej = this.rig.eject;
        this.fx.ejectShell(ej.x, ej.y, this.player.footY + 2, this.player.facing, shellKey(this.weapons.active.def));
      });
    });
  }
}

function shellKey(def: FirearmDef): string {
  return def.ammo === '12ga' ? 'shell_12ga' : def.ammo === '556' || def.ammo === '762' ? 'shell_rifle' : 'shell_pistol';
}
