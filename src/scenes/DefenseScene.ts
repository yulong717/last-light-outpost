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
import { ENEMIES } from '../data/enemies';
import { NIGHT_ONE } from '../data/waves';
import { WEAPONS } from '../data/weapons';
import { Barricade } from '../entities/Barricade';
import { Player } from '../entities/Player';
import { Zombie, type ZombieContext } from '../entities/Zombie';
import { createAtmosphere } from '../fx/Atmosphere';
import { Fx } from '../fx/Fx';
import { InputManager } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { WaveSpawner } from '../systems/WaveSpawner';
import { WeaponSystem } from '../systems/WeaponSystem';
import type { GameOverData } from './GameOverScene';

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
}

const BASE_X = 44;
const PLAYER_X = 92;
const BARRICADE_X = 160;
const PLAYER_MAX_HP = 100;

/**
 * 夜晚防守：2.5D 帶狀戰場。主角可在地面帶上前後左右移動，
 * 也能翻出路障外迎擊（風險自負）；鏡頭跟著主角水平捲動。
 */
export class DefenseScene extends Phaser.Scene {
  private input2!: InputManager;
  private weapons!: WeaponSystem;
  private spawner!: WaveSpawner;
  private barricade!: Barricade;
  private player!: Player;
  private zombies: Zombie[] = [];
  private kills = 0;
  private headshots = 0;
  private ended = false;
  private fx!: Fx;
  private wasReloading = false;

  constructor() {
    super('Defense');
  }

  create(): void {
    this.zombies = [];
    this.kills = 0;
    this.headshots = 0;
    this.ended = false;

    // 先設好世界範圍：Fx 的地面血跡畫布依鏡頭範圍決定大小
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    this.drawBackdrop();
    this.fx = Fx.attach(this);
    // 貼地霧放在地面帶中段，燈掛在據點外牆上
    createAtmosphere(this, { groundY: LANE_TOP + 14, lamp: { x: BASE_X - 6, y: GROUND_Y - 70 } });

    const st = GameState.data;
    this.barricade = new Barricade(this, BARRICADE_X, st.barricadeMaxHp);
    this.player = new Player(this, PLAYER_X, (LANE_TOP + LANE_BOTTOM) / 2, PLAYER_MAX_HP);

    // 戰場比畫面寬：鏡頭跟著主角水平捲動，中間留一段不跟的死區
    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0);
    cam.setDeadzone(160, GAME_HEIGHT);
    cam.setFollowOffset(-90, 0);
    this.fx.attachShadow(this.player.sprite, 22);

    this.input2 = new InputManager(this);
    this.weapons = new WeaponSystem(this, WEAPONS);
    this.spawner = new WaveSpawner(this, NIGHT_ONE, (id) => this.spawnZombie(id));
    this.spawner.start();

    this.scene.launch('UI');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('UI'));
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
    const def = ENEMIES[id];
    if (!def) return;
    // 在鏡頭右緣外生成，主角在據點附近時節奏不會被拉長
    const right = Math.min(WORLD_WIDTH, this.cameras.main.scrollX + GAME_WIDTH);
    const x = right + 20 + Phaser.Math.Between(0, 20);
    const y = Phaser.Math.Between(LANE_TOP, LANE_BOTTOM);
    this.zombies.push(new Zombie(this, x, y, def));
  }

  /** 霧屍要攻擊的擋路線：路障還在就是路障，否則是據點外牆 */
  private zombieContext(): ZombieContext {
    const blocker = this.barricade.alive
      ? { blockX: this.barricade.frontX, hitBlock: (d: number, y: number) => this.barricade.takeDamage(d, y) }
      : {
          blockX: BASE_X,
          hitBlock: (d: number) => {
            GameState.data.baseHp = Math.max(0, GameState.data.baseHp - d);
            this.cameras.main.shake(80, 0.006);
          },
        };
    return {
      ...blocker,
      player: { x: this.player.footX, y: this.player.footY, alive: this.player.alive },
      hitPlayer: (d) => {
        if (this.player.takeDamage(d)) this.cameras.main.shake(60, 0.004);
      },
    };
  }

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    // 卡肉（hit-stop）期間 timeScale 為 0，整個戰場停頓一下
    const dt = Math.min(deltaMs / 1000, 0.05) * this.fx.timeScale;
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
      ? this.weapons.tryFire(muzzleX, muzzleY, inp.aimX, inp.aimY, inp.fireHeld, inp.firePressed, this.zombies)
      : null;
    if (shot) {
      this.playShotFeedback(muzzleX, muzzleY, angle);
      this.kills += shot.kills;
      this.headshots += shot.headshots;
    }

    // 敵人
    const ctx = this.zombieContext();
    for (const z of this.zombies) z.update(dt, ctx);
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

  /** 開槍回饋：後座力往後頓一下＋槍口火光 */
  private playShotFeedback(x: number, y: number, angle: number): void {
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
    };
  }

  private finish(survived: boolean, reason: GameOverData['reason'] = 'base'): void {
    this.ended = true;
    if (survived) {
      GameState.data.day += 1;
      GameState.save();
    }
    const data: GameOverData = { survived, reason, kills: this.kills, headshots: this.headshots };
    this.time.delayedCall(800, () => this.scene.start('GameOver', data));
  }
}
