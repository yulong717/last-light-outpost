import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  GROUND_Y,
  LANE_BOTTOM,
  LANE_TOP,
  WORLD_WIDTH,
} from '../config';
import { BuildMode } from '../build/BuildMode';
import { Outpost } from '../build/Outpost';
import { ECONOMY } from '../data/buildings';
import { buildNight } from '../data/waves';
import { BURST } from '../data/zombies';
import { prewarmLooks, scrapFor, spawnEnemy } from '../systems/ZombieFactory';
import { pixelText } from '../utils/text';
import type { FirearmDef } from '../data/weapons';
import { MeleeSystem } from '../systems/MeleeSystem';
import { WeaponRig } from '../entities/WeaponRig';
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
import { EXPLORE_TIME, getZone } from '../data/explore';
import { deployedCrew } from '../data/companions';
import { HeroSystem, type HeroHud } from '../systems/HeroSystem';
import { LUCK } from '../data/heroes';
import { PROLOGUES } from '../data/story';
import type { StoryData } from './StoryScene';
import { throwGrenade, useMedkit } from '../explore/Supplies';
import { describeLoot } from '../explore/Expedition';
import { AMMO } from '../data/weapons';
import { getFirearm } from '../data/weapons';
import { PropSystem } from '../scenery/PropSystem';
import { outpostScenery } from '../scenery/locations';
import type { SceneryResult } from '../scenery/SceneryBuilder';
import { ZombieDrops } from '../systems/ZombieDrops';
import { RescueEvent } from '../systems/RescueEvent';

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
  weaponId: string;
  weaponModel: string;
  ammo: number;
  magazine: number;
  /** 備彈（Infinity = 無限） */
  reserve: number;
  /** 帶上場的槍（1/2/3 鍵）與目前拿的是第幾把 */
  slots: string[];
  slot: number;
  meleeName: string;
  /** 體力 0..1 */
  stamina: number;
  meleeBusy: boolean;
  reloading: boolean;
  reloadProgress: number;
  wave: number;
  totalWaves: number;
  kills: number;
  companions: CompanionHud[];
  companionOrder: CompanionOrder;
  /** 主角技能與糾纏狀態 */
  hero?: HeroHud;
}

const BASE_X = 44;
const PLAYER_X = 80;
const BARRICADE_X = 160;

/**
 * 一天的流程：先是白天布置（在槽位上蓋建築、修理路障），按「開始夜晚」後進入夜晚防守。
 * 夜晚防守：2.5D 帶狀戰場。主角可在地面帶上前後左右移動，
 * 也能翻出路障外迎擊（風險自負）；鏡頭跟著主角水平捲動。
 */
export class DefenseScene extends Phaser.Scene {
  private input2!: InputManager;
  private weapons!: WeaponSystem;
  private melee!: MeleeSystem;
  private heroSys?: HeroSystem;
  private spawner!: WaveSpawner;
  private barricade!: Barricade;
  private player!: Player;
  private companions!: CompanionSystem;
  private zombies: Zombie[] = [];
  private kills = 0;
  private headshots = 0;
  private ended = false;
  private fx!: Fx;
  /** 主角手上的武器（手臂、槍、換彈動作） */
  private rig!: WeaponRig;
  private phase: 'day' | 'night' = 'day';
  private outpost!: Outpost;
  private build!: BuildMode;
  private dusk?: Phaser.GameObjects.Rectangle;
  /** 今晚賺到的廢料（擊殺＋撐過的獎勵），結算畫面顯示 */
  private scrapEarned = 0;
  private camFeel!: CameraFeel;
  private crosshair!: Crosshair;
  private screenFx!: ScreenFeedback;
  private scenery!: SceneryResult;
  /** 戰場上的油桶、車、木箱、路燈 */
  private props!: PropSystem;
  /** 職業霧屍的掉落物（src/systems/ZombieDrops.ts） */
  private drops!: ZombieDrops;
  /** 夜裡隨機的拯救倖存者事件（入夜才建立） */
  private rescue?: RescueEvent;

