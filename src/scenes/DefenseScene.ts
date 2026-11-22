import Phaser from 'phaser';
import {
  DEPTH_FX,
  GAME_HEIGHT,
  GAME_WIDTH,
  GROUND_Y,
  LANE_BOTTOM,
  LANE_TOP,
  PLACEHOLDER_COLORS,
  WORLD_WIDTH,
} from '../config';
import { BuildMode } from '../build/BuildMode';
import { Outpost } from '../build/Outpost';
import { ECONOMY } from '../data/buildings';
import { buildNight } from '../data/waves';
import { BURST } from '../data/zombies';
import { prewarmLooks, rollZombie, scrapFor } from '../systems/ZombieFactory';
import { pixelText } from '../utils/text';
import { WEAPONS } from '../data/weapons';
import { Barricade } from '../entities/Barricade';
import { Player } from '../entities/Player';
import { Zombie, type ZombieContext } from '../entities/Zombie';
import { attachAudio } from '../audio/AudioBridge';
import { createAtmosphere } from '../fx/Atmosphere';
import { Fx } from '../fx/Fx';
import { CameraFeel } from '../feel/CameraFeel';
import { Crosshair } from '../feel/Crosshair';
import { FEEL } from '../feel/FeelConfig';
import { rumble } from '../feel/Haptics';
import { ScreenFeedback } from '../feel/ScreenFeedback';
import { GameEvents } from '../systems/GameEvents';
import { InputManager } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { WaveSpawner } from '../systems/WaveSpawner';
import { WeaponSystem } from '../systems/WeaponSystem';
import { CompanionSystem, type CompanionHud, type CompanionOrder } from '../systems/CompanionSystem';
import type { BuildUIData } from './BuildUIScene';
import type { GameOverData } from './GameOverScene';

/** 從結算畫面進來時帶的資料：newDay 代表撐過一夜、進入新的一天 */
export interface DefenseSceneData {
  newDay?: boolean;
}

/** 給 UIScene 讀的 HUD 資料 */
export interface HudData {
  playerHp: number;
  playerMaxHp: number;
  baseHp: number;
  baseMaxHp: number;
  barricadeHp: number;
  barricadeMaxHp: number;
  weaponName: string;
  ammo: number;
  magazine: number;
  reloading: boolean;
  reloadProgress: number;
  wave: number;
  totalWaves: number;
  kills: number;
  companions: CompanionHud[];
  companionOrder: CompanionOrder;
}

const BASE_X = 44;
const PLAYER_X = 80;
const BARRICADE_X = 160;
const PLAYER_MAX_HP = 100;

/**
 * 一天的流程：先是白天布置（在槽位上蓋建築、修理路障），按「開始夜晚」後進入夜晚防守。
 * 夜晚防守：2.5D 帶狀戰場。主角可在地面帶上前後左右移動，
 * 也能翻出路障外迎擊（風險自負）；鏡頭跟著主角水平捲動。
 */
export class DefenseScene extends Phaser.Scene {
  private input2!: InputManager;
  private weapons!: WeaponSystem;
  private spawner!: WaveSpawner;
  private barricade!: Barricade;
  private player!: Player;
  private companions!: CompanionSystem;
  private zombies: Zombie[] = [];
  private kills = 0;
  private headshots = 0;
  private ended = false;
  private fx!: Fx;
  private wasReloading = false;
  private phase: 'day' | 'night' = 'day';
  private outpost!: Outpost;
  private build!: BuildMode;
  private dusk?: Phaser.GameObjects.Rectangle;
  /** 今晚賺到的廢料（擊殺＋撐過的獎勵），結算畫面顯示 */
  private scrapEarned = 0;
  private camFeel!: CameraFeel;
  private crosshair!: Crosshair;
  private screenFx!: ScreenFeedback;

  constructor() {
    super('Defense');
  }

