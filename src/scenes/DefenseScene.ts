import { ScopeView } from '../systems/ScopeView';
import { BoltPickups } from '../systems/BoltPickups';
import { illustrationFor } from '../art/IllustrationArt';
import { heroRigColors } from '../art/HeroArt';
import { barricadeKey } from '../art/ProceduralArt';
import Phaser from 'phaser';
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  GROUND_Y,
  LANE_BOTTOM,
  LANE_TOP,
  SINGLE_LANE_Y,
  WORLD_WIDTH,
  floorBand,
  floorOf,
  setFloors,
  setSingleLane,
  clampLaneY,
} from '../config';
import { barricadeFloors, getOutpostMap, type FloorsDef } from '../data/scenery';
import { FLOORS_PAD, drawFloorsStructure, drawHouseStructure } from '../scenery/FloorsStructure';
import { DUAL, setActiveSlots } from '../data/buildings';
import { addUiCamera, setViewZoom, splitUiObjects } from '../render/RenderScale';
import type { WaveDef } from '../data/waves';
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
import { createAtmosphere, nightGrade } from '../fx/Atmosphere';
import { Fx } from '../fx/Fx';
import { CameraFeel } from '../feel/CameraFeel';
import { Crosshair } from '../feel/Crosshair';
import { HeroStatus } from '../ui/HeroStatus';
import { AimReadout } from '../ui/AimReadout';
import { FEEL } from '../feel/FeelConfig';
import { rumble } from '../feel/Haptics';
import { ScreenFeedback } from '../feel/ScreenFeedback';
import { GameEvents } from '../systems/GameEvents';
import { touchMeleeAimX, InputManager } from '../input/InputManager';
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
import { OPENINGS, PROLOGUES } from '../data/story';
import type { StoryData } from './StoryScene';
import { useMedkit } from '../explore/Supplies';
import { describeLoot } from '../explore/Expedition';
import { AMMO } from '../data/weapons';
import { getFirearm } from '../data/weapons';
import { PropSystem } from '../scenery/PropSystem';
import { Terrain } from '../scenery/Terrain';
import { outpostScenery } from '../scenery/locations';
import type { SceneryResult } from '../scenery/SceneryBuilder';
import { ZombieDrops } from '../systems/ZombieDrops';
import { RescueEvent } from '../systems/RescueEvent';
import { Tutorial } from '../systems/Tutorial';
import type { AmmoType } from '../data/weapons';
import type { SupplyId } from '../data/explore';

/** 從結算畫面進來時帶的資料：newDay 代表撐過一夜、進入新的一天 */
export interface DefenseSceneData {
  newDay?: boolean;
  /** 換據點時拆掉舊建築退回的廢料（顯示用） */
  refund?: number;
  /** 新遊戲：看完序章先打一場開局教學，打完才進入第一天白天 */
  tutorial?: boolean;
}

/** 教學開打前的存檔快照：打完還原，教學不消耗子彈、用品與路障 */
interface TutorialSnapshot {
  ammo: Record<AmmoType, number>;
  supplies: Record<SupplyId, number>;
  barricadeHp: number;
  baseHp: number;
  buildings: { slot: string; hp: number }[];
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
  meleeId: string;
  /** 近戰模式中（槍收起來） */
  meleeStance: boolean;
  /** 連段進度：第幾下／一串幾下（0 = 沒有連段）；streak 是連擊數 */
  meleeChain: { idx: number; len: number; streak: number; names?: string[] };
  /** 身上沒有槍（阿凱開局）：鎖在近戰模式，武器欄不列槍 */
  unarmed: boolean;
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
  /** 開局教學中（上方改顯示「開局教學」） */
  tutorial?: boolean;
}

const BASE_X = 44;
const PLAYER_X = 80;
const BARRICADE_X = 160;

/** 爬一層樓梯要幾秒 */
const CLIMB_TIME = 0.42;

/**
 * 一道防線：霧屍從 side 那一側來（1 = 右、-1 = 左），先打路障，路障倒了打據點。
 * 多樓層據點每層一道（floor 是第幾層）；沒有路障的那層（頂樓）霧屍直接衝據點。
 */