  constructor() {
    super('Defense');
  }

  create(data: DefenseSceneData = {}): void {
    this.zombies = [];
    this.rescue = undefined;
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
    this.player = new Player(this, PLAYER_X, (LANE_TOP + LANE_BOTTOM) / 2, GameState.hero.maxHp);
    this.props = new PropSystem(this, {
      player: this.player,
      zombies: () => this.zombies,
      others: () => this.companions?.targets() ?? [],
      onKill: (n) => (this.kills += n),
      onLoot: (loot, x, y) => {
        GameState.addLoot(loot);
        this.fx.popText(x, y - 10, describeLoot(loot).join(' '), '#f5d76e');
      },
      rollLoot: () => this.crateLoot(),
    }, this.scenery);

    this.drops = new ZombieDrops(this, {
      heal: (a) => this.player.heal(a),
      repair: (a) => (this.barricade.alive ? this.barricade.repair(a) : 0),
    });

    // 戰場比畫面寬：鏡頭跟著主角水平捲動，中間留一段不跟的死區
    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0);
    cam.setDeadzone(160, GAME_HEIGHT);
    cam.setFollowOffset(-90, 0);
    this.fx.attachShadow(this.player.sprite, 22);
    this.rig = new WeaponRig(this);
    this.rig.setWeapon(GameState.data.armory.loadout[0] ?? 'm1911');

    this.screenFx = new ScreenFeedback(this);
    this.wireFeedback();
    this.wireRig();
    // 音效：訂閱 GameEvents，依鏡頭位置做左右聲道（見 src/audio/、docs/AUDIO.md）
    attachAudio(this);