  create(data: DefenseSceneData = {}): void {
    this.zombies = [];
    this.kills = 0;
    this.headshots = 0;
    this.ended = false;
    this.phase = 'day';
    this.scrapEarned = 0;

    // 先設好世界範圍：Fx 的地面血跡畫布依鏡頭範圍決定大小
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.drawBackdrop();
    this.fx = Fx.attach(this);
    this.camFeel = CameraFeel.attach(this);
    // 貼地霧放在地面帶中段，燈掛在據點外牆上
    createAtmosphere(this, { groundY: LANE_TOP + 14, lamp: { x: BASE_X - 6, y: GROUND_Y - 70 } });

    const st = GameState.data;
    this.barricade = new Barricade(this, BARRICADE_X, st.barricadeMaxHp);
    // 據點建築與路障耐久從 GameState 還原（跨夜保留）
    this.outpost = new Outpost(this, this.barricade);
    this.build = new BuildMode(this, this.outpost, { barricadeX: BARRICADE_X, baseX: BASE_X });
    this.player = new Player(this, PLAYER_X, (LANE_TOP + LANE_BOTTOM) / 2, PLAYER_MAX_HP);

    // 戰場比畫面寬：鏡頭跟著主角水平捲動，中間留一段不跟的死區
    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0);
    cam.setDeadzone(160, GAME_HEIGHT);
    cam.setFollowOffset(-90, 0);
    this.fx.attachShadow(this.player.sprite, 22);

    this.screenFx = new ScreenFeedback(this);
    this.wireFeedback();
    // 音效：訂閱 GameEvents，依鏡頭位置做左右聲道（見 src/audio/、docs/AUDIO.md）
    attachAudio(this);

