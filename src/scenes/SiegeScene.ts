import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { SiegeSpec } from '../data/explore';
import { Expedition, playerExploreHp } from '../explore/Expedition';
import { lookFor } from '../art/EventArt';
import { ensureHeroTexture } from '../art/HeroArt';
import { paintLookTexture } from '../art/CrewArt';
import { stripArms } from '../art/WeaponArt';
import { generateCrewProfile } from '../data/crewGen';
import { zombieBaseOf } from '../art/ZombieComposer';
import { rollZombie } from '../systems/ZombieFactory';
import { GameState } from '../state/GameState';
import { rumble } from '../feel/Haptics';
import { tone } from '../art/Painter';
import { pixelText } from '../utils/text';
import { addUiCamera, setViewZoom, toLogical } from '../render/RenderScale';

export type SiegeResult = 'win' | 'failed' | 'down';

export interface SiegeData {
  spec: SiegeSpec;
  zone: string;
  /** 區域風險：霧屍爬得更快 */
  risk: number;
  onDone: (r: SiegeResult) => void;
}

/**
 * 破口：霧屍從這裡爬上來／敲破玻璃／從通風口鑽下來。
 * climb：公車側面往車頂爬（爬上來就撲主角）；window／door：敲玻璃（破了就衝倖存者）；vent：天花板通風口。
 */
type SpotKind = 'climb' | 'window' | 'door' | 'vent';
interface Spot {
  x: number;
  kind: SpotKind;
  /** 0～1，滿了就破 */
  progress: number;
  /** 破過一次的窗戶之後爬得更快 */
  broken: boolean;
  /** 冷卻：被打下去／破完之後，隔一下才有下一隻 */
  wait: number;
  active: boolean;
  zombie: Phaser.GameObjects.Sprite | null;
  warn: Phaser.GameObjects.Text;
  /** 被主角打的硬直（這段時間不會往上爬） */
  stun: number;
}

/** 破口衝進來的霧屍：走向目標，打兩下才死 */
interface Intruder {
  s: Phaser.GameObjects.Sprite;
  hp: number;
  atk: number;
  dead: boolean;
}

interface Layout {
  /** 主角腳底的線、左右範圍 */
  standY: number;
  minX: number;
  maxX: number;
  startX: number;
  spots: { x: number; kind: SpotKind }[];
  /** 倖存者的位置（衝進來的霧屍會往這裡走；公車版倖存者在車裡，破窗直接扣血） */
  survivors: { x: number; y: number }[];
  /** 破口霧屍衝進來後要打誰 */
  intruderTarget: 'player' | 'survivor';
  goal: string;
  shouts: string[];
  winText: string;
}

const LAYOUTS: Record<SiegeSpec['layout'], Layout> = {
  bus: {
    standY: 200,
    minX: 162,
    maxX: 478,
    startX: 320,
    spots: [
      { x: 166, kind: 'window' },
      { x: 214, kind: 'door' },
      { x: 272, kind: 'climb' },
      { x: 344, kind: 'climb' },
      { x: 408, kind: 'climb' },
      { x: 468, kind: 'climb' },
    ],
    survivors: [{ x: 180, y: 268 }],
    intruderTarget: 'player',
    goal: '引擎發動中',
    shouts: ['快點啊！', '發動啊！拜託！', '牠們在敲窗戶！', '救命！', '再一下！就快了！'],
    winText: '引擎發動了！',
  },
  store: {
    standY: 300,
    minX: 92,
    maxX: 548,
    startX: 320,
    spots: [
      { x: 104, kind: 'door' },
      { x: 210, kind: 'window' },
      { x: 300, kind: 'vent' },
      { x: 430, kind: 'window' },
      { x: 536, kind: 'window' },
    ],
    survivors: [
      { x: 336, y: 300 },
      { x: 262, y: 300 },
      { x: 386, y: 300 },
    ],
    intruderTarget: 'survivor',
    goal: '後門撬開中',
    shouts: ['玻璃要破了！', '快一點！', '媽媽我好怕……', '撬開了沒有？', '牠們從上面來了！'],
    winText: '後門撬開了！',
  },
};

const SPEED = 170;
const ATTACK_CD = 0.3;
const REACH = 34;
/** 被打一下退多少進度 */
const KNOCK = 0.45;
/** 衝進來的霧屍一次咬多少 */
const BITE_PLAYER = 7;
const BITE_SURVIVOR = 9;
/** 公車版：窗戶被敲破，司機直接被咬 */
const BREACH_SURVIVOR = 22;
const SURVIVOR_HP = 100;

/**
 * 圍困救援：場景很小（一台公車、一間便利店），四面八方都是霧屍。
 * 目標不是殺光，是撐到進度條跑滿（引擎發動、後門撬開），中間不能讓倖存者被咬死。
 * 主角只能在車頂／店裡左右跑，到破口旁邊揮棒把爬上來的霧屍打下去、把敲窗的推回去。
 * 急迫感：破口越開越多、爬越來越快、鏡頭慢慢逼近、倖存者尖叫、血少時畫面發紅＋心跳、最後五秒倒數。
 */
