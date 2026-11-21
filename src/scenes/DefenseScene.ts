import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, GROUND_Y, PLACEHOLDER_COLORS } from '../config';
import { ENEMIES } from '../data/enemies';
import { NIGHT_ONE } from '../data/waves';
import { WEAPONS } from '../data/weapons';
import { Barricade } from '../entities/Barricade';
import { Zombie, type ZombieTarget } from '../entities/Zombie';
import { InputManager } from '../input/InputManager';
import { GameState } from '../state/GameState';
import { WaveSpawner } from '../systems/WaveSpawner';
import { WeaponSystem } from '../systems/WeaponSystem';
import type { GameOverData } from './GameOverScene';

/** 給 UIScene 讀的 HUD 資料 */
export interface HudData {
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
const PLAYER_X = 74;
const BARRICADE_X = 148;
const SPAWN_X = GAME_WIDTH + 20;

/** 夜晚防守：固定鏡頭，守住路障與據點直到天亮。 */
export class DefenseScene extends Phaser.Scene {
  private input2!: InputManager;
  private weapons!: WeaponSystem;
  private spawner!: WaveSpawner;
  private barricade!: Barricade;
  private gun!: Phaser.GameObjects.Rectangle;
  private zombies: Zombie[] = [];
  private kills = 0;
  private headshots = 0;
  private ended = false;

  constructor() {
    super('Defense');
  }

  create(): void {
    this.zombies = [];
    this.kills = 0;
    this.headshots = 0;
    this.ended = false;

    this.drawBackdrop();

    const st = GameState.data;
    this.barricade = new Barricade(this, BARRICADE_X, st.barricadeMaxHp);
    this.add.image(PLAYER_X, GROUND_Y - 8, 'player').setOrigin(0.5, 1).setDepth(10);
    this.gun = this.add.rectangle(PLAYER_X + 2, GROUND_Y - 38, 16, 3, 0x222222).setOrigin(0, 0.5).setDepth(11);

    this.input2 = new InputManager(this);
    this.weapons = new WeaponSystem(this, WEAPONS);
    this.spawner = new WaveSpawner(this, NIGHT_ONE, (id) => this.spawnZombie(id));
    this.spawner.start();

    this.scene.launch('UI');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scene.stop('UI'));
  }

  private drawBackdrop(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GROUND_Y, PLACEHOLDER_COLORS.sky).setOrigin(0);
    // 遠方的灰霧帶
    for (let i = 0; i < 3; i++) {
      this.add
        .rectangle(0, GROUND_Y - 70 + i * 18, GAME_WIDTH, 30, PLACEHOLDER_COLORS.fog, 0.06 + i * 0.03)
        .setOrigin(0);
    }
    this.add.rectangle(0, GROUND_Y, GAME_WIDTH, GAME_HEIGHT - GROUND_Y, PLACEHOLDER_COLORS.ground).setOrigin(0);
    // 據點外牆與射擊平台
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, 84, 0x3d4450).setOrigin(0);
    this.add.rectangle(BASE_X, GROUND_Y - 8, 52, 8, 0x555d6b).setOrigin(0);
  }

  private spawnZombie(id: string): void {
    if (this.ended) return;
    const def = ENEMIES[id];
    if (!def) return;
    const z = new Zombie(this, SPAWN_X + Phaser.Math.Between(0, 20), def);
    z.setDepth(5 + Math.random());
    this.zombies.push(z);
  }

  /** 依路障是否還在，決定敵人要攻擊路障還是據點 */
  private currentTarget(): ZombieTarget {
    if (this.barricade.alive) {
      return { frontX: this.barricade.frontX, hit: (d) => this.barricade.takeDamage(d) };
    }
    return {
      frontX: BASE_X,
      hit: (d) => {
        GameState.data.baseHp = Math.max(0, GameState.data.baseHp - d);
        this.cameras.main.shake(80, 0.006);
      },
    };
  }

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    const dt = Math.min(deltaMs / 1000, 0.05);
    const inp = this.input2.update();

    // 武器
    if (inp.selectWeapon >= 0) this.weapons.select(inp.selectWeapon);
    if (inp.nextWeapon) this.weapons.next();
    if (inp.reloadPressed) this.weapons.reload();
    this.weapons.update(dt);

    const angle = Phaser.Math.Angle.Between(this.gun.x, this.gun.y, inp.aimX, inp.aimY);
    this.gun.setRotation(angle);
    const muzzleX = this.gun.x + Math.cos(angle) * 16;
    const muzzleY = this.gun.y + Math.sin(angle) * 16;
    const shot = this.weapons.tryFire(muzzleX, muzzleY, inp.aimX, inp.aimY, inp.fireHeld, inp.firePressed, this.zombies);
    if (shot) {
      this.kills += shot.kills;
      this.headshots += shot.headshots;
    }

    // 敵人
    const target = this.currentTarget();
    for (const z of this.zombies) z.update(dt, target);
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    this.spawner.update(this.zombies.length);

    this.events.emit('hud', this.hud());

    // 勝負
    if (GameState.data.baseHp <= 0) this.finish(false);
    else if (this.spawner.done && this.zombies.length === 0) this.finish(true);
  }

  private hud(): HudData {
    const w = this.weapons.active;
    const st = GameState.data;
    return {
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

  private finish(survived: boolean): void {
    this.ended = true;
    if (survived) {
      GameState.data.day += 1;
      GameState.save();
    }
    const data: GameOverData = { survived, kills: this.kills, headshots: this.headshots };
    this.time.delayedCall(800, () => this.scene.start('GameOver', data));
  }
}