    // NPC 夥伴：白天就站在固守位置，入夜才開始行動
    this.companions = new CompanionSystem(this, {
      minX: BASE_X + 14,
      maxX: WORLD_WIDTH - 16,
      barricadeX: BARRICADE_X,
    });
    this.weapons = new WeaponSystem(this, WEAPONS);
    const night = buildNight(GameState.data.day);
    prewarmLooks(this, night.flatMap((w) => w.groups.map((g) => g.enemy)));
    this.spawner = new WaveSpawner(this, night, (id) => this.spawnZombie(id));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop('UI');
      this.scene.stop('BuildUI');
    });
    this.startDay(!!data.newDay);
  }

  /** 白天：布置據點。新的一天先入帳白天搜刮的廢料 */
  private startDay(newDay: boolean): void {
    this.phase = 'day';
    // 黃昏的暖色濾鏡，入夜時淡掉
    this.dusk = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xff9a4a, 0.1).setOrigin(0).setScrollFactor(0).setDepth(89);
    this.build.enter();
    const data: BuildUIData = { mode: this.build, onStartNight: () => this.startNight() };
    this.scene.launch('BuildUI', data);
    if (newDay) {
      GameState.data.scrap += ECONOMY.dailySalvage;
      // 白天探索做好之前，用固定收入代替搜刮
      this.time.delayedCall(300, () => {
        this.fx.popText(PLAYER_X, LANE_TOP - 40, `白天搜刮 +${ECONOMY.dailySalvage} 廢料`, '#f5d76e');
        this.build.events.emit('changed');
      });
    }
  }

  /** 入夜：收起布置介面，開始出怪 */
  private startNight(): void {
    if (this.phase === 'night' || this.ended) return;
    this.phase = 'night';
    this.build.exit();
    this.outpost.persist();
    GameState.save();
    this.scene.stop('BuildUI');
    if (this.dusk) this.tweens.add({ targets: this.dusk, alpha: 0, duration: 800, onComplete: () => this.dusk?.destroy() });
    // 輸入在入夜時才接上，白天點槽位不會變成第一發子彈
    this.input2 = new InputManager(this);
    // 準星會隱藏滑鼠游標，白天要點槽位，所以入夜才建立
    this.crosshair = new Crosshair(this);
    this.spawner.start();
    this.companions.active = true;
    this.scene.launch('UI');
  }

  private drawBackdrop(): void {
    // 天空固定不捲動
    this.add.rectangle(0, 0, GAME_WIDTH, GROUND_Y, PLACEHOLDER_COLORS.sky).setOrigin(0).setScrollFactor(0);
    // 遠方的灰霧帶：視差捲動，越遠越慢
    for (let i = 0; i < 3; i++) {
      this.add
        .rectangle(0, GROUND_Y - 70 + i * 18, WORLD_WIDTH, 30, PLACEHOLDER_COLORS.fog, 0.06 + i * 0.03)
        .setOrigin(0)
        .setScrollFactor(0.3 + i * 0.2);
    }
    // 遠景廢墟剪影
    const rng = new Phaser.Math.RandomDataGenerator(['outpost']);
    for (let x = 0; x < WORLD_WIDTH; x += rng.between(40, 90)) {
      const h = rng.between(20, 60);
      this.add.rectangle(x, GROUND_Y, rng.between(24, 50), h, 0x232831).setOrigin(0, 1).setScrollFactor(0.6);
    }
    // 地面帶：越近越亮一點，做出縱深
    const bands = 6;
    const bandH = (GAME_HEIGHT - GROUND_Y) / bands;
    for (let i = 0; i < bands; i++) {
      const c = Phaser.Display.Color.IntegerToColor(PLACEHOLDER_COLORS.ground).lighten(i * 2).color;
      this.add.rectangle(0, GROUND_Y + i * bandH, WORLD_WIDTH, bandH + 1, c).setOrigin(0);
    }
    // 地上的碎石與裂痕，捲動時才看得出在移動
    for (let n = 0; n < 90; n++) {
      const y = rng.between(GROUND_Y + 4, GAME_HEIGHT - 2);
      const near = (y - GROUND_Y) / (GAME_HEIGHT - GROUND_Y);
      this.add
        .rectangle(rng.between(0, WORLD_WIDTH), y, 2 + near * 6, 1 + Math.round(near), 0x1c1f25, 0.8)
        .setOrigin(0.5);
    }
    // 據點外牆與射擊平台（整條地面帶都被外牆擋住）
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, GAME_HEIGHT - GROUND_Y + 84, 0x3d4450).setOrigin(0);
    this.add.rectangle(BASE_X, GROUND_Y, 6, GAME_HEIGHT - GROUND_Y, 0x555d6b).setOrigin(0);
  }

  private spawnZombie(id: string): void {
    if (this.ended) return;
    // 職業＋隨機外觀＋變異（見 src/systems/ZombieFactory.ts）
    const spec = rollZombie(this, id, GameState.data.day);
    // 在鏡頭右緣外生成，主角在據點附近時節奏不會被拉長
    const right = Math.min(WORLD_WIDTH, this.cameras.main.scrollX + GAME_WIDTH);
    const x = right + 20 + Phaser.Math.Between(0, 20);
    const y = Phaser.Math.Between(LANE_TOP, LANE_BOTTOM);
    this.zombies.push(new Zombie(this, x, y, spec));
    this.introduce(spec.profession.id);
  }

  /** 第一次遇到某個職業時，畫面上方介紹一下牠的特性 */
  private introduce(id: string): void {
    const st = GameState.data;
    st.seenZombies ??= [];
    if (st.seenZombies.includes(id)) return;
    st.seenZombies.push(id);
    if (id === 'basic') return;
    const p = this.zombies[this.zombies.length - 1].spec.profession;
    const t1 = pixelText(this, GAME_WIDTH / 2, 62, `新威脅：${p.name}`, 10, '#ff8a6a').setOrigin(0.5);
    const t2 = pixelText(this, GAME_WIDTH / 2, 78, p.blurb, 8, '#e0e0e0').setOrigin(0.5);
    for (const t of [t1, t2]) {
      t.setScrollFactor(0).setDepth(200).setStroke('#000000', 3).setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 200, hold: 3200, yoyo: true, onComplete: () => t.destroy() });
    }
  }

  /** 腫脹霧屍與「爆裂」變異爆開：波及主角、夥伴、擋路線與其他霧屍（可以連鎖引爆） */
  private onBurst(e: { x: number; y: number; radius: number; damage: number }): void {
    const inRange = (x: number, y: number) => Math.hypot(x - e.x, (y - e.y) * 1.6) <= e.radius;
    if (this.player.alive && inRange(this.player.footX, this.player.footY)) this.player.takeDamage(e.damage, e.x, e.y);
    for (const t of this.companions.targets()) if (t.alive && inRange(t.x, t.y)) t.hit(e.damage, e.x, e.y);
    const ctx = this.zombieContext();
    if (Math.abs(e.x - ctx.blockX) <= e.radius) ctx.hitBlock(e.damage, e.y);
    this.camFeel.addTrauma(0.3);
    // 連鎖引爆稍微錯開，看得出一顆接一顆
    const victims = this.zombies.filter((z) => !z.dead && inRange(z.footX, z.footY));
    this.time.delayedCall(90, () => {
      for (const z of victims) {
        if (z.dead || !z.active) continue;
        const killed = z.takeDamage(e.damage * BURST.zombieMul, 6, { dirX: Math.sign(z.footX - e.x) || 1, type: 'blast' });
        if (killed) this.kills++;
      }
    });
  }

  /** 霧屍要攻擊的擋路線：路障還在就是路障，否則是據點外牆；前面有沙包牆時先拆沙包 */
  private zombieContext(): ZombieContext {
    const blocker = this.barricade.alive
      ? {
          blockX: this.barricade.frontX,
          hitBlock: (d: number, y: number) => {
            this.barricade.takeDamage(d, y);
            const bx = this.barricade.frontX;
            GameEvents.of(this).emit('barricade:hit', { damage: d, y, hp: this.barricade.hp, maxHp: this.barricade.maxHp, x: bx });
            if (!this.barricade.alive) GameEvents.of(this).emit('barricade:break', { x: bx });
          },
        }
      : {
          blockX: BASE_X,
          hitBlock: (d: number) => {
            const st = GameState.data;
            st.baseHp = Math.max(0, st.baseHp - d);
            GameEvents.of(this).emit('base:hit', { damage: d, hp: st.baseHp, maxHp: st.baseMaxHp, x: BASE_X });
          },
        };
    const minFront = blocker.blockX;
    return {
      ...blocker,
      blockerFor: (x, y) => this.outpost.blockerFor(x, y, minFront),
      speedMul: (x, y) => this.outpost.speedMul(x, y),
      player: { x: this.player.footX, y: this.player.footY, alive: this.player.alive },
      // 受擊回饋（震動、紅邊、卡肉）在 wireFeedback() 裡訂閱 player:hurt
      hitPlayer: (d, fromX, fromY) => this.player.takeDamage(d, fromX, fromY),
      others: this.companions.targets(),
      zombies: this.zombies,
    };
  }

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    // 卡肉（hit-stop）期間 timeScale 為 0，整個戰場停頓一下
    const dt = Math.min(deltaMs / 1000, 0.05) * this.fx.timeScale;
    if (this.phase === 'day') {
      this.build.update(dt);
      return;
    }
    const inp = this.input2.update();

    // 武器
    if (inp.selectWeapon >= 0) this.weapons.select(inp.selectWeapon);
    if (inp.nextWeapon) this.weapons.next();
    if (inp.reloadPressed) this.weapons.reload();
    this.weapons.update(dt);
    this.animateReload();

    // 主角移動：據點外牆內側到戰場右緣
    this.player.update(dt, inp.moveX, inp.moveY, inp.aimX, { minX: BASE_X + 14, maxX: WORLD_WIDTH - 16 });

    const p = this.player;
    const angle = Phaser.Math.Angle.Between(p.gunX, p.gunY, inp.aimX, inp.aimY);
    const muzzleX = p.gunX + Math.cos(angle) * 14;
    const muzzleY = p.gunY + Math.sin(angle) * 14;
    const shot = p.alive
      ? this.weapons.tryFire(muzzleX, muzzleY, inp.aimX, inp.aimY, inp.fireHeld, inp.firePressed, this.zombies, p.moveFactor)
      : null;
    if (shot) {
      this.playShotFeedback(muzzleX, muzzleY, angle);
      this.kills += shot.kills;
      this.headshots += shot.headshots;
    }
    // 準星與畫面回饋用真實時間，卡肉時照樣更新
    const realDt = Math.min(deltaMs / 1000, 0.05);
    const aimDist = Phaser.Math.Distance.Between(muzzleX, muzzleY, inp.aimX, inp.aimY);
    this.crosshair.update(realDt, inp.aimX, inp.aimY, this.weapons.spreadNow(p.moveFactor), aimDist, p.alive);
    this.screenFx.update(realDt, p.hp, p.maxHp);

    // NPC 夥伴
    const ally = this.companions.update(
      dt,
      {
        footX: p.footX,
        footY: p.footY,
        facing: p.facing,
        alive: p.alive,
        hp: p.hp,
        maxHp: p.maxHp,
        heal: (a) => p.heal(a),
      },
      this.zombies,
      this.barricade,
    );
    this.kills += ally.kills;
    this.headshots += ally.headshots;

    // 敵人
    const ctx = this.zombieContext();
    for (const z of this.zombies) z.update(dt, ctx);
    // 陷阱與砲塔
    this.kills += this.outpost.update(dt, this.zombies);
    this.collectScrap();
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    for (let i = 0; i < this.zombies.length; i++) {
      for (let j = i + 1; j < this.zombies.length; j++) Zombie.separate(this.zombies[i], this.zombies[j]);
    }
    this.spawner.update(this.zombies.length);

    this.events.emit('hud', this.hud());

    // 勝負
    if (GameState.data.baseHp <= 0) this.finish(false, 'base');
    else if (!this.player.alive) this.finish(false, 'player');
    else if (this.spawner.done && this.zombies.length === 0) this.finish(true);
  }

  /** 這一幀倒下的霧屍掉落廢料（不論是誰打死的），在屍體上方跳字 */
  private collectScrap(): void {
    for (const z of this.zombies) {
      if (!z.dead) continue;
      const n = scrapFor(z.spec);
      if (n <= 0) continue;
      GameState.data.scrap += n;
      this.scrapEarned += n;
      this.fx.popText(z.footX, z.footY - 56 * (z.def.scale ?? 1), `+${n}`, '#f5d76e');
    }
  }

  /** 換彈開始時播放換彈影格，長度對齊武器的換彈時間；換完回到射擊圖 */
  private animateReload(): void {
    const reloading = this.weapons.reloading;
    if (reloading && !this.wasReloading && this.anims.exists('player_reload')) {
      this.player.sprite.play({ key: 'player_reload', duration: this.weapons.active.def.reloadTime * 1000 });
    } else if (!reloading && this.wasReloading && this.player.sprite.texture.key === 'player_reload') {
      this.player.sprite.stop();
      this.player.sprite.setTexture('player', 0);
    }
    this.wasReloading = reloading;
  }

  /**
   * 把遊戲事件接到畫面回饋上。音效、NPC 等其他系統也用同樣方式訂閱 GameEvents。
   */
  private wireFeedback(): void {
    const bus = GameEvents.of(this);
    bus.on('enemy:burst', (e) => this.onBurst(e));
    bus.on('enemy:hit', (e) => this.crosshair.hit(e.headshot ? 'headshot' : e.killed ? 'kill' : 'hit'));
    bus.on('player:hurt', (e) => {
      const h = FEEL.hurt;
      const strength = Math.min(1, e.amount / 15);
      this.camFeel.addTrauma(h.trauma * (0.6 + 0.4 * strength));
      this.screenFx.hurt(strength);
      this.fx.freeze(h.hitStop);
      rumble(90, 0.5 + 0.5 * strength);
    });
    bus.on('player:death', () => {
      this.camFeel.addTrauma(0.8);
      rumble(300, 1);
    });
    bus.on('base:hit', () => this.camFeel.addTrauma(0.22));
    bus.on('barricade:hit', () => this.camFeel.addTrauma(0.05));
    bus.on('player:heartbeat', () => rumble(30, 0.25));
  }

  /** 開槍回饋：鏡頭後頓、震動、槍口閃光照亮、拋殼、槍口煙、後座力 */
  private playShotFeedback(x: number, y: number, angle: number): void {
    const def = this.weapons.active.def;
    this.camFeel.kick(angle, def.cameraKick);
    this.camFeel.addTrauma(def.trauma);
    this.crosshair.fired();
    this.fx.muzzleLight(x, y, def.pellets > 1 ? 1.3 : 1);
    if (def.selfKnockback > 0) this.player.push(-Math.cos(angle) * def.selfKnockback);
    if (def.rumbleMs > 0) rumble(def.rumbleMs, 0.6);
    // 拋殼 + 槍口煙（程式化粒子，見 src/fx/Fx.ts）
    this.fx.ejectShell(this.player.footX + 4 * this.player.facing, y - 2, this.player.footY + 2, this.player.facing);
    this.fx.muzzleSmoke(x, y, angle);
    if (this.anims.exists('player_shoot')) {
      // 有開火影格時，火光與後座力都由動畫表現
      this.player.sprite.play('player_shoot');
      return;
    }
    this.player.kick();
    const flash = this.add.circle(x, y, 4, 0xfff3a0).setDepth(DEPTH_FX + 2);
    this.tweens.add({ targets: flash, scale: 0.2, alpha: 0, duration: 70, onComplete: () => flash.destroy() });
  }

  private hud(): HudData {
    const w = this.weapons.active;
    const st = GameState.data;
    return {
      playerHp: this.player.hp,
      playerMaxHp: this.player.maxHp,
      baseHp: st.baseHp,
      baseMaxHp: st.baseMaxHp,
      barricadeHp: this.barricade.hp,
      barricadeMaxHp: this.barricade.maxHp,
      weaponName: w.def.name,
      ammo: w.ammo,
      magazine: w.def.magazine,
      reloading: this.weapons.reloading,
      reloadProgress: this.weapons.reloadProgress,
      wave: Math.max(1, this.spawner.waveIndex + 1),
      totalWaves: this.spawner.totalWaves,
      kills: this.kills,
      companions: this.companions.hud(),
      companionOrder: this.companions.order,
    };
  }

  private finish(survived: boolean, reason: GameOverData['reason'] = 'base'): void {
    this.ended = true;
    this.outpost.persist();
    GameEvents.of(this).emit('game:over', { survived });
    if (survived) {
      GameState.data.scrap += ECONOMY.nightBonus;
      this.scrapEarned += ECONOMY.nightBonus;
      // 拾荒好手：多帶回一點廢料
      for (const b of this.companions.scavengeBonus()) {
        GameState.data.scrap += b.amount;
        this.scrapEarned += b.amount;
      }
      GameState.data.day += 1;
      GameState.save();
    }
    const data: GameOverData = {
      survived,
      reason,
      kills: this.kills,
      headshots: this.headshots,
      scrapEarned: this.scrapEarned,
    };
    this.time.delayedCall(800, () => this.scene.start('GameOver', data));
  }
}