export class SiegeScene extends Phaser.Scene {
  private d!: SiegeData;
  private L!: Layout;
  private world!: Phaser.GameObjects.Layer;
  private hud!: Phaser.GameObjects.Layer;
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private player!: Phaser.GameObjects.Sprite;
  private px = 0;
  private hp = 100;
  private maxHp = 100;
  private svHp = SURVIVOR_HP;
  private spots: Spot[] = [];
  private intruders: Intruder[] = [];
  private survivorSprites: Phaser.GameObjects.Sprite[] = [];
  private crowd: Phaser.GameObjects.Sprite[] = [];
  private cracks!: Phaser.GameObjects.Graphics;
  private red!: Phaser.GameObjects.Graphics;
  private elapsed = 0;
  private atkCd = 0;
  private targetX: number | null = null;
  private pendingAttack = false;
  private over = false;
  private shoutCd = 2.5;
  private beatCd = 0;
  private groanCd = 1;
  private keys!: Record<'left' | 'right' | 'a' | 'd' | 'space' | 'j', Phaser.Input.Keyboard.Key>;
  private setGoal!: (r: number) => void;
  private setHp!: (r: number) => void;
  private setSv!: (r: number) => void;
  private countText!: Phaser.GameObjects.Text;
  private aiBat = false;
  private hurtFlash = 0;
  /** 主鏡頭看的中心與拉近倍率（1 = 640×360 全景） */
  private view = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, k: 1 };

  constructor() {
    super('Siege');
  }

  init(d: SiegeData): void {
    this.d = d;
    this.L = LAYOUTS[d.spec.layout];
    this.spots = [];
    this.intruders = [];
    this.survivorSprites = [];
    this.crowd = [];
    this.elapsed = 0;
    this.atkCd = 0;
    this.targetX = null;
    this.pendingAttack = false;
    this.over = false;
    this.shoutCd = 2.5;
    this.beatCd = 0;
    this.svHp = SURVIVOR_HP;
    this.hurtFlash = 0;
  }

  create(): void {
    const exp = Expedition.current;
    this.maxHp = playerExploreHp();
    this.hp = Math.max(1, exp?.hp ?? this.maxHp);
    this.world = this.add.layer();
    this.hud = this.add.layer().setDepth(1000);
    this.cameras.main.ignore(this.hud);
    this.hudCam = addUiCamera(this);
    this.hudCam.ignore(this.world);
    this.view = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, k: 1 };
    this.cameras.main.fadeIn(300, 0, 0, 0);
    AudioManager.setMood('night');

    if (this.d.spec.layout === 'bus') this.drawBus();
    else this.drawStore();
    this.makeCrowd();
    this.cracks = this.w(this.add.graphics().setDepth(14));
    this.makeSpots();
    this.makePlayer();
    this.makeHud();
    this.bindInput();
    this.intro();
  }

  /** 加進世界圖層（會被主鏡頭拉近） */
  private w<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.world.add(o);
    return o;
  }

  private h<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.hud.add(o);
    return o;
  }

  // ── 場景 ──

  private sky(g: Phaser.GameObjects.Graphics, bottom: number): void {
    const l = lookFor(this.d.zone);
    const [top, bot] = l.sky;
    g.fillGradientStyle(tone(top, -0.35), tone(top, -0.35), tone(bot, -0.3), tone(bot, -0.3), 1).fillRect(0, 0, GAME_WIDTH, bottom);
    const rnd = new Phaser.Math.RandomDataGenerator([this.d.zone]);
    let x = -6;
    while (x < GAME_WIDTH) {
      const bw = rnd.between(30, 70);
      const bh = rnd.between(50, 130);
      g.fillStyle(tone(top, -0.55), 1).fillRect(x, bottom - bh, bw, bh);
      for (let wy = bottom - bh + 6; wy < bottom - 8; wy += 9) for (let wx = x + 4; wx < x + bw - 4; wx += 7) if (rnd.frac() < 0.05) g.fillStyle(0x8a6a34, 1).fillRect(wx, wy, 3, 4);
      x += bw + rnd.between(0, 6);
    }
    g.fillStyle(0x9aa3ad, 0.08).fillRect(0, bottom - 40, GAME_WIDTH, 40);
  }

  private drawBus(): void {
    const g = this.w(this.add.graphics().setDepth(0));
    this.sky(g, 292);
    g.fillStyle(0x2a2c32, 1).fillRect(0, 292, GAME_WIDTH, GAME_HEIGHT - 292);
    g.fillStyle(0x4a4c52, 1).fillRect(0, 292, GAME_WIDTH, 2);
    for (let x = 20; x < GAME_WIDTH; x += 70) g.fillStyle(0x8a7a40, 0.6).fillRect(x, 330, 30, 2);
    // 車內（暗）：司機在前面
    const inside = this.w(this.add.graphics().setDepth(10));
    inside.fillStyle(0x0c0e12, 1).fillRect(152, 208, 336, 36);
    const civ = this.civilian(0);
    const sv = this.w(this.add.sprite(182, 258, civ.key, 0).setOrigin(0.5, 63 / 64).setFlipX(false).setDepth(11));
    if (civ.tinted) sv.setTint(0xd8c090);
    this.survivorSprites.push(sv);
    this.tweens.add({ targets: sv, x: 186, duration: 140, yoyo: true, repeat: -1 });
    // 車身（窗戶留空看得到裡面）
    const b = this.w(this.add.graphics().setDepth(12));
    const body = 0xc89a2a;
    b.fillStyle(0x120f0d, 1).fillRect(148, 198, 344, 86);
    b.fillStyle(body, 1).fillRect(150, 200, 340, 8);
    b.fillStyle(tone(body, 0.2), 1).fillRect(150, 200, 340, 2);
    b.fillStyle(body, 1).fillRect(150, 244, 340, 38);
    b.fillStyle(0x8a3a2a, 1).fillRect(150, 258, 340, 5);
    b.fillStyle(tone(body, -0.3), 1).fillRect(150, 278, 340, 4);
    const pillars = [150, 196, 230, 290, 350, 410, 470, 486];
    for (const x of pillars) b.fillStyle(body, 1).fillRect(x, 208, 4, 36);
    // 車門
    b.fillStyle(tone(body, -0.15), 1).fillRect(200, 244, 28, 36);
    b.lineStyle(1, 0x120f0d, 1).strokeRect(200, 210, 28, 70);
    // 車頭燈、輪子
    b.fillStyle(0xf0d060, 1).fillRect(150, 266, 5, 4);
    for (const wx of [214, 432]) {
      b.fillStyle(0x120f0d, 1).fillCircle(wx, 284, 13);
      b.fillStyle(0x4a4a4a, 1).fillCircle(wx, 284, 6);
    }
    // 車頂邊緣
    b.fillStyle(0x6a6a70, 1).fillRect(156, 196, 328, 3);
    // 玻璃反光（之後依破損畫裂痕）
    const glass = this.w(this.add.graphics().setDepth(13));
    for (let i = 0; i < pillars.length - 1; i++) {
      const x0 = pillars[i] + 4;
      const x1 = pillars[i + 1];
      glass.fillStyle(0x8ab0c8, 0.18).fillRect(x0, 208, x1 - x0, 36);
      glass.lineStyle(1, 0xc8e0f0, 0.25).lineBetween(x0 + 3, 240, x0 + 14, 211);
    }
  }

  private drawStore(): void {
    const g = this.w(this.add.graphics().setDepth(0));
    this.sky(g, 300);
    // 店外的地面
    g.fillStyle(0x24262c, 1).fillRect(0, 300, GAME_WIDTH, GAME_HEIGHT - 300);
    // 店（剖面）
    const s = this.w(this.add.graphics().setDepth(12));
    const wall = 0xd8d0b8;
    // 後牆：留出兩扇窗（窗外的霧屍畫在後面）
    const winA = [180, 150, 60, 60];
    const winB = [400, 150, 60, 60];
    const behind = this.w(this.add.graphics().setDepth(7));
    behind.fillStyle(0x0a0c10, 1).fillRect(winA[0], winA[1], winA[2], winA[3]).fillRect(winB[0], winB[1], winB[2], winB[3]);
    s.fillStyle(wall, 1);
    s.fillRect(80, 110, 480, 40);
    s.fillRect(80, 210, 480, 90);
    s.fillRect(80, 150, 100, 60).fillRect(240, 150, 160, 60).fillRect(460, 150, 100, 60);
    s.fillStyle(tone(wall, -0.15), 1).fillRect(80, 270, 480, 30);
    // 天花板、日光燈
    s.fillStyle(0x3a3a40, 1).fillRect(76, 100, 488, 10);
    for (const lx of [150, 300, 450]) {
      s.fillStyle(0xf0f0e0, 1).fillRect(lx - 24, 110, 48, 3);
      s.fillStyle(0xf0f0e0, 0.06).fillTriangle(lx - 30, 113, lx + 30, 113, lx, 220);
    }
    // 通風口
    s.fillStyle(0x120f0d, 1).fillRect(284, 108, 32, 6);
    s.fillStyle(0x6a6a70, 1);
    for (let i = 0; i < 4; i++) s.fillRect(286 + i * 8, 109, 5, 4);
    // 貨架
    for (const [x, w] of [[100, 70], [470, 70]] as const) {
      s.fillStyle(0x5a5a62, 1).fillRect(x, 220, w, 50);
      for (let y = 224; y < 270; y += 12) for (let i = x + 3; i < x + w - 4; i += 6) s.fillStyle([0xc84a3a, 0x3a8ac8, 0xe0c040, 0x4ac06a][(i + y) % 4], 1).fillRect(i, y, 4, 7);
    }
    // 後門（倖存者在撬）
    s.fillStyle(0x120f0d, 1).fillRect(318, 220, 40, 80);
    s.fillStyle(0x6a6e78, 1).fillRect(320, 222, 36, 78);
    s.fillStyle(0x8a8e96, 1).fillRect(322, 224, 32, 3);
    s.fillStyle(0xc0a060, 1).fillRect(350, 258, 3, 6);
    // 櫃台
    s.fillStyle(0x7a5a3a, 1).fillRect(230, 262, 70, 38);
    s.fillStyle(0x9a7a4a, 1).fillRect(228, 258, 74, 5);
    // 地板（磁磚）
    const f = this.w(this.add.graphics().setDepth(1));
    f.fillStyle(0xb8b4a8, 1).fillRect(80, 300, 480, 60);
    for (let x = 80; x < 560; x += 24) f.fillStyle(0x9a968c, 1).fillRect(x, 300, 1, 60);
    for (let y = 312; y < 360; y += 14) f.fillStyle(0x9a968c, 1).fillRect(80, y, 480, 1);
    // 左右兩面：玻璃門、落地窗（外面的霧屍貼在玻璃上）
    const glass = this.w(this.add.graphics().setDepth(13));
    for (const [x, w] of [[80, 46], [514, 46]] as const) {
      glass.fillStyle(0x8ab0c8, 0.16).fillRect(x, 110, w, 190);
      glass.lineStyle(2, 0x3a3a40, 1).strokeRect(x, 110, w, 190);
      glass.lineStyle(1, 0xc8e0f0, 0.3).lineBetween(x + 6, 290, x + w - 8, 130);
    }
    for (const [x, y, w, hh] of [winA, winB]) {
      glass.fillStyle(0x8ab0c8, 0.14).fillRect(x, y, w, hh);
      glass.lineStyle(2, 0x3a3a40, 1).strokeRect(x, y, w, hh);
    }
    // 倖存者：一個在撬後門，兩個縮在櫃台邊
    this.L.survivors.forEach((p, i) => {
      const civ = this.civilian(i);
      const sp = this.w(this.add.sprite(p.x, p.y, civ.key, 0).setOrigin(0.5, 63 / 64).setDepth(30 + i));
      if (civ.tinted) sp.setTint([0xd8c090, 0xc0a8d0, 0xa8c8d0][i]);
      if (i === 0) {
        sp.setFlipX(false);
        this.tweens.add({ targets: sp, angle: -6, duration: 220, yoyo: true, repeat: -1 });
      } else {
        sp.setScale(i === 2 ? 0.75 : 0.9);
        this.tweens.add({ targets: sp, x: p.x + 1, duration: 90, yoyo: true, repeat: -1 });
      }
      this.survivorSprites.push(sp);
    });
  }

  /** 倖存者：隨機一個平民外觀（沒有槍）；畫不出來就用染色的主角圖 */
  private civilian(i: number): { key: string; tinted: boolean } {
    const seed = (Math.random() * 1e9) >>> 0;
    const key = `siege_civ_${i}_${seed}`;
    const prof = generateCrewProfile(i === 0 ? 'engineer' : 'medic', seed);
    if (!paintLookTexture(this, key, prof.look)) return { key: 'player', tinted: true };
    // 平民手上不拿槍：擦掉手臂（跟主角身體圖同一套）
    return { key: stripArms(this, key) ?? key, tinted: false };
  }

  private zombieTexture(): string {
    const ids = ['basic', 'basic', 'worker', 'runner'];
    return rollZombie(this, Phaser.Utils.Array.GetRandom(ids), GameState.data.day).texture;
  }

  /** 霧屍精靈：沿用夜晚的合成外觀，腳底對齊 */
  private zSprite(x: number, y: number, depth: number, flipX: boolean): Phaser.GameObjects.Sprite {
    const tex = this.zombieTexture();
    const base = zombieBaseOf(tex);
    const s = this.w(this.add.sprite(x, y, tex, 0).setDepth(depth));
    s.setOrigin(0.5, this.anims.exists(`${tex}_walk`) ? base.foot / base.size : 1);
    s.setFlipX(flipX);
    if (this.anims.exists(`${tex}_walk`)) s.play({ key: `${tex}_walk`, startFrame: Phaser.Math.Between(0, 3) });
    return s;
  }

  /** 背景的屍群：一大片在晃、往中間擠 */
  private makeCrowd(): void {
    const bus = this.d.spec.layout === 'bus';
    const n = bus ? 30 : 22;
    for (let i = 0; i < n; i++) {
      let x: number;
      let y: number;
      let depth: number;
      if (bus) {
        x = Phaser.Math.Between(-10, GAME_WIDTH + 10);
        const front = Math.random() < 0.45;
        y = front ? Phaser.Math.Between(318, 352) : Phaser.Math.Between(292, 300);
        depth = front ? 40 + (y - 300) * 0.1 : 5;
        if (!front && x > 150 && x < 490) continue;
      } else {
        const left = i % 2 === 0;
        x = left ? Phaser.Math.Between(-10, 74) : Phaser.Math.Between(566, GAME_WIDTH + 10);
        y = Phaser.Math.Between(296, 340);
        depth = 6 + (y - 296) * 0.05;
      }
      const s = this.zSprite(x, y, depth, x > GAME_WIDTH / 2);
      s.setTint(bus && depth > 30 ? 0x6a6a6a : 0x8a8a8a);
      this.crowd.push(s);
      // 往中間擠一點又被推回來
      const dx = x < GAME_WIDTH / 2 ? Phaser.Math.Between(4, 12) : -Phaser.Math.Between(4, 12);
      this.tweens.add({ targets: s, x: x + dx, duration: Phaser.Math.Between(900, 1800), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  private makeSpots(): void {
    for (const sp of this.L.spots) {
      const warn = this.h(pixelText(this, 0, 0, '！', 14, '#ff4a3a').setOrigin(0.5).setStroke('#000000', 3).setVisible(false));
      this.spots.push({ ...sp, progress: 0, broken: false, wait: Phaser.Math.FloatBetween(0, 1.5), active: false, zombie: null, warn, stun: 0 });
    }
    // 一開始先開兩個破口，之後越開越多
    const order = Phaser.Utils.Array.Shuffle(this.spots.slice());
    order.slice(0, 2).forEach((s) => (s.active = true));
  }

  private makePlayer(): void {
    const hero = GameState.data.hero;
    this.aiBat = hero === 'student' && this.anims.exists('akai_ai_idle_bat');
    const key = this.aiBat ? 'akai_ai_idle_bat' : ensureHeroTexture(this, hero) ?? 'player';
    this.px = this.L.startX;
    this.player = this.w(this.add.sprite(this.px, this.L.standY, key, 0).setDepth(35));
    this.player.setOrigin(0.5, this.aiBat ? 62 / 64 : 63 / 64);
    if (this.aiBat) this.player.play('akai_ai_idle_bat');
  }

  private makeHud(): void {
    const bar = (x: number, y: number, w: number, color: number, label: string) => {
      this.h(pixelText(this, x, y - 1, label, 8, '#e0e0e0'));
      this.h(this.add.rectangle(x + 52, y, w + 2, 8, 0x000000).setOrigin(0));
      const fill = this.h(this.add.rectangle(x + 53, y + 1, w, 6, color).setOrigin(0));
      return (r: number) => {
        fill.width = w * Phaser.Math.Clamp(r, 0, 1);
      };
    };
    this.h(this.add.rectangle(0, 0, GAME_WIDTH, 40, 0x000000, 0.55).setOrigin(0));
    this.h(pixelText(this, GAME_WIDTH / 2, 4, this.d.spec.title, 9, '#ffd24a').setOrigin(0.5, 0));
    this.setGoal = bar(GAME_WIDTH / 2 - 120, 22, 180, 0x9ad17a, this.L.goal);
    this.setHp = bar(10, 46, 90, 0xef5350, '你');
    this.setSv = bar(GAME_WIDTH - 156, 46, 90, 0xffd24a, '倖存者');
    this.countText = this.h(pixelText(this, GAME_WIDTH / 2, 120, '', 40, '#ff6b6b').setOrigin(0.5).setStroke('#000000', 6).setAlpha(0));
    const touch = this.sys.game.device.input.touch;
    this.h(pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 12, touch ? '點破口跑過去揮棒・點自己旁邊直接揮' : 'A／D 移動・空白鍵揮棒：把爬上來、敲窗的霧屍打回去', 7, '#c8c8c8').setOrigin(0.5));
    this.red = this.h(this.add.graphics());
  }

  private bindInput(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      a: kb.addKey(K.A),
      d: kb.addKey(K.D),
      space: kb.addKey(K.SPACE),
      j: kb.addKey(K.J),
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      kb.removeAllKeys(true);
      kb.removeAllListeners();
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.over) return;
      const lp = toLogical(p.x, p.y);
      const wp = { x: this.view.x + (lp.x - GAME_WIDTH / 2) / this.view.k };
      if (Math.abs(wp.x - this.px) < 26) {
        this.targetX = null;
        this.attack();
      } else {
        this.targetX = Phaser.Math.Clamp(wp.x, this.L.minX, this.L.maxX);
        this.pendingAttack = true;
      }
    });
  }

  private intro(): void {
    const t = this.h(pixelText(this, GAME_WIDTH / 2, 150, '撐住！', 26, '#ffd24a').setOrigin(0.5).setStroke('#000000', 6));
    t.setScale(2).setAlpha(0);
    this.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
    AudioManager.play('zombie_scream');
  }

  // ── 主迴圈 ──

  update(_t: number, ms: number): void {
    if (this.over) return;
    const dt = Math.min(0.05, ms / 1000);
    this.elapsed += dt;
    const total = this.d.spec.seconds;
    const k = Math.min(1, this.elapsed / total);
    this.atkCd -= dt;
    this.movePlayer(dt);
    this.updateSpots(dt, k);
    this.updateIntruders(dt);
    this.pressure(dt, k);
    this.setGoal(k);
    this.setHp(this.hp / this.maxHp);
    this.setSv(this.svHp / SURVIVOR_HP);
    if (this.hp <= 0) return this.end('down');
    if (this.svHp <= 0) return this.end('failed');
    if (k >= 1) return this.end('win');
  }

  private movePlayer(dt: number): void {
    const K = this.keys;
    let dir = 0;
    if (K.left.isDown || K.a.isDown) dir -= 1;
    if (K.right.isDown || K.d.isDown) dir += 1;
    if (dir) this.targetX = null;
    if (Phaser.Input.Keyboard.JustDown(K.space) || Phaser.Input.Keyboard.JustDown(K.j)) this.attack();
    if (!dir && this.targetX !== null) {
      const dx = this.targetX - this.px;
      if (Math.abs(dx) < 4) {
        this.targetX = null;
        if (this.pendingAttack) this.attack();
        this.pendingAttack = false;
      } else dir = Math.sign(dx);
    }
    this.px = Phaser.Math.Clamp(this.px + dir * SPEED * dt, this.L.minX, this.L.maxX);
    this.player.x = this.px;
    if (dir) this.player.setFlipX(dir < 0);
    if (this.aiBat) {
      const want = dir ? 'akai_ai_walk_bat' : 'akai_ai_idle_bat';
      if (this.player.anims.currentAnim?.key !== want) this.player.play(want);
    } else if (dir) this.player.y = this.L.standY - Math.abs(Math.sin(this.elapsed * 14)) * 2;
    else this.player.y = this.L.standY;
  }

  /** 破口：越後面開越多、爬越快；被打會退、有硬直 */
  private updateSpots(dt: number, k: number): void {
    const want = Math.min(this.spots.length, 2 + Math.floor(k * (this.spots.length + 1)));
    const idle = this.spots.filter((s) => !s.active);
    if (this.spots.length - idle.length < want && idle.length) Phaser.Utils.Array.GetRandom(idle).active = true;
    const rate = (1 / 7.5) * (1 + k * 1.1) * (1 + (this.d.risk - 1) * 0.08);
    this.cracks.clear();
    for (const s of this.spots) {
      if (!s.active) continue;
      if (s.wait > 0) {
        s.wait -= dt;
        if (s.wait <= 0) this.spawnAt(s);
        continue;
      }
      if (!s.zombie) this.spawnAt(s);
      s.stun -= dt;
      // 主角站在旁邊頂著：慢很多
      const guarded = Math.abs(this.px - s.x) < REACH;
      if (s.stun <= 0) s.progress += dt * rate * (s.broken ? 1.5 : 1) * (guarded ? 0.35 : 1);
      this.drawSpot(s);
      if (s.progress >= 1) this.breach(s);
    }
  }

  private spotZombieY(s: Spot): number {
    if (this.d.spec.layout === 'bus') return s.kind === 'climb' ? 304 - s.progress * 100 : 298;
    // 通風口：腳先從天花板垂下來，越爬越低
    if (s.kind === 'vent') return 114 + s.progress * 46;
    if (s.kind === 'window' && (s.x === 210 || s.x === 430)) return 224;
    return 300;
  }

  private spawnAt(s: Spot): void {
    s.progress = 0;
    s.stun = 0.3;
    s.zombie?.destroy();
    const bus = this.d.spec.layout === 'bus';
    let x = s.x;
    let depth = 20;
    if (!bus) {
      if (s.kind === 'door') x = s.x - 34;
      else if (s.x === 536) x = s.x + 34;
      depth = s.kind === 'vent' ? 11 : s.x === 210 || s.x === 430 ? 8 : 14;
    }
    const z = this.zSprite(x, this.spotZombieY(s), depth, x > GAME_WIDTH / 2 && !bus ? true : s.x > GAME_WIDTH / 2);
    if (!bus && (s.x === 210 || s.x === 430)) z.setScale(0.85).setTint(0x7a7a7a);
    if (s.kind === 'vent') {
      z.setTint(0x9a9a9a).setDepth(13.5);
      // 天花板以上的部分藏起來
      const m = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(80, 110, 480, 200);
      z.setMask(m.createGeometryMask());
    }
    s.zombie = z;
  }

  private drawSpot(s: Spot): void {
    const z = s.zombie;
    if (z) {
      z.y = this.spotZombieY(s) + (s.stun > 0 ? 4 : 0);
      if (s.kind !== 'climb' && s.kind !== 'vent' && Math.random() < 0.02) {
        const atk = `${z.texture.key}_attack`;
        if (this.anims.exists(atk)) z.play(atk).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => z.active && this.anims.exists(`${z.texture.key}_walk`) && z.play(`${z.texture.key}_walk`));
        AudioManager.play(this.d.spec.layout === 'store' ? 'barricade_hit' : 'base_hit');
      }
    }
    // 裂痕／警示
    const p = s.progress;
    const g = this.cracks;
    if (s.kind === 'window' || s.kind === 'door') {
      const [cx, cy] = this.glassCenter(s);
      const n = Math.floor(p * 7);
      g.lineStyle(1, 0xffffff, 0.7);
      for (let i = 0; i < n; i++) {
        const a = (i / 7) * Math.PI * 2 + s.x;
        g.lineBetween(cx, cy, cx + Math.cos(a) * (8 + p * 16), cy + Math.sin(a) * (6 + p * 12));
      }
    }
    const warn = p > 0.55;
    s.warn.setVisible(warn);
    if (warn) {
      const wp = this.toHud(s.x, this.d.spec.layout === 'bus' ? 182 : s.kind === 'vent' ? 96 : 132);
      s.warn.setPosition(wp.x, wp.y - (p > 0.8 ? Math.abs(Math.sin(this.elapsed * 12)) * 4 : 0));
      s.warn.setColor(p > 0.8 ? '#ff2a1a' : '#ffaa3a').setScale(p > 0.8 ? 1.3 : 1);
    }
  }

  private glassCenter(s: Spot): [number, number] {
    if (this.d.spec.layout === 'bus') return [s.x, 226];
    if (s.x === 210 || s.x === 430) return [s.x, 180];
    return [s.x, 220];
  }

  /** 世界座標換到 HUD（主鏡頭有拉近） */
  private toHud(x: number, y: number): Phaser.Math.Vector2 {
    const v = this.view;
    return new Phaser.Math.Vector2((x - v.x) * v.k + GAME_WIDTH / 2, (y - v.y) * v.k + GAME_HEIGHT / 2);
  }

  /** 破了：公車窗戶直接扣倖存者；爬上車頂或衝進店裡的變成近身霧屍 */
  private breach(s: Spot): void {
    const bus = this.d.spec.layout === 'bus';
    s.progress = 0;
    s.wait = 2.2;
    s.warn.setVisible(false);
    const z = s.zombie;
    s.zombie = null;
    if (bus && s.kind !== 'climb') {
      s.broken = true;
      z?.destroy();
      this.hurtSurvivor(BREACH_SURVIVOR, s.x);
      AudioManager.play('glass_break');
      return;
    }
    if (!z) return;
    if (s.kind !== 'climb') {
      s.broken = true;
      AudioManager.play('glass_break');
    }
    // 落到主角這一層
    z.clearMask(true);
    z.setScale(1).clearTint().setDepth(34);
    const y = this.L.standY;
    this.tweens.add({ targets: z, y, x: Phaser.Math.Clamp(z.x, this.L.minX, this.L.maxX), duration: 220, ease: 'Quad.easeIn' });
    this.intruders.push({ s: z, hp: 2, atk: 0.6, dead: false });
    AudioManager.play('zombie_scream');
    this.cameras.main.shake(140, 0.006);
  }

  private updateIntruders(dt: number): void {
    const bus = this.d.spec.layout === 'bus';
    for (const it of this.intruders) {
      if (it.dead) continue;
      const tx = this.L.intruderTarget === 'player' ? this.px : this.nearestSurvivor(it.s.x);
      const dx = tx - it.s.x;
      it.s.setFlipX(dx < 0);
      if (Math.abs(dx) > 16) it.s.x += Math.sign(dx) * (bus ? 46 : 58) * dt;
      else {
        it.atk -= dt;
        if (it.atk <= 0) {
          it.atk = 0.9;
          const atk = `${it.s.texture.key}_attack`;
          if (this.anims.exists(atk)) it.s.play(atk).once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => !it.dead && this.anims.exists(`${it.s.texture.key}_walk`) && it.s.play(`${it.s.texture.key}_walk`));
          AudioManager.play('zombie_attack');
          if (this.L.intruderTarget === 'player') this.hurtPlayer(BITE_PLAYER);
          else this.hurtSurvivor(BITE_SURVIVOR, it.s.x);
        }
      }
    }
    this.intruders = this.intruders.filter((i) => !i.dead || i.s.active);
  }

  private nearestSurvivor(x: number): number {
    let best = this.L.survivors[0].x;
    for (const s of this.L.survivors) if (Math.abs(s.x - x) < Math.abs(best - x)) best = s.x;
    return best;
  }

  // ── 攻擊 ──

  private attack(): void {
    if (this.over || this.atkCd > 0) return;
    this.atkCd = ATTACK_CD;
    AudioManager.play('swing_heavy');
    const face = this.player.flipX ? -1 : 1;
    // 揮棒的弧線
    const arc = this.w(this.add.graphics().setDepth(36));
    arc.lineStyle(3, 0xffffff, 0.8);
    arc.beginPath();
    arc.arc(this.px + face * 10, this.L.standY - 24, 22, face > 0 ? -1.4 : Math.PI + 1.4, face > 0 ? 0.9 : Math.PI - 0.9, face < 0);
    arc.strokePath();
    this.tweens.add({ targets: arc, alpha: 0, duration: 160, onComplete: () => arc.destroy() });
    this.tweens.add({ targets: this.player, angle: face * 10, duration: 70, yoyo: true });
    // 先打身邊衝進來的
    const near = this.intruders.filter((i) => !i.dead && Math.abs(i.s.x - this.px) < REACH + 6).sort((a, b) => Math.abs(a.s.x - this.px) - Math.abs(b.s.x - this.px))[0];
    if (near) {
      near.hp--;
      this.hitFx(near.s.x, this.L.standY - 26);
      near.s.x += face * 14;
      if (near.hp <= 0) this.killIntruder(near, face);
      return;
    }
    // 再打破口的
    const spot = this.spots.filter((s) => s.zombie && Math.abs(s.x - this.px) < REACH).sort((a, b) => Math.abs(a.x - this.px) - Math.abs(b.x - this.px))[0];
    if (spot && spot.zombie) {
      spot.progress = Math.max(0, spot.progress - KNOCK);
      spot.stun = 0.7;
      const z = spot.zombie;
      this.hitFx(z.x, Math.min(z.y - 20, this.L.standY - 10));
      if (spot.progress <= 0.02) {
        // 打下去了：掉回屍群，隔一下才有下一隻
        spot.zombie = null;
        spot.wait = 1.6;
        const bus = this.d.spec.layout === 'bus';
        this.tweens.add({ targets: z, y: z.y + (bus ? 40 : 8), alpha: 0, angle: face * 40, duration: 380, onComplete: () => z.destroy() });
      }
    }
  }

  private killIntruder(it: Intruder, face: number): void {
    it.dead = true;
    AudioManager.play('zombie_death');
    const bus = this.d.spec.layout === 'bus';
    const death = `${it.s.texture.key}_death`;
    if (bus) {
      // 從車頂打下去
      this.tweens.add({ targets: it.s, x: it.s.x + face * 30, y: it.s.y + 110, angle: face * 80, alpha: 0.2, duration: 500, ease: 'Quad.easeIn', onComplete: () => it.s.destroy() });
    } else if (this.anims.exists(death)) {
      it.s.play(death);
      this.tweens.add({ targets: it.s, alpha: 0, delay: 900, duration: 400, onComplete: () => it.s.destroy() });
    } else this.tweens.add({ targets: it.s, alpha: 0, duration: 400, onComplete: () => it.s.destroy() });
  }

  private hitFx(x: number, y: number): void {
    AudioManager.play('melee_blunt');
    rumble(40, 0.4);
    const f = this.w(this.add.star(x, y, 6, 3, 9, 0xffffff).setDepth(50));
    this.tweens.add({ targets: f, scale: 1.8, alpha: 0, duration: 160, onComplete: () => f.destroy() });
    for (let i = 0; i < 4; i++) {
      const b = this.w(this.add.rectangle(x, y, 2, 2, 0x8a1a1a).setDepth(50));
      this.tweens.add({ targets: b, x: x + Phaser.Math.Between(-16, 16), y: y + Phaser.Math.Between(-4, 18), alpha: 0, duration: 300, onComplete: () => b.destroy() });
    }
  }

  private hurtPlayer(n: number): void {
    this.hp = Math.max(0, this.hp - n);
    this.hurtFlash = 1;
    AudioManager.play('player_hurt');
    rumble(90, 0.7);
    this.cameras.main.shake(120, 0.008);
    this.player.setTint(0xff6a6a);
    this.time.delayedCall(120, () => this.player.clearTint());
  }

  private hurtSurvivor(n: number, x: number): void {
    this.svHp = Math.max(0, this.svHp - n);
    this.hurtFlash = Math.max(this.hurtFlash, 0.7);
    for (const s of this.survivorSprites) {
      s.setTint(0xff6a6a);
      this.time.delayedCall(140, () => s.active && (s.texture.key === 'player' ? s.setTint(0xd8c090) : s.clearTint()));
    }
    this.shout(this.svHp < 35 ? '啊啊啊！救我！' : '牠咬到我了！', x, true);
  }

  // ── 壓迫感 ──

  private pressure(dt: number, k: number): void {
    // 鏡頭慢慢逼近（以主角為中心）
    const cam = this.cameras.main;
    const zoom = 1 + k * 0.16 + (1 - this.svHp / SURVIVOR_HP) * 0.05;
    const hw = GAME_WIDTH / 2 / zoom;
    const hh = GAME_HEIGHT / 2 / zoom;
    // 不要拍到 640×360 以外的地方
    const cx = Phaser.Math.Clamp(Phaser.Math.Linear(GAME_WIDTH / 2, this.px, 0.35 * k), hw, GAME_WIDTH - hw);
    const cy = Phaser.Math.Clamp(Phaser.Math.Linear(GAME_HEIGHT / 2, this.L.standY - 20, 0.3 * k), hh, GAME_HEIGHT - hh);
    this.view = { x: cx, y: cy, k: zoom };
    setViewZoom(cam, zoom);
    cam.centerOn(cx, cy);
    // 紅色暗角：倖存者／自己越危險越紅，心跳
    const danger = Math.max(1 - this.svHp / SURVIVOR_HP, 1 - this.hp / this.maxHp);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    const pulse = danger > 0.55 ? 0.08 * (0.5 + 0.5 * Math.sin(this.elapsed * 8)) : 0;
    const a = Math.min(0.55, danger * 0.32 + pulse + this.hurtFlash * 0.25);
    this.red.clear();
    for (let i = 0; i < 10; i++) {
      const t = 1 - i / 10;
      this.red.fillStyle(0x8a0000, a * t * 0.35);
      this.red.fillRect(0, i * 5, GAME_WIDTH, 5).fillRect(0, GAME_HEIGHT - (i + 1) * 5, GAME_WIDTH, 5);
      this.red.fillRect(i * 8, 0, 8, GAME_HEIGHT).fillRect(GAME_WIDTH - (i + 1) * 8, 0, 8, GAME_HEIGHT);
    }
    this.beatCd -= dt;
    if ((danger > 0.55 || k > 0.85) && this.beatCd <= 0) {
      this.beatCd = danger > 0.75 ? 0.55 : 0.8;
      AudioManager.play('heartbeat');
    }
    this.groanCd -= dt;
    if (this.groanCd <= 0) {
      this.groanCd = Phaser.Math.FloatBetween(0.6, 1.4) * (1 - k * 0.4);
      AudioManager.play('zombie_groan');
    }
    // 倖存者喊叫
    this.shoutCd -= dt;
    if (this.shoutCd <= 0) {
      this.shoutCd = Phaser.Math.FloatBetween(2.6, 4.2);
      const s = this.L.survivors[0];
      this.shout(Phaser.Utils.Array.GetRandom(this.L.shouts), s.x, false);
    }
    // 最後五秒倒數
    const left = Math.ceil(this.d.spec.seconds - this.elapsed);
    if (left <= 5 && left >= 1 && this.countText.text !== `${left}`) {
      this.countText.setText(`${left}`).setAlpha(1).setScale(1.6);
      this.tweens.add({ targets: this.countText, scale: 1, alpha: 0.4, duration: 600 });
      AudioManager.ui('tap');
    }
  }

  private shout(text: string, x: number, hurt: boolean): void {
    const wp = this.toHud(x, this.d.spec.layout === 'bus' ? 214 : 250);
    const t = this.h(pixelText(this, wp.x, wp.y, text, 8, hurt ? '#ff8a80' : '#ffffff').setOrigin(0.5, 1).setStroke('#000000', 3));
    const bg = this.h(this.add.rectangle(wp.x, wp.y + 1, t.width + 8, t.height + 4, 0x000000, 0.55).setOrigin(0.5, 1));
    this.hud.moveDown(bg);
    this.tweens.add({ targets: [t, bg], y: wp.y - 16, alpha: 0, delay: 900, duration: 500, onComplete: () => (t.destroy(), bg.destroy()) });
  }

  // ── 結束 ──

  private end(r: SiegeResult): void {
    if (this.over) return;
    this.over = true;
    for (const s of this.spots) s.warn.setVisible(false);
    const exp = Expedition.current;
    if (exp) exp.hp = Math.max(0, this.hp);
    const title = r === 'win' ? this.L.winText : r === 'down' ? '你倒下了' : '倖存者沒撐住……';
    const t = this.h(pixelText(this, GAME_WIDTH / 2, 150, title, 22, r === 'win' ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setStroke('#000000', 6));
    t.setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
    let delay = 1500;
    if (r === 'win') {
      AudioManager.play('stinger_win');
      delay = this.winCinematic();
    } else AudioManager.play('stinger_lose');
    this.time.delayedCall(delay, () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const cb = this.d.onDone;
        this.scene.stop();
        cb(r);
      });
    });
  }

  /** 勝利演出：公車輾開屍群衝出去／一家人從後門跑掉 */
  private winCinematic(): number {
    for (const it of this.intruders) if (!it.dead) this.killIntruder(it, 1);
    for (const s of this.spots) {
      const z = s.zombie;
      if (z) this.tweens.add({ targets: z, alpha: 0, y: z.y + 20, duration: 300, onComplete: () => z.destroy() });
      s.zombie = null;
    }
    if (this.d.spec.layout === 'bus') {
      AudioManager.play('car_alarm');
      this.cameras.main.shake(600, 0.01);
      // 整台車（含車頂上的主角、司機）往右衝；屍群被撞開
      const movers = this.world.list.filter((o) => {
        const d = (o as unknown as { depth: number }).depth;
        return d >= 10 && d <= 14;
      });
      movers.push(this.player, this.cracks);
      this.tweens.add({ targets: movers, x: '+=520', duration: 1500, delay: 400, ease: 'Quad.easeIn' });
      for (const c of this.crowd) {
        if (c.x > 140) this.tweens.add({ targets: c, x: c.x + Phaser.Math.Between(20, 80), y: c.y + Phaser.Math.Between(-30, 10), angle: 90, alpha: 0, delay: 500 + (c.x - 140) * 2, duration: 400 });
      }
      return 2100;
    }
    // 便利店：後門打開，大家往門跑
    const door = this.w(this.add.rectangle(320, 222, 36, 78, 0x050505).setOrigin(0).setDepth(13));
    door.setAlpha(0);
    this.tweens.add({ targets: door, alpha: 1, duration: 200 });
    this.survivorSprites.forEach((s, i) => {
      this.tweens.killTweensOf(s);
      s.setAngle(0);
      this.tweens.add({ targets: s, x: 338, alpha: 0, delay: 300 + i * 250, duration: 500 });
    });
    this.tweens.add({ targets: this.player, x: 338, alpha: 0, delay: 1200, duration: 500 });
    return 2000;
  }
}