    // NPC 夥伴：白天就站在固守位置，入夜才開始行動
    this.companions = new CompanionSystem(this, {
      minX: BASE_X + 14,
      maxX: WORLD_WIDTH - 16,
      barricadeX: BARRICADE_X,
    });
    // 夜晚強度依可出戰的隊員人數縮放（單人開局比較溫和）
    const night = buildNight(GameState.data.day, Math.random, deployedCrew(GameState.data.crew).length);
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
    const data: BuildUIData = { mode: this.build, onStartNight: () => this.startNight(), onExplore: () => this.goExplore() };
    this.scene.launch('BuildUI', data);
    this.showStoryIntro();
    if (newDay) {
      // 新的一天：探索時段補滿、換情報、負傷隊員休養一天
      GameState.startNewDay();
      GameState.data.scrap += ECONOMY.dailySalvage;
      this.time.delayedCall(300, () => {
        this.fx.popText(PLAYER_X, LANE_TOP - 40, `附近撿拾 +${ECONOMY.dailySalvage} 廢料`, '#f5d76e');
        this.build.events.emit('changed');
      });
    }
  }

  /** 主線：序章或新章節的開場，還沒看過就跳出來 */
  private showStoryIntro(): void {
    const intro = GameState.pendingIntro();
    if (!intro) return;
    const data: StoryData =
      intro === 'prologue'
        ? {
            ...PROLOGUES[GameState.data.hero],
            onClose: () => {
              GameState.markIntroSeen();
              GameState.save();
              // 序章看完，接著播第一章
              this.time.delayedCall(150, () => this.showStoryIntro());
            },
          }
        : {
            title: intro.title,
            lines: intro.intro,
            objective: `${intro.objective}（${getZone(intro.zone)?.name ?? ''}・城市地圖上的★）`,
            onClose: () => {
              GameState.markIntroSeen();
              GameState.save();
            },
          };
    this.scene.launch('Story', data);
    this.scene.bringToTop('Story');
  }

  /** 白天出門探索：先把據點狀態存起來，回來時從 GameState 重建 */
  private goExplore(): void {
    if (this.phase !== 'day' || this.ended || this.scene.isActive('Story')) return;
    this.outpost.persist();
    GameState.save();
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('ExploreMap'));
  }

  /** 沒用完的探索時段：留守的人修路障、在附近撿東西 */
  private idleBonus(): void {
    const st = GameState.data;
    const slots = st.dayTime;
    if (slots <= 0) return;
    st.dayTime = 0;
    const repair = Math.round(this.barricade.maxHp * EXPLORE_TIME.idleRepairRatio * slots);
    const before = this.barricade.hp;
    if (this.barricade.alive) this.barricade.repair(repair);
    const scrap = EXPLORE_TIME.idleScrap * slots;
    st.scrap += scrap;
    const fixed = this.barricade.hp - before;
    this.fx.popText(BARRICADE_X, LANE_TOP - 50, `留守整備：路障 +${fixed}　廢料 +${scrap}`, '#9ad17a');
  }

  /** 入夜：收起布置介面，開始出怪 */
  private startNight(): void {
    if (this.phase === 'night' || this.ended || this.scene.isActive('Story')) return;
    this.phase = 'night';
    this.build.exit();
    this.idleBonus();
    this.outpost.persist();
    GameState.save();
    this.scene.stop('BuildUI');
    this.scene.stop('Armory');
    if (this.dusk) this.tweens.add({ targets: this.dusk, alpha: 0, duration: 800, onComplete: () => this.dusk?.destroy() });
    // 武器在入夜才上膛：白天在軍械庫換的配置、買的子彈都算進去
    const armory = GameState.data.armory;
    this.weapons = new WeaponSystem(this, armory.loadout, armory.ammo, !!armory.finitePistol, GameState.data.hero === 'lucky' ? LUCK.critChance : 0);
    this.melee = new MeleeSystem(this, armory.melee);
    // 主角技能、被抓住的狀態（見 src/systems/HeroSystem.ts）
    this.heroSys = new HeroSystem(this, this.player, this.melee, () => this.zombies);
    this.heroSys.onKill = () => this.kills++;
    // 輸入在入夜時才接上，白天點槽位不會變成第一發子彈
    this.input2 = new InputManager(this);
    // 準星會隱藏滑鼠游標，白天要點槽位，所以入夜才建立
    this.crosshair = new Crosshair(this);
    this.spawner.start();
    this.companions.active = true;
    // 拯救倖存者：今晚會不會發生、什麼時候發生，建立時就擲好
    this.rescue = new RescueEvent(this, {
      blockX: () => (this.barricade.alive ? this.barricade.frontX : BASE_X),
      safeX: () => (this.barricade.alive ? BARRICADE_X - 22 : BASE_X + 20),
      zombies: () => this.zombies,
      addZombie: (z) => this.zombies.push(z),
      canStart: () => !this.spawner.done && !this.ended,
      onJoin: (m, x, y) => {
        if (this.companions.join(m, x, y)) m.standby = false;
        else this.fx.popText(x, y - 54, '出戰人數已滿，先待命', '#b0bec5');
      },
    });
    // 開發測試：網址加 ?rescue 會在入夜 3 秒後觸發
    if (new URLSearchParams(location.search).has('rescue')) this.rescue.forceSoon(3);
    this.scene.launch('UI');
    // 輔助用品：G 手榴彈、H 醫療包（觸控在 UIScene 的按鈕）
    this.input.keyboard?.on('keydown-G', this.nightGrenade, this);
    this.input.keyboard?.on('keydown-H', this.nightMedkit, this);
    this.events.on('use-grenade', this.nightGrenade, this);
    this.events.on('use-medkit', this.nightMedkit, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-G', this.nightGrenade, this);
      this.input.keyboard?.off('keydown-H', this.nightMedkit, this);
      this.events.off('use-grenade', this.nightGrenade, this);
      this.events.off('use-medkit', this.nightMedkit, this);
    });
  }

  private nightGrenade(): void {
    if (this.phase !== 'night' || this.ended) return;
    const inp = this.input2.state;
    throwGrenade(this, this.player, inp.aimX, inp.aimY, () => this.zombies, (n) => (this.kills += n));
  }

  private nightMedkit(): void {
    if (this.phase !== 'night' || this.ended) return;
    useMedkit(this, this.player);
  }

  /** 戰場：依選擇的據點地圖畫出街口／加油站／校園，再擺上油桶、車、木箱 */
  private drawBackdrop(): void {
    this.scenery = outpostScenery(this, GameState.data.outpostMap, WORLD_WIDTH, GameState.data.day);
    // 據點外牆與射擊平台（整條地面帶都被外牆擋住）
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, GAME_HEIGHT - GROUND_Y + 84, 0x3d4450).setOrigin(0);
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, 3, 0x6a7280).setOrigin(0);
    for (let y = GROUND_Y - 78; y < GAME_HEIGHT; y += 10) this.add.rectangle(0, y, BASE_X, 1, 0x2e333c).setOrigin(0);
    this.add.rectangle(BASE_X, GROUND_Y, 6, GAME_HEIGHT - GROUND_Y, 0x555d6b).setOrigin(0);
  }

  /** 戰場上的物資箱：廢料，偶爾有手上槍的子彈 */
  private crateLoot() {
    const guns = GameState.data.armory.loadout.map((id) => getFirearm(id)).filter((d) => d && !d.infiniteReserve);
    const loot: { scrap: number; ammo?: Partial<Record<keyof typeof AMMO, number>> } = { scrap: Phaser.Math.Between(4, 10) };
    if (guns.length && Math.random() < 0.6) {
      const g = Phaser.Utils.Array.GetRandom(guns)!;
      loot.ammo = { [g.ammo]: Math.max(2, Math.round(AMMO[g.ammo].box * 0.5)) };
    }
    return loot;
  }

  private spawnZombie(id: string): void {
    if (this.ended) return;
    // 在鏡頭右緣外生成，主角在據點附近時節奏不會被拉長
    const right = Math.min(WORLD_WIDTH, this.cameras.main.scrollX + GAME_WIDTH);
    const x = right + 20 + Phaser.Math.Between(0, 20);
    const y = Phaser.Math.Between(LANE_TOP, LANE_BOTTOM);
    // 職業／動物＋隨機外觀、體型、性別＋變異（見 src/systems/ZombieFactory.ts）
    const z = spawnEnemy(this, id, x, y, { day: GameState.data.day });
    this.zombies.push(z);
    const spec = z.spec;
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
      hitPlayer: (d, fromX, fromY, src) => (this.heroSys ? this.heroSys.hitPlayer(d, fromX, fromY, src) : this.player.takeDamage(d, fromX, fromY)),
      others: [...this.companions.targets(), ...this.props.lureTargets(), ...(this.rescue?.targets() ?? [])],
      zombies: this.zombies,
    };
  }

  update(_time: number, deltaMs: number): void {
    if (this.ended) return;
    // 卡肉（hit-stop）期間 timeScale 為 0，整個戰場停頓一下
    const dt = Math.min(deltaMs / 1000, 0.05) * this.fx.timeScale;
    if (this.phase === 'day') {
      this.build.update(dt);
      // 白天：槍口朝前稍微放低；在軍械庫換了配置，手上的槍跟著換
      this.rig.setWeapon(GameState.data.armory.loadout[0] ?? 'm1911');
      this.updateRig(dt, this.player.footX + 100, this.player.footY - 20);
      return;
    }
    const inp = this.input2.update();

    // 武器
    if (inp.selectWeapon >= 0) this.weapons.select(inp.selectWeapon);
    if (inp.nextWeapon) this.weapons.next();
    if (inp.reloadPressed && !this.melee.busy) this.weapons.reload();
    this.weapons.update(dt);
    // 近戰：隨時可用，會打斷換彈
    if (inp.meleePressed && this.player.alive && !this.melee.busy) {
      this.weapons.cancelReload();
      this.melee.trySwing(this.player);
    } else if (inp.meleePressed) this.melee.trySwing(this.player);
    const meleeRes = this.melee.update(dt, this.player, this.zombies);
    this.kills += meleeRes.kills;
    // 負重：拿機槍走得慢；奔跑變快、被抓住變超慢
    const heroMul = this.heroSys ? this.heroSys.update(dt, inp.moveX !== 0 || inp.moveY !== 0) : 1;
    this.player.speedMul = this.weapons.active.def.moveMul * heroMul;

    // 主角移動：據點外牆內側到戰場右緣
    this.player.update(dt, inp.moveX, inp.moveY, inp.aimX, { minX: BASE_X + 14, maxX: WORLD_WIDTH - 16 });

    const p = this.player;
    // 手上的武器先擺好姿勢，子彈從真正的槍口射出
    this.rig.setWeapon(this.weapons.active.def.id);
    const mp = this.melee.pose;
    this.rig.setMelee(mp ? { id: this.melee.def.id, ...mp } : null);
    this.updateRig(dt, inp.aimX, inp.aimY);
    const muzzleX = this.rig.muzzle.x;
    const muzzleY = this.rig.muzzle.y;
    const shot = p.alive && !this.melee.busy
      ? this.weapons.tryFire(muzzleX, muzzleY, inp.aimX, inp.aimY, inp.fireHeld, inp.firePressed, this.zombies, p.moveFactor)
      : null;
    if (shot) {
      this.rig.fire();
      this.playShotFeedback(muzzleX, muzzleY, shot.angle);
      this.kills += shot.kills;
      this.headshots += shot.headshots;
    }
    // 準星與畫面回饋用真實時間，卡肉時照樣更新
    const realDt = Math.min(deltaMs / 1000, 0.05);
    const aimDist = Phaser.Math.Distance.Between(muzzleX, muzzleY, inp.aimX, inp.aimY);
    // 槍口上揚：準星跟著往上飄，鬆開扳機才慢慢回來
    const climbY = Math.tan(Phaser.Math.DegToRad(this.weapons.climbDeg)) * Math.abs(inp.aimX - muzzleX);
    this.crosshair.update(realDt, inp.aimX, inp.aimY - climbY, this.weapons.spreadNow(p.moveFactor), aimDist, p.alive);
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
    // 場景道具：油桶、火堆、汽車警報、掉落物；掩體擋路
    this.props.update(dt);
    this.props.collide(this.player);
    for (const z of this.zombies) if (!z.dead && z.spec.body !== 'crow') this.props.collide(z);
    // 陷阱與砲塔
    this.kills += this.outpost.update(dt, this.zombies);
    this.rescue?.update(dt);
    this.collectScrap();
    this.drops.update(dt, p.footX, p.footY, p.alive);
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    for (let i = 0; i < this.zombies.length; i++) {
      for (let j = i + 1; j < this.zombies.length; j++) Zombie.separate(this.zombies[i], this.zombies[j]);
    }
    this.spawner.update(this.zombies.length);

    this.events.emit('hud', this.hud());

    // 勝負
    if (GameState.data.baseHp <= 0) this.finish(false, 'base');
    else if (!this.player.alive) this.finish(false, 'player');
    else if (this.spawner.done && this.zombies.length === 0 && !this.rescue?.busy) this.finish(true);
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
    // 職業霧屍有機率掉出生前的裝備（警察掉手槍彈、士兵掉步槍彈或手榴彈…）
    for (const z of this.zombies) if (z.dead) this.drops.onZombieDown(z);
  }

  /** 主角的武器姿勢：從肩膀指向瞄準點，角度限制在面向的前方 ±70° */
  private updateRig(dt: number, aimX: number, aimY: number): void {
    const p = this.player;
    const sx = p.footX + 3 * p.facing;
    const sy = p.footY - 35;
    let a = Math.atan2(aimY - sy, aimX - sx);
    const lim = Phaser.Math.DegToRad(70);
    if (p.facing > 0) a = Phaser.Math.Clamp(a, -lim, lim);
    else {
      const rel = Phaser.Math.Angle.Wrap(a - Math.PI);
      a = Math.PI + Phaser.Math.Clamp(rel, -lim, lim);
    }
    this.rig.setVisible(p.alive);
    this.rig.update(dt, { footX: p.footX, footY: p.footY, facing: p.facing, aim: a, bob: p.bob, depth: p.sprite.depth });
  }

  /** 換彈、上膛的動作跟著武器系統的事件走 */
  private wireRig(): void {
    const bus = GameEvents.of(this);
    const shellKey = (id: string) => {
      const a = this.weapons?.active.def;
      if (!a || a.id !== id) return 'shell_pistol';
      return a.ammo === '12ga' ? 'shell_12ga' : a.ammo === '556' || a.ammo === '762' ? 'shell_rifle' : 'shell_pistol';
    };
    bus.on('player:reload-start', (e) => this.rig.startReload(e.duration, !!e.empty));
    bus.on('player:reload-round', (e) => this.rig.roundIn(!!e.clip));
    bus.on('player:reload-cancel', () => this.rig.endReload());
    bus.on('player:reload-end', () => this.rig.endReload());
    bus.on('player:rack', () => this.rig.rack());
    bus.on('player:cycle', (e) => {
      this.rig.cycle(e.delay);
      // 泵動／栓動：拉的時候彈殼才跳出來
      this.time.delayedCall((e.delay + 0.12) * 1000, () => {
        const ej = this.rig.eject;
        this.fx.ejectShell(ej.x, ej.y, this.player.footY + 2, this.player.facing, shellKey(e.weaponId));
      });
    });
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
    const def: FirearmDef = this.weapons.active.def;
    this.camFeel.kick(angle, def.cameraKick);
    this.camFeel.addTrauma(def.trauma);
    this.crosshair.fired();
    this.fx.muzzleLight(x, y, def.pellets > 1 ? 1.3 : 1);
    if (def.selfKnockback > 0) this.player.push(-Math.cos(angle) * def.selfKnockback);
    if (def.rumbleMs > 0) rumble(def.rumbleMs, 0.6);
    // 拋殼 + 槍口煙（程式化粒子，見 src/fx/Fx.ts）
    // 左輪、雙管換彈時才退殼；泵動／栓動拉槓時才拋殼
    if (def.cls !== 'revolver' && def.id !== 'coach' && !def.cycleSound) {
      const ej = this.rig.eject;
      const key = def.ammo === '12ga' ? 'shell_12ga' : def.ammo === '556' || def.ammo === '762' ? 'shell_rifle' : 'shell_pistol';
      this.fx.ejectShell(ej.x, ej.y, this.player.footY + 2, this.player.facing, key);
    }
    this.fx.muzzleSmoke(x, y, angle);
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
      weaponId: w.def.id,
      weaponModel: w.def.model,
      ammo: w.ammo,
      magazine: w.def.magazine,
      reserve: this.weapons.reserve(),
      slots: this.weapons.weapons.map((g) => g.def.name),
      slot: this.weapons.current,
      meleeName: this.melee.def.name,
      stamina: this.melee.staminaRatio,
      meleeBusy: this.melee.busy,
      reloading: this.weapons.reloading,
      reloadProgress: this.weapons.reloadProgress,
      wave: Math.max(1, this.spawner.waveIndex + 1),
      totalWaves: this.spawner.totalWaves,
      kills: this.kills,
      companions: this.companions.hud(),
      companionOrder: this.companions.order,
      hero: this.heroSys?.hud(),
    };
  }

  private finish(survived: boolean, reason: GameOverData['reason'] = 'base'): void {
    this.ended = true;
    this.outpost.persist();
    // 彈匣裡剩的子彈退回備彈
    this.weapons?.unloadAll();
    GameEvents.of(this).emit('game:over', { survived });
    if (survived) {
      // 地上還沒撿的掉落物：天亮後收回據點
      this.drops.collectAll(this.player.footX, this.player.footY);
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