interface Front {
  side: 1 | -1;
  barricade?: Barricade;
  floor?: number;
  /** 路障的 x */
  barX: number;
  /** 路障倒了以後霧屍敲的據點邊緣 */
  baseX: number;
}

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
  /** 防線：一般據點只有右邊一道；雙面據點（孤島小店）左右各一道 */
  private fronts: Front[] = [];
  /** 雙面據點 */
  private dual = false;
  /** 據點中心 x（雙面據點）／主角起始位置 */
  private homeX = PLAYER_X;
  /** 下一隻霧屍從哪邊來（雙面據點左右交錯） */
  private nextSide: 1 | -1 = 1;
  /** 多樓層據點（爛尾樓）：每層一條路，走樓梯換層 */
  private floors?: FloorsDef;
  /** 正在爬樓梯：從哪裡爬到哪裡、進度 0..1 */
  private climb: { x0: number; x1: number; y0: number; y1: number; t: number } | null = null;
  /** 上下鍵放開過才能再爬下一層（按住不會一路爬到頂） */
  private stairReady = true;
  private stairHinted = false;
  /** 今晚第一次有霧屍爬上頂樓時提示一次 */
  private climbHinted = false;
  /** 透天厝：今晚還能往下丟幾件雜物、丟東西的冷卻 */
  private junkLeft = 0;
  private junkCd = 0;
  /** 透天厝：鐵門被撞開、全隊退上二樓了（退到第幾層） */
  private retreated = -1;
  /** 雙面據點白天：隊員頭上的「守左／守右」標籤 */
  private sideTags: Phaser.GameObjects.Text[] = [];
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
  /** 主角腳下的生命光圈與體力弧（入夜才建立） */
  private heroStatus?: HeroStatus;
  /** 準星旁的彈匣格、換彈圈 */
  private aimReadout?: AimReadout;
  /** 巴雷特的狙擊鏡、十字弓射出去的箭（入夜才建立） */
  private scope?: ScopeView;
  private bolts?: BoltPickups;
  private screenFx!: ScreenFeedback;
  private scenery!: SceneryResult;
  /** 戰場上的油桶、車、木箱、路燈 */
  private props!: PropSystem;
  /** 據點地形：立體障礙物、積水、沙坑、油漬（src/scenery/Terrain.ts） */
  private terrain!: Terrain;
  /** 職業霧屍的掉落物（src/systems/ZombieDrops.ts） */
  private drops!: ZombieDrops;
  /** 夜裡隨機的拯救倖存者事件（入夜才建立） */
  private rescue?: RescueEvent;
  /** 開局教學（只有新遊戲第一場） */
  private tutorial?: Tutorial;
  /** 單軸據點：不縮放的 HUD 鏡頭 */
  private uiCam?: Phaser.Cameras.Scene2D.Camera;
  private tutorialSnap?: TutorialSnapshot;

  constructor() {
    super('Defense');
  }

  create(data: DefenseSceneData = {}): void {
    this.zombies = [];
    this.rescue = undefined;
    this.tutorial = undefined;
    this.tutorialSnap = undefined;
    this.kills = 0;
    this.headshots = 0;
    this.ended = false;
    this.phase = 'day';
    this.scrapEarned = 0;

    // 單軸據點（窄巷）：大家都在同一條線上、只開放部分槽位；場景結束還原
    const map = getOutpostMap(GameState.data.outpostMap);
    setSingleLane(!!map.single);
    this.floors = map.floors;
    this.climb = null;
    this.stairReady = true;
    this.stairHinted = false;
    this.climbHinted = false;
    this.retreated = -1;
    this.junkCd = 0;
    this.junkLeft = map.floors?.levels.reduce((a, l) => a + (l.junk ?? 0), 0) ?? 0;
    setFloors(
      map.floors ? map.floors.levels.map((l) => l.y) : null,
      map.floors?.levels.map((l) => l.band),
    );
    setActiveSlots(map.single?.slots ?? map.dual?.slots ?? map.floors?.slots ?? null);
    this.dual = !!map.dual;
    this.homeX = this.dual ? DUAL.center : PLAYER_X;
    this.sideTags = [];
    this.uiCam = undefined;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      setSingleLane(false);
      setFloors(null);
      setActiveSlots(null);
    });
    // 先設好世界範圍：Fx 的地面血跡畫布依鏡頭範圍決定大小
    // 多樓層據點：鏡頭可以往左多捲一點，頂樓的人才不會被左上角的 HUD 擋住
    const pad = map.floors ? FLOORS_PAD : 0;
    this.cameras.main.setBounds(-pad, 0, WORLD_WIDTH + pad, GAME_HEIGHT);
    this.drawBackdrop();
    this.fx = Fx.attach(this);
    this.camFeel = CameraFeel.attach(this);
    // 貼地霧放在地面帶中段，燈掛在據點外牆上
    createAtmosphere(this, { groundY: LANE_TOP + 14, lamp: this.dual ? { x: DUAL.center, y: GROUND_Y - 120 } : { x: BASE_X - 6, y: GROUND_Y - 70 } });

    const st = GameState.data;
    const barXR = this.dual ? DUAL.center + DUAL.barricadeOff : BARRICADE_X;
    const barXL = DUAL.center - DUAL.barricadeOff;
    // 路障用當地的東西堆（巷子是垃圾桶、國小是課桌椅…）
    const barTex = barricadeKey(map.barricade);
    // 多樓層據點：有路障的樓層各堆一道（第一道是主路障，第二道借用雙面據點的「第二道路障」存檔欄位）
    // 2.5D 地面帶那層（透天厝院子）照一般路障堆滿整條帶；單線樓層只堆在那層地板上
    const barFloors = barricadeFloors(map);
    const barLv = (k: number) => (map.floors && barFloors[k] !== undefined ? map.floors.levels[barFloors[k]] : undefined);
    const floorY = (k: number) => (barLv(k)?.band ? undefined : barLv(k)?.y);
    this.barricade = new Barricade(this, barLv(0)?.barricadeX ?? barXR, st.barricadeMaxHp, barLv(0)?.from ?? 1, barTex, floorY(0));
    const barricadeL = this.dual
      ? new Barricade(this, barXL, st.barricadeMaxHp, -1, barTex)
      : barFloors.length > 1
        ? new Barricade(this, barLv(1)?.barricadeX ?? barXR, st.barricadeMaxHp, barLv(1)?.from ?? 1, barTex, floorY(1))
        : undefined;
    if (map.floors) {
      this.fronts = map.floors.levels.map((l, i) => ({
        side: l.from ?? 1,
        floor: i,
        barricade: i === barFloors[0] ? this.barricade : i === barFloors[1] ? barricadeL : undefined,
        barX: l.barricadeX ?? barXR,
        baseX: l.baseX ?? BASE_X,
      }));
    } else {
      this.fronts = [{ side: 1, barricade: this.barricade, barX: barXR, baseX: this.dual ? DUAL.center + DUAL.storeHalf : BASE_X }];
      if (barricadeL) this.fronts.push({ side: -1, barricade: barricadeL, barX: barXL, baseX: DUAL.center - DUAL.storeHalf });
    }
    // 據點建築與路障耐久從 GameState 還原（跨夜保留）
    this.outpost = new Outpost(this, this.barricade, barricadeL);
    this.build = new BuildMode(this, this.outpost, {
      barricadeX: barXR,
      baseX: BASE_X,
      dual: this.dual ? { barricadeXL: barXL, center: DUAL.center, half: 3.5 * 34 } : undefined,
      floors: map.floors ? { second: barFloors[1] ?? -1, secondX: barLv(1)?.barricadeX ?? barXR } : undefined,
      pickExtra: this.dual || map.floors ? (x, y) => this.toggleCrewSide(x, y) : undefined,
    });
    // 多樓層據點：主角從指定的那層開始
    const startY = map.floors ? map.floors.levels[map.floors.startFloor].y : (LANE_TOP + LANE_BOTTOM) / 2;
    // 樓梯口有路障的那層（透天厝二樓）：站到路障內側的陽台上
    const startLv = map.floors?.levels[map.floors.startFloor];
    const startX = startLv?.from === -1 ? (startLv.barricadeX ?? this.homeX) + 40 : this.homeX;
    this.player = new Player(this, startX, startY, GameState.hero.maxHp);
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

    this.terrain = new Terrain(this, map.terrain ?? []);

    this.drops = new ZombieDrops(this, {
      heal: (a) => this.player.heal(a),
      // 雙面據點：修比較爛的那一道
      repair: (a) => {
        const bar = this.weakestBarricade();
        return bar.alive ? bar.repair(a) : 0;
      },
    });

    // 戰場比畫面寬：鏡頭跟著主角水平捲動，中間留一段不跟的死區
    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0);
    cam.setDeadzone(160, GAME_HEIGHT);
    cam.setFollowOffset(this.dual ? 0 : -90, 0);
    // 雙面據點：兩邊都要看，鏡頭置中跟著主角，死區縮小（主角站在小店前時左右路障都在畫面裡）
    if (this.dual) cam.setDeadzone(40, GAME_HEIGHT);
    if (map.single) {
      // 單軸：鏡頭拉近，HUD 類物件另用不縮放的鏡頭畫（同探索的單軸關卡）
      setViewZoom(cam, 1.5);
      cam.startFollow(this.player.sprite, true, 0.12, 1, this.dual ? 0 : -60, SINGLE_LANE_Y - 226);
      cam.setDeadzone(110, 0);
      this.uiCam = addUiCamera(this);
    }
    this.fx.attachShadow(this.player.sprite, 22);
    this.rig = new WeaponRig(this, heroRigColors(GameState.data.hero ?? 'soldier'));
    this.rig.setWeapon(GameState.data.armory.loadout[0] ?? 'm1911');

    this.screenFx = new ScreenFeedback(this);
    this.wireFeedback();
    this.wireRig();
    // 音效：訂閱 GameEvents，依鏡頭位置做左右聲道（見 src/audio/、docs/AUDIO.md）
    attachAudio(this);

    // NPC 夥伴：白天就站在固守位置，入夜才開始行動
    this.companions = new CompanionSystem(this, {
      minX: this.dual ? 16 : BASE_X + 14,
      maxX: WORLD_WIDTH - 16,
      barricadeX: barXR,
      dual: this.dual ? { center: DUAL.center, barricadeXL: barXL } : undefined,
      floors: map.floors ? { ys: map.floors.levels.map((l) => l.y), bands: map.floors.levels.map((l) => !!l.band), holdMinX: map.floors.levels.map((l) => (l.from === -1 ? (l.barricadeX ?? 0) + 24 : 0)), from: map.floors.levels.map((l) => l.from ?? 1), crewFloors: map.floors.crewFloors } : undefined,
    });
    // 夜晚強度依可出戰的隊員人數縮放（單人開局比較溫和）
    const base = buildNight(GameState.data.day, Math.random, deployedCrew(GameState.data.crew).length);
    const lane = singleLaneNight(base, map.single);
    const night = map.dual ? scaleNight(lane, map.dual.waves) : map.floors ? scaleNight(lane, map.floors.waves) : lane;
    prewarmLooks(this, night.flatMap((w) => w.groups.map((g) => g.enemy)));
    this.spawner = new WaveSpawner(this, night, (id) => this.spawnZombie(id));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scene.stop('UI');
      this.scene.stop('BuildUI');
    });
    if (data.tutorial) this.startTutorial();
    else this.startDay(!!data.newDay);
    if (data.refund) this.time.delayedCall(500, () => this.fx.popText(this.homeX + 40, LANE_TOP - 40, `換據點：舊建築拆回 +${data.refund} 廢料`, '#f5d76e'));
  }

  /**
   * 開局教學：先播序章，接著直接入夜，在據點前一步一步練移動、射擊、換彈、近戰，
   * 最後清掉一小波霧屍。打完回到正常的第一天白天（第一章開場在那時才播）。
   */
  private startTutorial(): void {
    this.dusk = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xff9a4a, 0.1).setOrigin(0).setScrollFactor(0).setDepth(89);
    const begin = () => this.time.delayedCall(200, () => this.startNight(true));
    if (GameState.pendingIntro() !== 'prologue') {
      begin();
      return;
    }
    const data: StoryData = {
      ...PROLOGUES[GameState.data.hero],
      art: illustrationFor(OPENINGS[GameState.data.hero]?.zone),
      hero: GameState.data.hero,
      objective: '先熟悉操作：據點外的霧屍已經聞到你了',
      onClose: () => {
        GameState.markIntroSeen();
        GameState.save();
        begin();
      },
    };
    this.scene.launch('Story', data);
    this.scene.bringToTop('Story');
  }

  /** 教學打完（或跳過）：還原快照，進入第一天白天 */
  private finishTutorial(skipped = false): void {
    if (this.ended) return;
    this.ended = true;
    this.weapons?.unloadAll();
    const st = GameState.data;
    const snap = this.tutorialSnap;
    if (snap) {
      st.armory.ammo = snap.ammo;
      st.supplies = snap.supplies;
      st.barricadeHp = snap.barricadeHp;
      st.baseHp = snap.baseHp;
      for (const b of st.buildings) b.hp = snap.buildings.find((s) => s.slot === b.slot)?.hp ?? b.hp;
    }
    st.tutorialDone = true;
    GameState.save();
    GameEvents.of(this).emit('game:over', { survived: true });
    const banner = pixelText(this, GAME_WIDTH / 2, 130, skipped ? '跳過教學' : '教學完成！', 16, '#9ad17a').setOrigin(0.5);
    const sub = pixelText(this, GAME_WIDTH / 2, 152, skipped ? '' : `擊殺 ${this.kills}・廢料 +${this.scrapEarned}　天亮了，開始布置據點`, 8, '#e0e0e0').setOrigin(0.5);
    for (const t of [banner, sub]) t.setScrollFactor(0).setDepth(400).setStroke('#000000', 3);
    this.time.delayedCall(skipped ? 400 : 1800, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Defense', {} as DefenseSceneData));
    });
  }

  /** 白天：布置據點。新的一天先入帳白天搜刮的廢料 */
  private startDay(newDay: boolean): void {
    this.phase = 'day';
    // 黃昏的暖色濾鏡，入夜時淡掉
    this.dusk = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xff9a4a, 0.1).setOrigin(0).setScrollFactor(0).setDepth(89);
    this.build.enter();
    if (this.dual || this.floors) this.showSideTags();
    const data: BuildUIData = { mode: this.build, onStartNight: () => this.startNight(), onExplore: () => this.goExplore() };
    this.scene.launch('BuildUI', data);
    this.showStoryIntro();
    if (newDay) {
      // 新的一天：探索時段補滿、換情報、負傷隊員休養一天
      GameState.startNewDay();
      GameState.data.scrap += ECONOMY.dailySalvage;
      this.time.delayedCall(300, () => {
        this.fx.popText(this.homeX, LANE_TOP - 40, `附近撿拾 +${ECONOMY.dailySalvage} 廢料`, '#f5d76e');
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
            art: illustrationFor(OPENINGS[GameState.data.hero]?.zone),
            hero: GameState.data.hero,
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
            art: illustrationFor(intro.zone),
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
    let fixed = 0;
    for (const f of this.fronts) {
      const bar = f.barricade;
      if (!bar) continue;
      const before = bar.hp;
      if (bar.alive) bar.repair(Math.round(bar.maxHp * EXPLORE_TIME.idleRepairRatio * slots));
      fixed += bar.hp - before;
    }
    const scrap = EXPLORE_TIME.idleScrap * slots;
    st.scrap += scrap;
    this.fx.popText(this.homeX, LANE_TOP - 50, `留守整備：路障 +${fixed}　廢料 +${scrap}`, '#9ad17a');
  }

  /** 入夜：收起布置介面，開始出怪 */
  private startNight(tutorial = false): void {
    if (this.phase === 'night' || this.ended || this.scene.isActive('Story')) return;
    this.phase = 'night';
    this.build.exit();
    for (const t of this.sideTags) t.destroy();
    this.sideTags = [];
    if (tutorial) {
      const st = GameState.data;
      this.tutorialSnap = {
        ammo: { ...st.armory.ammo },
        supplies: { ...st.supplies },
        barricadeHp: this.barricade.hp,
        baseHp: st.baseHp,
        buildings: st.buildings.map((b) => ({ slot: b.slot, hp: b.hp })),
      };
    } else {
      this.idleBonus();
      this.outpost.persist();
      GameState.save();
    }
    this.scene.stop('BuildUI');
    this.scene.stop('Armory');
    if (this.dusk) this.tweens.add({ targets: this.dusk, alpha: 0, duration: 800, onComplete: () => this.dusk?.destroy() });
    // 入夜調色：壓暗偏藍，據點燈與主角身邊留光（src/fx/Atmosphere.ts）
    const lights = this.floors
      ? this.floors.levels.map((l) => ({ x: BASE_X + 40, y: l.y - 30, scale: 1.1 }))
      : [this.dual ? { x: DUAL.center, y: GROUND_Y - 40, scale: 1.6 } : { x: BASE_X - 6, y: GROUND_Y - 40, scale: 1.3 }];
    nightGrade(this, lights, this.player.sprite);
    // 武器在入夜才上膛：白天在軍械庫換的配置、買的子彈都算進去
    const armory = GameState.data.armory;
    this.weapons = new WeaponSystem(this, armory.loadout, armory.ammo, !!armory.finitePistol, GameState.data.hero === 'lucky' ? LUCK.critChance : 0);
    this.melee = new MeleeSystem(this, armory.melee);
    // 沒帶任何槍（純近戰主角）：整場都是近戰模式
    if (GameState.data.armory.loadout.length === 0) this.melee.lockStance();
    // 主角技能、被抓住的狀態（見 src/systems/HeroSystem.ts）
    this.heroSys = new HeroSystem(this, this.player, this.melee, () => this.zombies);
    this.heroSys.onKill = () => this.kills++;
    // 輸入在入夜時才接上，白天點槽位不會變成第一發子彈
    this.input2 = new InputManager(this, { x: this.player.footX + 200, y: this.player.footY - 30 });
    // 準星會隱藏滑鼠游標，白天要點槽位，所以入夜才建立
    this.crosshair = new Crosshair(this);
    this.heroStatus = new HeroStatus(this, this.player.sprite);
    this.aimReadout = new AimReadout(this);
    this.scope = new ScopeView(this, this.weapons);
    this.bolts = new BoltPickups(this, this.weapons, armory.ammo, () => this.player.footY - this.rig.muzzle.y, clampLaneY);
    this.companions.active = true;
    if (tutorial) {
      // 教學中不會倒下：任何傷害最多打到剩 1 血
      this.player.minHp = 1;
      this.tutorial = new Tutorial({
        scene: this,
        player: this.player,
        weapons: () => this.weapons,
        zombies: () => this.zombies,
        spawn: (id, x) => this.spawnZombie(id, x),
        barricadeX: this.fronts[0].barX,
        touch: this.sys.game.device.input.touch,
        unarmed: GameState.data.armory.loadout.length === 0,
        onDone: () => this.finishTutorial(),
      });
      this.events.once('tutorial-skip', () => this.finishTutorial(true));
      // 電腦：Esc 打開暫停畫面，從那裡跳過教學（UIScene）
      this.scene.launch('UI', { tutorial: true });
      // UIScene 要先建好才收得到第一則提示
      this.time.delayedCall(50, () => this.tutorial?.start());
      this.wireNightSupplies();
      return;
    }
    this.spawner.start();
    // 拯救倖存者：今晚會不會發生、什麼時候發生，建立時就擲好
    this.rescue = new RescueEvent(this, {
      // 倖存者從右邊跑來（雙面據點也是右側）
      blockX: () => (this.barricade.alive ? this.barricade.frontX : this.fronts[0].baseX),
      safeX: () => (this.barricade.alive ? this.fronts[0].barX - 22 : this.fronts[0].baseX + 20),
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
    this.wireNightSupplies();
  }

  private wireNightSupplies(): void {
    // 輔助用品：H 醫療包（觸控在 UIScene 的按鈕）
    this.input.keyboard?.on('keydown-H', this.nightMedkit, this);
    this.events.on('use-medkit', this.nightMedkit, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown-H', this.nightMedkit, this);
      this.events.off('use-medkit', this.nightMedkit, this);
    });
  }

  private nightMedkit(): void {
    if (this.phase !== 'night' || this.ended) return;
    useMedkit(this, this.player);
  }

  /** 戰場：依選擇的據點地圖畫出街口／加油站／校園，再擺上油桶、車、木箱 */
  private drawBackdrop(): void {
    this.scenery = outpostScenery(this, GameState.data.outpostMap, WORLD_WIDTH, GameState.data.day);
    // 多樓層據點：三層樓的剖面、樓梯、鷹架（樓梯間就是據點本體）
    if (this.floors) {
      if (this.floors.look === 'house') drawHouseStructure(this, this.floors, BASE_X);
      else drawFloorsStructure(this, this.floors, BASE_X, WORLD_WIDTH);
      return;
    }
    // 雙面據點：小店畫在背景立面上（SceneryBuilder 的 islandshop），門口鋪一塊地墊標出「據點」範圍
    if (this.dual) {
      const c = DUAL.center;
      const h = DUAL.storeHalf;
      this.add.rectangle(c - h, LANE_TOP - 8, h * 2, LANE_BOTTOM - LANE_TOP + 16, 0xf0e8a0, 0.06).setOrigin(0).setDepth(1);
      for (const x of [c - h, c + h - 2]) this.add.rectangle(x, LANE_TOP - 8, 2, LANE_BOTTOM - LANE_TOP + 16, 0xe0d890, 0.25).setOrigin(0).setDepth(1);
      return;
    }
    // 據點外牆與射擊平台（整條地面帶都被外牆擋住）
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, GAME_HEIGHT - GROUND_Y + 84, 0x3d4450).setOrigin(0);
    this.add.rectangle(0, GROUND_Y - 84, BASE_X, 3, 0x6a7280).setOrigin(0);
    for (let y = GROUND_Y - 78; y < GAME_HEIGHT; y += 10) this.add.rectangle(0, y, BASE_X, 1, 0x2e333c).setOrigin(0);
    this.add.rectangle(BASE_X, GROUND_Y, 6, GAME_HEIGHT - GROUND_Y, 0x555d6b).setOrigin(0);
  }

  /** 耐久比例最低的那道路障（一般據點就是主路障） */
  private weakestBarricade(): Barricade {
    let best = this.barricade;
    for (const f of this.fronts) if (f.barricade && f.barricade.hp / f.barricade.maxHp < best.hp / best.maxHp) best = f.barricade;
    return best;
  }

  /** 雙面據點白天：點隊員換守左邊／右邊；多樓層據點：換守哪一層 */
  private toggleCrewSide(x: number, y: number): boolean {
    if (this.phase !== 'day') return false;
    const c = this.companions?.companionAt(x, y);
    if (!c) return false;
    if (this.floors) {
      const f = this.companions.toggleFloor(c);
      GameState.save();
      this.fx.popText(c.footX, c.footY - 64, `改守 ${this.floors.levels[f].name}`, '#fff59d');
      return true;
    }
    const side = this.companions.toggleSide(c);
    GameState.save();
    this.fx.popText(c.footX, c.footY - 64, side < 0 ? '改守左邊' : '改守右邊', '#fff59d');
    return true;
  }

  /** 隊員頭上的「守左／守右」小字（白天），提示可以點選換邊 */
  private showSideTags(): void {
    for (const t of this.sideTags) t.destroy();
    this.sideTags = this.companions.companions.map(() =>
      pixelText(this, 0, 0, '', 7, '#fff59d').setOrigin(0.5, 1).setDepth(150).setStroke('#000000', 3),
    );
    this.updateSideTags();
    if (this.floors) this.fx.popText(this.homeX + 160, this.floors.levels[this.floors.levels.length - 1].y - 70, '每一層都會有霧屍：點隊員切換守哪一層', '#fff59d');
    else this.fx.popText(DUAL.center, LANE_TOP - 70, '霧屍會從左右兩邊來：點隊員切換守哪一側', '#fff59d');
  }

  private updateSideTags(): void {
    if (!this.sideTags.length) return;
    this.companions.companions.forEach((c, i) => {
      const t = this.sideTags[i];
      if (!t) return;
      t.setVisible(c.alive);
      const label = this.floors ? `守${this.floors.levels[this.companions.floorOf(c)].name}` : this.companions.sideOf(c) < 0 ? '◀守左' : '守右▶';
      t.setText(label).setPosition(c.footX, c.footY - 66 - (i % 2) * 10);
    });
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

  private spawnZombie(id: string, atX?: number): void {
    if (this.ended) return;
    // 雙面據點：左右大致交錯，偶爾連續從同一邊來
    let side: 1 | -1 = 1;
    if (this.dual) {
      side = atX !== undefined ? (atX < DUAL.center ? -1 : 1) : this.nextSide;
      if (atX === undefined) this.nextSide = Math.random() < 0.7 ? (side > 0 ? -1 : 1) : side;
    }
    // 在鏡頭邊緣外生成，主角在據點附近時節奏不會被拉長
    const cam = this.cameras.main;
    const right = Math.min(WORLD_WIDTH, cam.scrollX + GAME_WIDTH);
    const left = Math.max(0, cam.scrollX);
    let x = atX ?? (side > 0 ? right + 20 + Phaser.Math.Between(0, 20) : left - 20 - Phaser.Math.Between(0, 20));
    let y = Phaser.Math.Between(LANE_TOP, LANE_BOTTOM);
    // 多樓層據點：照比例挑一層；有 spawnX 的那層（頂樓）是從鷹架爬上來的
    const level = this.floors && atX === undefined ? this.pickSpawnFloor(id) : -1;
    if (this.floors && level >= 0) {
      const lv = this.floors.levels[level];
      y = lv.band ? Phaser.Math.Between(lv.band[0], lv.band[1]) : lv.y + Phaser.Math.Between(-2, 2);
      if (lv.spawnX !== undefined) x = lv.spawnX;
    }
    // 職業／動物＋隨機外觀、體型、性別＋變異（見 src/systems/ZombieFactory.ts）
    const z = spawnEnemy(this, id, x, y, { day: GameState.data.day });
    z.side = side;
    z.setFlipX(side > 0);
    this.zombies.push(z);
    if (this.floors && level >= 0 && this.floors.levels[level].spawnX !== undefined) this.climbIn(z, this.floors.levels[level].name);
    const spec = z.spec;
    this.introduce(spec.profession.id);
  }

  /**
   * 多樓層據點：這隻霧屍從哪一層進來。狗和熊爬不了鷹架，只走一樓；
   * 烏鴉會飛，從頂樓高度飛進來，之後哪一層都能去。
   */
  private pickSpawnFloor(id: string): number {
    const lv = this.floors!.levels;
    if (id === 'crow') return lv.length - 1;
    if (id === 'dog' || id === 'bear') return 0;
    let r = Math.random() * lv.reduce((a, l) => a + l.weight, 0);
    for (let i = 0; i < lv.length; i++) {
      r -= lv[i].weight;
      if (r <= 0) return i;
    }
    return 0;
  }

  /** 霧屍從鷹架翻上來：一陣灰塵，第一次出現時提示 */
  private climbIn(z: Zombie, floorName: string): void {
    if (z.spec.body === 'crow') return;
    this.fx.dust(z.footX, z.footY, 6);
    if (this.climbHinted) return;
    this.climbHinted = true;
    this.fx.popText(z.footX - 20, z.footY - 70, `霧屍爬上${floorName}了！`, '#ff8a80');
  }

  /**
   * 多樓層據點：站在樓梯／爬梯上按上或下就換層（爬的時候不能開槍）。
   * 上下鍵要放開過才會再爬下一層。
   */
  private updateStairs(dt: number, moveY: number): void {
    const fl = this.floors!;
    const p = this.player;
    if (this.climb) {
      const c = this.climb;
      c.t = Math.min(1, c.t + dt / CLIMB_TIME);
      const k = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;
      p.placeAt(Phaser.Math.Linear(c.x0, c.x1, Math.min(1, c.t * 3)), Phaser.Math.Linear(c.y0, c.y1, k));
      if (c.t >= 1) this.climb = null;
      return;
    }
    if (Math.abs(moveY) < 0.3) this.stairReady = true;
    const stair = fl.stairs.find((s) => p.footX >= s.x0 && p.footX <= s.x1);
    if (!stair) return;
    const f = floorOf(p.footY);
    const reaches = (i: number) => i >= 0 && i < fl.levels.length && (fl.levels[i].x1 ?? WORLD_WIDTH) >= stair.x1;
    if (!this.stairHinted && p.alive) {
      this.stairHinted = true;
      this.fx.popText(p.footX, p.footY - 70, `${stair.name}：按 ▲／▼ 換樓層`, '#fff59d');
      if (this.junkLeft > 0) this.time.delayedCall(1800, () => this.fx.popText(p.footX + 60, p.footY - 70, `陽台上：瞄準樓下按近戰鍵（V）丟雜物 ×${this.junkLeft}`, '#fff59d'));
    }
    if (!this.stairReady || Math.abs(moveY) < 0.6 || !p.alive) return;
    const to = f + (moveY < 0 ? 1 : -1);
    if (!reaches(to) || !reaches(f)) return;
    // 2.5D 地面帶那層：樓梯在最裡面，要走到後牆邊才爬得上去（不然在院子裡往上走就變爬樓梯）
    const band = floorBand(f);
    if (moveY < 0 && fl.levels[f].band && band && p.footY > band[0] + 10) return;
    const toBand = fl.levels[to].band;
    this.stairReady = false;
    this.climb = { x0: p.footX, x1: Phaser.Math.Clamp(p.footX, stair.x0 + 6, stair.x1 - 6), y0: p.footY, y1: toBand ? toBand[0] + 4 : fl.levels[to].y, t: 0 };
    this.weapons.cancelReload();
    this.fx.dust(p.footX, p.footY, 3);
    this.fx.popText(p.footX, fl.levels[to].y - 64, fl.levels[to].name, '#e0e0e0');
  }

  /**
   * 透天厝：鐵門被撞開。全隊退到 to 那層（隊員直接傳上去，主角自己爬），
   * 之後走到樓梯的霧屍會爬上去，從樓梯口打過來。
   */
  private retreat(to: number): void {
    if (this.retreated >= 0 || !this.floors) return;
    this.retreated = to;
    const lv = this.floors.levels[to];
    this.companions.retreatTo(to);
    this.camFeel.addTrauma(0.4);
    const t1 = pixelText(this, GAME_WIDTH / 2, 110, '鐵門被撞開了！', 14, '#ff8a80').setOrigin(0.5);
    const t2 = pixelText(this, GAME_WIDTH / 2, 130, `全員退到${lv.name}，守住樓梯口！`, 9, '#ffe0a0').setOrigin(0.5);
    for (const t of [t1, t2]) {
      t.setScrollFactor(0).setDepth(200).setStroke('#000000', 3);
      this.tweens.add({ targets: t, alpha: 0, delay: 2600, duration: 500, onComplete: () => t.destroy() });
    }
  }

  /** 退守後：一樓走到樓梯口的霧屍爬上去，出現在樓上的樓梯口 */
  private updateRetreat(): void {
    const fl = this.floors!;
    const stair = fl.stairs[0];
    const from = fl.levels.findIndex((l) => l.retreatTo === this.retreated);
    const up = fl.levels[this.retreated];
    for (const z of this.zombies) {
      if (z.dead || z.spec.body === 'crow' || floorOf(z.footY) !== from || z.footX > stair.x1 + 26) continue;
      z.footX = stair.x0 + 12 + Math.random() * 8;
      z.footY = up.y;
      z.laneY = up.y;
      z.side = up.from ?? 1;
      z.setFlipX(z.side > 0);
      this.fx.dust(z.footX, z.footY, 4);
    }
  }

  /**
   * 透天厝陽台：瞄準樓下按近戰鍵，往下丟雜物（花盆、舊電視、瓦斯爐…）。
   * 落地砸一小圈，霧屍被砸倒、硬直。丟完就變回一般近戰。回傳這一下有沒有丟。
   */
  private tryThrowJunk(aimX: number, aimY: number, pressed: boolean): boolean {
    const fl = this.floors;
    if (!fl || this.climb) return false;
    const p = this.player;
    const here = floorOf(p.footY);
    const lv = fl.levels[here];
    if (!lv.junk || aimY < p.footY + 20) return false;
    if (this.junkLeft <= 0) {
      if (pressed) this.fx.popText(p.footX, p.footY - 64, '雜物丟完了', '#b0bec5');
      return false;
    }
    if (this.junkCd > 0) return true;
    const below = Math.max(0, fl.levels.findIndex((l) => l.band));
    const band = floorBand(below) ?? [LANE_TOP, LANE_BOTTOM];
    const tx = Phaser.Math.Clamp(aimX, p.footX - 40, p.footX + 260);
    // 準星指的是畫面上的點：丟到那一點正下方的地面（地面帶內）
    const ty = Phaser.Math.Clamp(aimY, band[0], band[1]);
    this.junkLeft--;
    this.junkCd = 0.45;
    const kinds = [
      { w: 10, h: 9, c: 0xa0522d, t: '花盆' },
      { w: 14, h: 11, c: 0x4a4e54, t: '舊電視' },
      { w: 12, h: 6, c: 0xb8bcc0, t: '瓦斯爐' },
      { w: 8, h: 12, c: 0x2a6ac8, t: '水桶' },
    ];
    const k = Phaser.Utils.Array.GetRandom(kinds);
    const obj = this.add.rectangle(p.footX + p.facing * 8, p.footY - 34, k.w, k.h, k.c).setStrokeStyle(1, 0x120d0a).setDepth(90);
    const x0 = obj.x;
    const y0 = obj.y;
    const dur = 420 + Math.abs(ty - y0) * 1.2;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        obj.setPosition(Phaser.Math.Linear(x0, tx, t), Phaser.Math.Linear(y0, ty - 4, t) - Math.sin(t * Math.PI) * 30);
        obj.setAngle(t * 540 * (tx >= x0 ? 1 : -1));
      },
      onComplete: () => {
        obj.destroy();
        this.junkLand(tx, ty, k.t);
      },
    });
    this.fx.popText(p.footX, p.footY - 64, `${k.t}！×${this.junkLeft}`, '#ffe0a0');
    return true;
  }

  private junkLand(x: number, y: number, name: string): void {
    void name;
    const R = 38;
    this.fx.dust(x, y, 10);
    this.camFeel.addTrauma(0.18);
    for (const z of this.zombies) {
      if (z.dead || z.spec.body === 'crow' || Math.hypot(z.footX - x, (z.footY - y) * 1.6) > R) continue;
      if (z.takeDamage(55, 10, { dirX: Math.sign(z.footX - x) || 1, type: 'blunt' })) this.kills++;
    }
  }

  /** 多樓層據點：這一層的路障（沒有路障的樓層回傳 undefined） */
  private floorBarricade(floor: number): Barricade | undefined {
    return this.fronts.find((f) => f.floor === floor)?.barricade;
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
    for (const f of this.fronts) {
      if (f.floor !== undefined && floorOf(e.y) !== f.floor) continue;
      const ctx = this.zombieContext(f);
      if (Math.abs(e.x - ctx.blockX) <= e.radius) ctx.hitBlock(e.damage, e.y);
    }
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

  /**
   * 霧屍要攻擊的擋路線：路障還在就是路障，否則是據點外牆；前面有沙包牆時先拆沙包。
   * 雙面據點每一側各有一份，霧屍用自己那一側的（z.side）。
   * 多樓層據點每層一份：只看得到、打得到同一層的人（allFloors：烏鴉會飛，哪一層都追）。
   */
  private zombieContext(front: Front = this.fronts[0], allFloors = false): ZombieContext {
    const bar = front.barricade;
    const fl = allFloors ? undefined : front.floor;
    const same = (y: number) => fl === undefined || floorOf(y) === fl;
    const lv = this.floors && front.floor !== undefined ? this.floors.levels[front.floor] : undefined;
    // 透天厝：鐵門倒了，霧屍不敲牆，往樓梯擠（走到樓梯就爬上二樓，見 updateRetreat）
    if (!bar?.alive && lv?.retreatTo !== undefined) {
      const stair = this.floors!.stairs[0];
      return {
        blockX: stair.x0,
        hitBlock: () => {},
        blockerFor: (x, y) => this.outpost.blockerFor(x, y, stair.x0, front.side),
        speedMul: (x, y) => this.outpost.speedMul(x, y) * this.terrain.speedMul(x, y),
        player: { x: this.player.footX, y: this.player.footY, alive: this.player.alive && same(this.player.footY) },
        hitPlayer: (d, fromX, fromY, src) => (this.heroSys ? this.heroSys.hitPlayer(d, fromX, fromY, src) : this.player.takeDamage(d, fromX, fromY)),
        others: [...this.companions.targets(), ...this.props.lureTargets(), ...(this.rescue?.targets() ?? [])].filter((t) => same(t.y)),
        zombies: this.zombies,
      };
    }
    const blocker = bar?.alive
      ? {
          blockX: bar.frontX,
          hitBlock: (d: number, y: number) => {
            bar.takeDamage(d, y);
            const bx = bar.frontX;
            GameEvents.of(this).emit('barricade:hit', { damage: d, y, hp: bar.hp, maxHp: bar.maxHp, x: bx });
            if (!bar.alive) {
              GameEvents.of(this).emit('barricade:break', { x: bx });
              if (this.dual) this.fx.popText(bx, LANE_TOP - 30, front.side < 0 ? '左側路障倒了！' : '右側路障倒了！', '#ff8a80');
              if (lv?.retreatTo !== undefined) this.retreat(lv.retreatTo);
              else if (lv) this.fx.popText(bx, lv.y - 70, `${lv.name} 路障倒了！`, '#ff8a80');
            }
          },
        }
      : {
          blockX: front.baseX,
          hitBlock: (d: number) => {
            const st = GameState.data;
            st.baseHp = Math.max(0, st.baseHp - d);
            GameEvents.of(this).emit('base:hit', { damage: d, hp: st.baseHp, maxHp: st.baseMaxHp, x: front.baseX });
          },
        };
    const minFront = blocker.blockX;
    return {
      ...blocker,
      blockerFor: (x, y) => this.outpost.blockerFor(x, y, minFront, front.side),
      speedMul: (x, y) => this.outpost.speedMul(x, y) * this.terrain.speedMul(x, y),
      player: { x: this.player.footX, y: this.player.footY, alive: this.player.alive && same(this.player.footY) },
      // 受擊回饋（震動、紅邊、卡肉）在 wireFeedback() 裡訂閱 player:hurt
      hitPlayer: (d, fromX, fromY, src) => (this.heroSys ? this.heroSys.hitPlayer(d, fromX, fromY, src) : this.player.takeDamage(d, fromX, fromY)),
      others: [...this.companions.targets(), ...this.props.lureTargets(), ...(this.rescue?.targets() ?? [])].filter((t) => same(t.y)),
      zombies: this.zombies,
    };
  }

  update(_time: number, deltaMs: number): void {
    if (this.uiCam) splitUiObjects(this, this.uiCam);
    if (this.ended) return;
    // 卡肉（hit-stop）期間 timeScale 為 0，整個戰場停頓一下
    const dt = Math.min(deltaMs / 1000, 0.05) * this.fx.timeScale;
    if (this.phase === 'day') {
      this.build.update(dt);
      this.updateSideTags();
      // 白天：槍口朝前稍微放低；在軍械庫換了配置，手上的槍跟著換
      this.rig.setWeapon(GameState.data.armory.loadout[0] ?? 'm1911');
      this.updateRig(dt, this.player.footX + 100, this.player.footY - 20);
      return;
    }
    const inp = this.input2.update();

    // 近戰模式切換（4／X／觸控「持刀」）先處理：近戰模式中按換槍是回到槍
    const melee = this.melee.handleInput(inp);
    // 武器
    if (inp.selectWeapon >= 0) this.weapons.select(inp.selectWeapon);
    if (inp.nextWeapon) this.weapons.next();
    // 揮擊中按換彈不吃鍵：收招後自動開始換
    const frameDt = Math.min(deltaMs / 1000, 0.05);
    if (this.melee.reloadNow(inp.reloadPressed, frameDt)) this.weapons.reload();
    // 槍的冷卻、換彈用真實時間：卡肉不會拖慢射速
    this.weapons.update(frameDt);
    // 觸控沒在點畫面時，近戰方向看搖桿／面向（不是上一次點的位置或按鈕的位置）
    const meleeAim = touchMeleeAimX(inp, this.player.footX, this.player.facing);
    // 近戰：拿槍時隨時快揮一下，近戰模式下攻擊鍵就是揮；會打斷換彈
    this.junkCd = Math.max(0, this.junkCd - frameDt);
    if (melee.swing && this.player.alive && this.tryThrowJunk(inp.aimX, inp.aimY, melee.pressed)) {
      // 陽台上瞄準樓下：近戰鍵變成往下丟雜物
    } else if (melee.swing && this.player.alive) {
      this.weapons.cancelReload();
      this.melee.trySwing(this.player, meleeAim, melee.pressed);
    }
    const meleeRes = this.melee.update(dt, this.player, this.zombies);
    this.kills += meleeRes.kills;
    // 負重：拿機槍走得慢、近戰模式輕快、揮鈍器時站定；衝刺變快、被抓住變超慢
    const heroMul = this.heroSys ? this.heroSys.update(dt, inp.moveX !== 0 || inp.moveY !== 0) : 1;
    this.player.speedMul = this.melee.moveMul(this.weapons.active.def.moveMul) * heroMul * this.terrain.playerMul(this.player.footX, this.player.footY);

    // 主角移動：據點外牆內側到戰場右緣（揮擊中不轉身）
    // 近戰模式＋觸控：面向跟著搖桿（沒有槍要瞄）
    // 多樓層據點：上下鍵留給樓梯；頂樓只蓋到一半，走不出去
    const lvNow = this.floors?.levels[floorOf(this.player.footY)];
    const maxX = lvNow?.x1 !== undefined ? lvNow.x1 - 6 : WORLD_WIDTH - 16;
    this.player.update(dt, this.climb ? 0 : inp.moveX, this.floors && !lvNow?.band ? 0 : inp.moveY, this.melee.aimX(this.player, this.melee.stance ? meleeAim : inp.aimX), { minX: this.dual ? 16 : BASE_X + 14, maxX });
    if (this.floors) this.updateStairs(dt, inp.moveY);

    const p = this.player;
    // 手上的武器先擺好姿勢，子彈從真正的槍口射出
    this.rig.setWeapon(this.weapons.active.def.id);
    const mp = this.melee.pose;
    this.rig.setMelee(mp ? { id: this.melee.def.id, ...mp } : null);
    this.rig.bodyDrawsArms = this.player.setMeleePose(mp ?? null);
    this.updateRig(dt, inp.aimX, inp.aimY);
    const muzzleX = this.rig.muzzle.x;
    const muzzleY = this.rig.muzzle.y;
    // 狙擊鏡：開鏡時鏡頭跟著準星平移到整張地圖（爬樓梯中不能開鏡）
    this.scope?.update(Math.min(deltaMs / 1000, 0.05), inp.scopeToggle, p.alive && melee.gunAllowed && !this.climb && !this.weapons.unarmed, p.footX, inp.aimX, inp.aimY);
    this.bolts?.update(p.footX, p.footY);
    const shot = p.alive && melee.gunAllowed && !this.climb
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
    this.crosshair.update(realDt, inp.aimX, inp.aimY - climbY, this.weapons.spreadNow(p.moveFactor), aimDist, p.alive && !this.melee.stance);
    this.screenFx.update(realDt, p.hp, p.maxHp);
    // 狀態畫在主角身上：生命＝腳下的光、體力＝藍弧、彈藥跟著準星（src/ui/）
    this.heroStatus?.update(realDt, { footX: p.footX, footY: p.footY, hp: p.hp, maxHp: p.maxHp, alive: p.alive, stamina: this.melee.staminaRatio });
    const wa = this.weapons.active;
    this.aimReadout?.update(realDt, {
      aimX: inp.aimX,
      aimY: inp.aimY - climbY,
      gun: p.alive && !this.melee.stance && !this.weapons.unarmed,
      ammo: wa.ammo,
      magazine: wa.def.magazine,
      reserve: this.weapons.reserve(),
      reloading: this.weapons.reloading,
      reloadProgress: this.weapons.reloadProgress,
      weaponId: wa.def.id,
      weaponName: wa.def.name,
      meleeStance: this.melee.stance,
      meleeName: this.melee.def.name,
      chain: this.melee.chain,
      headX: p.footX,
      headY: p.footY - 62,
      grabbed: this.heroSys?.hud()?.grabbed,
    });

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
      (side, floor) => (this.floors ? this.floorBarricade(floor) : this.outpost.barricadeOf(side)),
    );
    this.kills += ally.kills;
    this.headshots += ally.headshots;

    // 敵人
    const ctxs = this.fronts.map((f) => this.zombieContext(f));
    const ctxL = ctxs[1] ?? ctxs[0];
    if (this.floors) {
      // 多樓層：每隻用自己那層的；烏鴉會飛，哪層都追
      const air = this.zombieContext(this.fronts[0], true);
      for (const z of this.zombies) z.update(dt, z.spec.body === 'crow' ? air : ctxs[floorOf(z.footY)] ?? ctxs[0]);
      if (this.retreated >= 0) this.updateRetreat();
    } else for (const z of this.zombies) z.update(dt, z.side < 0 ? ctxL : ctxs[0]);
    // 場景道具：油桶、火堆、汽車警報、掉落物；掩體擋路
    this.props.update(dt);
    this.props.collide(this.player);
    for (const z of this.zombies) if (!z.dead && z.spec.body !== 'crow') this.props.collide(z);
    // 地形：障礙物擋人（霧屍會繞）、油漬碰到火會燒起來
    this.terrain.collide(this.player);
    for (const z of this.zombies) if (!z.dead && z.spec.body !== 'crow') this.terrain.collide(z);
    for (const c of this.companions.companions) if (c.alive) this.terrain.collide(c);
    this.terrain.update([this.player, ...this.zombies.filter((z) => !z.dead)], this.props);
    // 陷阱與砲塔
    this.kills += this.outpost.update(dt, this.zombies);
    this.rescue?.update(dt);
    this.collectScrap();
    this.drops.update(dt, p.footX, p.footY, p.alive);
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    for (let i = 0; i < this.zombies.length; i++) {
      for (let j = i + 1; j < this.zombies.length; j++) Zombie.separate(this.zombies[i], this.zombies[j]);
    }
    if (this.tutorial) {
      this.tutorial.update(dt);
      // 血太少就補一點，讓新手專心練操作
      if (p.hp < p.maxHp * 0.3) {
        p.heal(p.maxHp * 0.5);
        this.fx.popText(p.footX, p.footY - 56, '教學中不會倒下', '#9ad17a');
      }
      this.events.emit('hud', this.hud());
      return;
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
    // 職業霧屍有機率掉出生前的裝備（警察掉手槍彈、士兵掉步槍彈…）
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
    // 沒有槍（阿凱開局）就不畫槍，近戰武器照樣畫
    const armed = this.weapons ? !this.weapons.unarmed : GameState.data.armory.loadout.length > 0;
    this.rig.setVisible(p.alive && armed);
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
    // 開槍不晃鏡頭（全畫面晃動刺眼又暈）；後座力表現在槍和人身上
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
      // 雙面據點：顯示比較危險的那一道
      barricadeHp: this.weakestBarricade().hp,
      barricadeMaxHp: this.weakestBarricade().maxHp,
      weaponName: w.def.name,
      weaponId: w.def.id,
      weaponModel: w.def.model,
      ammo: w.ammo,
      magazine: w.def.magazine,
      reserve: this.weapons.reserve(),
      slots: this.weapons.weapons.map((g) => g.def.name),
      slot: this.weapons.current,
      meleeName: this.melee.def.name,
      meleeId: this.melee.def.id,
      meleeStance: this.melee.stance,
      unarmed: this.weapons.unarmed,
      meleeChain: this.melee.chain,
      stamina: this.melee.staminaRatio,
      meleeBusy: this.melee.busy,
      reloading: this.weapons.reloading,
      reloadProgress: this.weapons.reloadProgress,
      wave: this.tutorial ? 1 : Math.max(1, this.spawner.waveIndex + 1),
      totalWaves: this.tutorial ? 1 : this.spawner.totalWaves,
      tutorial: !!this.tutorial,
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
      // 十字弓的箭：天亮後把插在地上、屍體上的都撿回來
      this.bolts?.collectAll();
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

/** 雙面據點：每組霧屍數量乘上倍率（兩邊分攤，總量稍多） */
function scaleNight(night: WaveDef[], mul: number): WaveDef[] {
  return night.map((w) => ({
    ...w,
    groups: w.groups.map((g) => ({ ...g, count: Math.max(1, Math.round(g.count * mul)), interval: g.interval / mul })),
  }));
}

/**
 * 窄巷這種單軸據點：只有一個入口好守，所以霧屍更多、更快——
 * 每組數量乘上倍率，平民霧屍有一部分換成跑者。
 */
function singleLaneNight(night: WaveDef[], single?: { waves: number; runners: number }): WaveDef[] {
  if (!single) return night;
  return night.map((w) => ({
    ...w,
    groups: w.groups.flatMap((g) => {
      const count = Math.max(1, Math.round(g.count * single.waves));
      if (g.enemy !== 'basic') return [{ ...g, count }];
      const runners = Math.round(count * single.runners);
      const out = [{ ...g, count: count - runners, interval: g.interval / single.waves }];
      if (runners > 0) out.push({ ...g, enemy: 'runner', count: runners, interval: (g.interval * 2) / single.waves, startDelay: (g.startDelay ?? 0) + 1 });
      return out;
    }),
  }));
}
