import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { pixelText } from '../utils/text';
import { FX, SPLAT_FRAMES } from './FxTextures';

/**
 * 「打擊感」特效總管，每個遊戲場景一個：Fx.attach(scene)，其他地方用 Fx.of(scene) 取得。
 *
 * 所有碎片（血滴、彈殼、木屑、斷頭）都用自寫的小物理：
 * 每顆碎片有自己的「地面 y」，所以之後改成多條上下路線（2.5D）時，
 * 血會落在被打中那隻霧屍腳下，而不是同一條地平線。
 */

interface Debris {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  spin: number;
  floorY: number;
  bounce: number;
  life: number;
  /** 落地時做什麼：留血跡、停在地上、或直接消失 */
  onLand: 'stain' | 'rest' | 'vanish';
  landed: boolean;
}

export interface FallOptions {
  /** 往哪邊倒：1 = 向右（被從左邊打倒）、-1 = 向左 */
  dir: number;
  headshot: boolean;
  /** 斷頭時，頭的影格名稱（BootScene 建立的 `head_N`） */
  headFrame?: string;
  /** 斷頭時，屍體從影格第幾列以下保留 */
  neckRow?: number;
  /** 有倒地影格動畫時的 key；非爆頭擊殺會優先播放它 */
  deathAnim?: string;
  /** 一律播倒地動畫、不用「轉 90 度」（動物的身體是橫的，轉了會很怪） */
  forceAnim?: boolean;
  /** 爆頭：頭整個炸開（碎片取自這張碎塊貼圖的 h0..h5），不是整顆飛出去 */
  explode?: { parts: string | null };
  /** 已經趴在地上（斷腳爬行）：不再倒下，原地癱平 */
  flat?: { neckX: number };
  /** 頭的世界座標（爆頭碎片從這裡噴出） */
  headX?: number;
  headY?: number;
}

const GRAVITY = 520;
const MAX_DEBRIS = 260;
const CORPSE_STAY = 7000;
const DEPTH_BURST = 57;
const MAX_CORPSES = 24;
/** 血的顏色：偏暗、低彩度（鮮紅色看起來像油漆） */
const BLOOD = [0x6a0c0c, 0x7a1010, 0x4e0909, 0x5c0b0b];
const MIST = 0x5a0c0c;

const registry = new WeakMap<Phaser.Scene, Fx>();

export class Fx {
  private debris: Debris[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private decals: Phaser.GameObjects.RenderTexture;
  private shadows = new Map<Phaser.GameObjects.Sprite, Phaser.GameObjects.Image>();
  private corpses: Phaser.GameObjects.Sprite[] = [];
  private freezeUntil = 0;
  private squashTweens = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();
  private textPool = new Map<string, Phaser.GameObjects.Text[]>();
  private puffPool: Phaser.GameObjects.Image[] = [];

  static attach(scene: Phaser.Scene): Fx {
    const fx = new Fx(scene);
    registry.set(scene, fx);
    return fx;
  }

  static of(scene: Phaser.Scene): Fx | undefined {
    return registry.get(scene);
  }

  private constructor(private scene: Phaser.Scene) {
    // 地上的血跡畫進一張 RenderTexture：數量再多也只是一張圖
    const cam = scene.cameras.main;
    const w = Math.max(GAME_WIDTH, cam.getBounds().width || 0);
    const h = Math.max(GAME_HEIGHT, cam.getBounds().height || 0);
    this.decals = scene.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(1);

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    // 打擊時最常跳的字
    this.prewarmText([
      ['爆頭', '#ffd24a'],
      ['處決', '#ff8a65'],
      ['衝撞', '#80d8ff'],
    ]);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
      registry.delete(scene);
      this.debris = [];
      this.pool = [];
      this.shadows.clear();
      this.corpses = [];
      this.textPool.clear();
      this.puffPool = [];
      scene.tweens.timeScale = 1;
    });
  }

  /** 卡肉（hit-stop）時為 0，遊戲邏輯的 dt 乘上它就會停頓 */
  get timeScale(): number {
    return this.scene.game.loop.time < this.freezeUntil ? 0 : 1;
  }

  /** 卡肉：整個畫面停住幾十毫秒，讓爆頭、重擊有「打到了」的重量感 */
  freeze(ms: number): void {
    this.freezeUntil = Math.max(this.freezeUntil, this.scene.game.loop.time + ms);
    this.scene.tweens.timeScale = 0;
  }

  // ───────────────────── 角色上的程式化動態 ─────────────────────

  /** 受擊擠壓：瞬間變扁變寬再彈回，配合閃白 */
  squash(sprite: Phaser.GameObjects.Sprite, baseScale = 1, amount = 1, baseScaleX = baseScale): void {
    this.squashTweens.get(sprite)?.stop();
    sprite.setScale(baseScaleX * (1 + 0.07 * amount), baseScale * (1 - 0.05 * amount));
    const tw = this.scene.tweens.add({
      targets: sprite,
      scaleX: baseScaleX,
      scaleY: baseScale,
      duration: 90,
      ease: 'Quad.easeOut',
    });
    this.squashTweens.set(sprite, tw);
  }

  /** 腳下影子，自動跟著角色走，角色消失就一起移除 */
  attachShadow(sprite: Phaser.GameObjects.Sprite, width = 24): void {
    const s = this.scene.add
      .image(sprite.x, sprite.y, FX.shadow)
      .setAlpha(0.35)
      .setScale(width / 24, 1)
      .setDepth(sprite.depth - 0.01);
    this.shadows.set(sprite, s);
  }

  /**
   * 程式化死亡：用角色當下的影格複製一具屍體，以腳底為軸往後倒、落地彈一下，
   * 倒地後變暗、留一灘血，過幾秒淡出。爆頭時把頭切下來飛出去。
   */
  fall(sprite: Phaser.GameObjects.Sprite, opt: FallOptions): void {
    const sc = this.scene;
    const corpse = sc.add
      .sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY)
      .setFlipX(sprite.flipX)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setDepth(2 + sprite.y / 1000);
    if (sprite.isTinted) corpse.setTint(sprite.tintTopLeft);
    const s = sprite.scaleY;

    if (opt.flat) {
      if (opt.explode) {
        // 裁切以「畫面上」的左右為準（Phaser 會把翻轉算進去）：朝左時頭在左邊，留右邊
        const fw = corpse.frame.width;
        corpse.setCrop(sprite.flipX ? fw - opt.flat.neckX : 0, 0, opt.flat.neckX, corpse.frame.height);
        this.headBurst(opt.headX ?? sprite.x, opt.headY ?? sprite.y - 14 * s, opt.dir, sprite.y, opt.explode.parts, s, sprite.isTinted ? sprite.tintTopLeft : undefined);
      }
      sc.tweens.add({
        targets: corpse,
        x: corpse.x + opt.dir * Phaser.Math.Between(2, 5),
        duration: 260,
        ease: 'Quad.easeOut',
        onComplete: () => {
          this.dust(corpse.x, sprite.y, 4);
          this.stain(corpse.x, sprite.y, 2);
          corpse.setTint(0x777777);
          sc.tweens.add({ targets: corpse, alpha: 0, delay: CORPSE_STAY, duration: 1200, onComplete: () => this.dropCorpse(corpse) });
        },
      });
      this.corpses.push(corpse);
      if (this.corpses.length > MAX_CORPSES) this.dropCorpse(this.corpses[0]);
      return;
    }

    if (opt.headshot && opt.explode && opt.neckRow) {
      // 頭整個炸開：屍體只留脖子以下，頭化成碎片和血霧
      corpse.setCrop(0, opt.neckRow, corpse.frame.width, corpse.frame.height - opt.neckRow);
      const headY = sprite.y - (sprite.frame.height * sprite.originY - opt.neckRow / 2) * s;
      const hp = opt.headX ?? sprite.x;
      this.headBurst(hp, headY, opt.dir, sprite.y, opt.explode.parts, s, sprite.isTinted ? sprite.tintTopLeft : undefined);
    } else if (opt.headshot && opt.headFrame && opt.neckRow) {
      corpse.setCrop(0, opt.neckRow, corpse.frame.width, corpse.frame.height - opt.neckRow);
      const headY = sprite.y - (sprite.frame.height * sprite.originY - opt.neckRow / 2) * s;
      const head = this.spawn(sprite.texture.key, sprite.x, headY, {
        frame: opt.headFrame,
        vx: opt.dir * Phaser.Math.Between(40, 90),
        vy: -Phaser.Math.Between(150, 210),
        spin: opt.dir * Phaser.Math.Between(400, 800),
        floorY: sprite.y,
        bounce: 0.35,
        life: 6,
        onLand: 'rest',
        scale: s,
        tint: sprite.isTinted ? sprite.tintTopLeft : undefined,
        flipX: sprite.flipX,
      });
      head?.img.setDepth(corpse.depth + 0.5);
      // 斷頸噴泉
      this.blood(sprite.x, headY + 4 * s, opt.dir, sprite.y, 22, 1.3);
    }

    const settle = (x: number): void => {
      this.dust(x, sprite.y, 6);
      this.stain(x - opt.dir * 4 * s, sprite.y, 2.2);
      corpse.setTint(0x777777);
      sc.tweens.add({ targets: corpse, alpha: 0, delay: CORPSE_STAY, duration: 1200, onComplete: () => this.dropCorpse(corpse) });
    };

    // 影格動畫的倒地方向是「往背後倒」；朝左走（flipX）的霧屍就是往右倒
    const animDir = sprite.flipX ? 1 : -1;
    if (opt.deathAnim && sc.anims.exists(opt.deathAnim) && (opt.forceAnim || (!opt.headshot && opt.dir === animDir))) {
      corpse.play(opt.deathAnim);
      // 被子彈推著往後滑一點
      sc.tweens.add({ targets: corpse, x: corpse.x + opt.dir * Phaser.Math.Between(3, 7), duration: 300, ease: 'Quad.easeOut' });
      corpse.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => settle(corpse.x + opt.dir * 16 * s));
      this.corpses.push(corpse);
      if (this.corpses.length > MAX_CORPSES) this.dropCorpse(this.corpses[0]);
      return;
    }

    // 以腳底為軸轉 90 度時，身體寬度有一半會轉到地面下，所以同時往上抬
    const lift = 11 * s;
    const angle = opt.dir * Phaser.Math.Between(82, 96);
    sc.tweens.add({
      targets: corpse,
      angle,
      x: corpse.x + opt.dir * Phaser.Math.Between(4, 10),
      y: corpse.y - lift,
      duration: Phaser.Math.Between(380, 480),
      ease: 'Bounce.easeOut',
      onComplete: () => settle(corpse.x + opt.dir * 18 * s),
    });
    this.corpses.push(corpse);
    if (this.corpses.length > MAX_CORPSES) this.dropCorpse(this.corpses[0]);
  }

  /**
   * 頭整個炸開：一團血霧、頭的碎片（碎塊貼圖的 h0..h5）往四周噴、一圈碎肉和大量血。
   * parts 沒有（不能切碎塊的貼圖）時只有血霧和碎肉。
   */
  headBurst(x: number, y: number, dir: number, floorY: number, parts: string | null, scale = 1, tint?: number): void {
    const sc = this.scene;
    // 血霧：兩團暗紅的霧往子彈方向散開、淡掉（不用亮紅色實心圓，看起來才不像卡通爆炸）
    this.mist(x, y, dir, 0.55, 1.2);
    this.mist(x + dir * 4, y - 2, dir, 0.4, 0.9);
    // 頭的碎片：大多往子彈方向飛，一些往回噴
    if (parts && sc.textures.exists(parts)) {
      for (let i = 0; i < 6; i++) {
        const name = `h${i}`;
        if (!sc.textures.get(parts).has(name)) continue;
        const back = Math.random() < 0.25 ? -1 : 1;
        const d = this.spawn(parts, x + Phaser.Math.Between(-3, 3), y + Phaser.Math.Between(-3, 3), {
          frame: name,
          vx: dir * back * Phaser.Math.Between(50, 170),
          vy: -Phaser.Math.Between(70, 220),
          spin: Phaser.Math.Between(-900, 900),
          floorY: floorY + Phaser.Math.Between(-3, 3),
          bounce: 0.25,
          life: 4,
          onLand: 'rest',
          scale,
          tint,
        });
        d?.img.setDepth(56);
      }
    }
    // 碎肉
    for (let i = 0; i < 7; i++) {
      this.spawn(FX.px2, x, y, {
        vx: dir * Phaser.Math.Between(-60, 180),
        vy: -Phaser.Math.Between(40, 200),
        floorY: floorY + Phaser.Math.Between(-3, 3),
        spin: 0,
        bounce: 0.2,
        life: 3,
        onLand: 'rest',
        tint: Phaser.Utils.Array.GetRandom([0x4e0909, 0x6a0c0c, 0x7a3c3c, 0x3a0606]),
      });
    }
    this.blood(x, y, dir, floorY, 26, 1.5);
    this.blood(x, y, -dir, floorY, 8, 0.7);
    this.stain(x + dir * 10, floorY, 1.6);
  }

  /** 斷肢：一截手或腳旋轉著飛出去、落地躺著，斷口噴血 */
  limb(parts: string, frame: string, x: number, y: number, dir: number, floorY: number, o: { scale?: number; tint?: number; flipX?: boolean } = {}): void {
    if (!this.scene.textures.exists(parts) || !this.scene.textures.get(parts).has(frame)) return;
    const d = this.spawn(parts, x, y, {
      frame,
      vx: dir * Phaser.Math.Between(50, 120),
      vy: -Phaser.Math.Between(90, 170),
      spin: dir * Phaser.Math.Between(400, 900),
      floorY: floorY + Phaser.Math.Between(-2, 4),
      bounce: 0.3,
      life: 6,
      onLand: 'rest',
      scale: o.scale,
      tint: o.tint,
      flipX: o.flipX,
    });
    d?.img.setDepth(56);
    this.blood(x, y, dir, floorY, 16, 1.1);
    this.blood(x, y, -dir, floorY, 5, 0.6);
  }

  private dropCorpse(c: Phaser.GameObjects.Sprite): void {
    this.corpses = this.corpses.filter((x) => x !== c);
    c.destroy();
  }

  // ───────────────────── 粒子與碎片 ─────────────────────

  /** 子彈命中：往子彈方向噴血（射出的那一側）＋一小團血霧，落地成血跡。打在肉上不會有火花 */
  bulletHit(x: number, y: number, dirX: number, floorY: number, headshot: boolean): void {
    this.blood(x, y, dirX, floorY, headshot ? 12 : 5, headshot ? 1.2 : 0.8);
    this.mist(x, y, dirX, headshot ? 0.45 : 0.28, headshot ? 0.9 : 0.6);
    if (headshot) this.popText(x, y - 8, '爆頭', '#ffd24a');
  }

  blood(x: number, y: number, dirX: number, floorY: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      // 大多是細小的血滴；少數較大的滴落得慢、飛不遠（重量感）
      const big = Math.random() < 0.18;
      const sp = big ? 0.6 : 1;
      this.spawn(big ? FX.px2 : FX.px, x, y, {
        vx: (dirX * Phaser.Math.Between(30, 130) * power + Phaser.Math.Between(-15, 15)) * sp,
        vy: -Phaser.Math.Between(10, 110) * power * sp,
        floorY: floorY + Phaser.Math.Between(-2, 3),
        life: 2,
        onLand: 'stain',
        tint: Phaser.Utils.Array.GetRandom(BLOOD),
      });
    }
  }

  /**
   * 掉落物：彈匣、退出的彈殼等，落地彈一下後留在地上一陣子（WeaponRig 用）。
   */
  drop(
    key: string,
    x: number,
    y: number,
    o: { vx: number; vy: number; floorY: number; spin?: number; life?: number; flipX?: boolean },
  ): void {
    this.spawn(key, x, y, { vx: o.vx, vy: o.vy, floorY: o.floorY, spin: o.spin ?? 0, bounce: 0.35, life: o.life ?? 4, onLand: 'rest', flipX: o.flipX });
  }

  /** 拋殼：從槍膛往後上方彈出，在地上彈兩下後停住；key 換成不同口徑的彈殼圖 */
  ejectShell(x: number, y: number, floorY: number, facing = 1, key: string = FX.shell): void {
    this.spawn(key, x, y, {
      vx: -facing * Phaser.Math.Between(30, 70),
      vy: -Phaser.Math.Between(90, 140),
      spin: Phaser.Math.Between(-900, 900),
      floorY,
      bounce: 0.45,
      life: 4,
      onLand: 'rest',
    });
  }

  /** 槍口煙：一小團抖色煙往上飄散 */
  /**
   * 子彈曳光：不畫整條雷射線，而是一小段高速飛行的彈頭（每秒約 3600 像素，畫面上停留 2–5 幀），
   * 加上一條很淡、很快消失的軌跡，保留「子彈往哪飛」的提示。
   */
  bulletTracer(x1: number, y1: number, x2: number, y2: number): void {
    const sc = this.scene;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const duration = Math.max(30, (dist / 3600) * 1000);

    // 淡軌跡：只留 1px、透明度很低，60ms 內淡掉
    const trail = sc.add.graphics().setDepth(49);
    trail.lineStyle(1, 0xffe0a0, 0.14).lineBetween(x1, y1, x2, y2);
    sc.tweens.add({ targets: trail, alpha: 0, duration: 90, onComplete: () => trail.destroy() });

    // 彈頭：圖的原點在頭端，隨機長度一點點，避免每發都一樣
    const head = sc.add
      .image(x1, y1, FX.streak)
      .setOrigin(1, 0.5)
      .setRotation(angle)
      .setScale(Phaser.Math.FloatBetween(1.1, 1.6), 1)
      .setDepth(50);
    sc.tweens.add({
      targets: head,
      x: x2,
      y: y2,
      duration,
      onComplete: () => head.destroy(),
    });
  }

  muzzleSmoke(x: number, y: number, angle: number): void {
    for (let i = 0; i < 2; i++) {
      const p = this.puff(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, 0xbfc4cc, 0.35, 0.4, 53);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Math.cos(angle) * Phaser.Math.Between(4, 10),
        y: p.y - Phaser.Math.Between(6, 14),
        scale: Phaser.Math.FloatBetween(0.9, 1.4),
        alpha: 0,
        duration: Phaser.Math.Between(300, 500),
        delay: i * 40,
        onComplete: () => this.unpuff(p),
      });
    }
  }

  /** 木屑：路障被打 */
  woodChips(x: number, y: number, floorY: number, count = 5): void {
    for (let i = 0; i < count; i++) {
      this.spawn(FX.chip, x, y + Phaser.Math.Between(-20, 10), {
        vx: Phaser.Math.Between(-60, 60),
        vy: -Phaser.Math.Between(40, 120),
        spin: Phaser.Math.Between(-700, 700),
        floorY: floorY + Phaser.Math.Between(0, 3),
        bounce: 0.3,
        life: 3,
        onLand: 'rest',
      });
    }
  }

  /** 倒地揚起的灰塵 */
  dust(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.puff(x + Phaser.Math.Between(-8, 8), y - 1, 0x8a8378, 0.22, 0.3, 3);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Phaser.Math.Between(-10, 10),
        y: p.y - Phaser.Math.Between(2, 6),
        scale: 0.8,
        alpha: 0,
        duration: 450,
        onComplete: () => this.unpuff(p),
      });
    }
  }

  /** 煙／霧小圖從池子裡拿（打擊時一次要好幾個，不每次新建，手機上少一點 GC 停頓） */
  private puff(x: number, y: number, tint: number, alpha: number, scale: number, depth: number): Phaser.GameObjects.Image {
    const p = this.puffPool.pop() ?? this.scene.add.image(0, 0, FX.smoke);
    return p.setPosition(x, y).setTint(tint).setAlpha(alpha).setScale(scale).setDepth(depth).setVisible(true).setActive(true);
  }

  private unpuff(p: Phaser.GameObjects.Image): void {
    p.setVisible(false).setActive(false);
    if (this.puffPool.length < 64) this.puffPool.push(p);
    else p.destroy();
  }

  /** 腳步揚塵：一兩小團灰往腳後方散開，很淡 */
  footDust(x: number, y: number, dirX: number): void {
    for (let i = 0; i < 2; i++) {
      const p = this.puff(x + Phaser.Math.Between(-2, 2), y - 1, 0x8a8378, 0.22, 0.18, 2 + y / 1000);
      this.scene.tweens.add({
        targets: p,
        x: p.x - dirX * Phaser.Math.Between(3, 7),
        y: p.y - Phaser.Math.Between(1, 4),
        scale: 0.45,
        alpha: 0,
        duration: Phaser.Math.Between(260, 380),
        onComplete: () => this.unpuff(p),
      });
    }
  }

  /** 槍口閃光照亮周圍：加色光暈一閃即逝，夜裡特別明顯 */
  muzzleLight(x: number, y: number, size = 1): void {
    const g = this.scene.add
      .image(x, y, FX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(52)
      .setScale(0.55 * size)
      .setAlpha(0.95);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 0.75 * size, duration: 70, onComplete: () => g.destroy() });
  }

  /** 地上留一塊血跡（畫進 RenderTexture，永久留著直到場景結束） */
  stain(x: number, y: number, scale = 1): void {
    this.decals.stamp(FX.splat, Phaser.Math.Between(0, SPLAT_FRAMES - 1), x, y, {
      tint: Phaser.Utils.Array.GetRandom([0x5a0c0c, 0x4a0a0a, 0x641010]),
      alpha: Phaser.Math.FloatBetween(0.6, 0.85),
      scaleX: scale * Phaser.Math.FloatBetween(0.6, 1),
      scaleY: Math.max(0.6, scale * 0.6),
    });
  }

  /** 頭飾／頭盔被打飛：一個小圖旋轉著飛出去、落地彈一下躺著 */
  fling(key: string, frame: string, x: number, y: number, dir: number, floorY: number, o: { scale?: number; tint?: number; flipX?: boolean; power?: number } = {}): void {
    const power = o.power ?? 1;
    const d = this.spawn(key, x, y, {
      frame,
      vx: dir * Phaser.Math.Between(40, 90) * power,
      vy: -Phaser.Math.Between(110, 170) * power,
      spin: dir * Phaser.Math.Between(300, 700),
      floorY,
      bounce: 0.4,
      life: 6,
      onLand: 'rest',
      scale: o.scale,
      tint: o.tint,
      flipX: o.flipX,
    });
    d?.img.setDepth(56);
  }

  /** 子彈打在護甲上：火花而不是血 */
  sparks(x: number, y: number, dirX: number, floorY: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      this.spawn(FX.px, x, y, {
        vx: -dirX * Phaser.Math.Between(30, 110) + Phaser.Math.Between(-30, 30),
        vy: -Phaser.Math.Between(30, 120),
        floorY,
        life: 0.25,
        onLand: 'vanish',
        tint: Phaser.Utils.Array.GetRandom([0xfff3a0, 0xffd060, 0xffffff]),
      });
    }
  }

  /** 腐液爆開：綠色噴濺＋擴散的圈，地上留一灘綠漬 */
  burst(x: number, y: number, floorY: number, radius: number): void {
    const ring = this.scene.add.circle(x, y, 4, 0x9aff4a, 0.5).setDepth(DEPTH_BURST).setStrokeStyle(2, 0xd8ff8a, 0.9);
    this.scene.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Phaser.Math.Between(40, 170);
      this.spawn(Math.random() < 0.3 ? FX.px2 : FX.px, x, y, {
        vx: Math.cos(a) * sp,
        vy: -Math.abs(Math.sin(a)) * sp - 30,
        floorY: floorY + Phaser.Math.Between(-6, 6),
        life: 1.2,
        onLand: 'vanish',
        tint: Phaser.Utils.Array.GetRandom([0x9aff4a, 0x6ad02a, 0xc8ff7a, 0x4a8a1a]),
      });
    }
    this.decals.stamp(FX.splat, Phaser.Math.Between(0, SPLAT_FRAMES - 1), x, floorY, {
      tint: 0x4a7a1a,
      alpha: 0.7,
      scaleX: 2.4,
      scaleY: 1.2,
    });
  }

  /**
   * 近戰命中（寫實、收斂：不畫星芒、衝擊環、白色斬線，也不在肉上冒火花）：
   * - slash／heavy-slash：沿著刀的方向噴出一道細細的血（刀類是「劃開」），重的多一點
   * - blunt：打在肉上的悶擊，一小團血霧＋少量血滴往打擊方向噴，腳下一點揚塵
   * 卡肉期間 tween 也停，所以頓住的那一拍看得到血剛噴出來的樣子。
   */
  meleeImpact(x: number, y: number, dirX: number, kind: 'slash' | 'heavy-slash' | 'blunt', floorY: number): void {
    if (kind === 'blunt') {
      this.mist(x, y, dirX, 0.35, 0.7);
      this.blood(x, y, dirX, floorY, 3, 0.7);
      this.dust(x + dirX * 6, floorY, 2);
      return;
    }
    const heavy = kind === 'heavy-slash';
    // 刀口噴血：窄窄一道往刀的去向斜上方甩出去，速度快、顆粒小
    const n = heavy ? 9 : 6;
    const tilt = Phaser.Math.FloatBetween(-0.5, 0.2);
    for (let i = 0; i < n; i++) {
      const sp = Phaser.Math.Between(90, heavy ? 200 : 160);
      const a = tilt + Phaser.Math.FloatBetween(-0.18, 0.18);
      this.spawn(FX.px, x + dirX * Phaser.Math.Between(-2, 2), y + Phaser.Math.Between(-3, 3), {
        vx: dirX * Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        floorY: floorY + Phaser.Math.Between(-2, 3),
        life: 2,
        onLand: 'stain',
        tint: Phaser.Utils.Array.GetRandom(BLOOD),
      });
    }
    if (heavy) this.mist(x, y, dirX, 0.3, 0.6);
  }

  /** 血霧：一小團暗紅的霧往 dirX 散開、很快淡掉 */
  mist(x: number, y: number, dirX: number, alpha = 0.4, size = 1): void {
    const p = this.puff(x, y, MIST, alpha, 0.3 * size, DEPTH_BURST);
    this.scene.tweens.add({
      targets: p,
      x: x + dirX * Phaser.Math.Between(5, 10) * size,
      y: y - Phaser.Math.Between(0, 3),
      scale: Phaser.Math.FloatBetween(0.8, 1) * size,
      alpha: 0,
      duration: Phaser.Math.Between(180, 260),
      ease: 'Quad.easeOut',
      onComplete: () => this.unpuff(p),
    });
  }

  /**
   * 跳字：往上飄、放大再縮回。
   * 文字物件用完放回池子重複使用：每次新建都要重畫一張文字貼圖再上傳 GPU（手機上 4 倍解析度很貴），
   * 「爆頭」「處決」這類字又剛好都在打擊瞬間跳出來。
   */
  popText(x: number, y: number, text: string, color: string): void {
    const id = `${text}|${color}`;
    const free = this.textPool.get(id);
    const t = free?.pop() ?? pixelText(this.scene, x, y, text, 8, color).setOrigin(0.5).setDepth(60).setStroke('#000000', 3);
    t.setPosition(x, y).setAlpha(1).setScale(0.6).setVisible(true).setActive(true);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 90, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: t,
      y: y - 16,
      alpha: 0,
      delay: 250,
      duration: 400,
      onComplete: () => {
        t.setVisible(false).setActive(false);
        let list = this.textPool.get(id);
        if (!list) this.textPool.set(id, (list = []));
        // 同一句話最多留 4 個，太少見的字不留
        if (list.length < 4 && this.textPool.size < 40) list.push(t);
        else t.destroy();
      },
    });
  }

  /** 先建好常跳的字，第一次跳出來時才不用當場畫 */
  prewarmText(list: [string, string][]): void {
    for (const [text, color] of list) {
      const id = `${text}|${color}`;
      if (this.textPool.get(id)?.length) continue;
      const t = pixelText(this.scene, -100, -100, text, 8, color).setOrigin(0.5).setDepth(60).setStroke('#000000', 3).setVisible(false).setActive(false);
      this.textPool.set(id, [t]);
    }
  }

  // ───────────────────── 內部 ─────────────────────

  private spawn(
    key: string,
    x: number,
    y: number,
    o: {
      vx: number;
      vy: number;
      floorY: number;
      life: number;
      onLand: Debris['onLand'];
      spin?: number;
      bounce?: number;
      tint?: number;
      frame?: string;
      scale?: number;
      flipX?: boolean;
    },
  ): Debris | undefined {
    if (this.debris.length >= MAX_DEBRIS) return undefined;
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, key);
    img
      .setTexture(key, o.frame)
      .setPosition(x, y)
      .setActive(true)
      .setVisible(true)
      .setAlpha(1)
      .setAngle(0)
      .setScale(o.scale ?? 1)
      .setFlipX(o.flipX ?? false)
      .setDepth(55);
    if (o.tint !== undefined) img.setTint(o.tint);
    else img.clearTint();
    const d: Debris = {
      img,
      vx: o.vx,
      vy: o.vy,
      spin: o.spin ?? 0,
      floorY: o.floorY,
      bounce: o.bounce ?? 0,
      life: o.life,
      onLand: o.onLand,
      landed: false,
    };
    this.debris.push(d);
    return d;
  }

  private release(d: Debris): void {
    d.img.setActive(false).setVisible(false);
    this.pool.push(d.img);
  }

  private update(_t: number, deltaMs: number): void {
    const now = this.scene.game.loop.time;
    if (now >= this.freezeUntil && this.scene.tweens.timeScale === 0) this.scene.tweens.timeScale = 1;
    const dt = Math.min(deltaMs / 1000, 0.05) * this.timeScale;

    for (const [sprite, sh] of this.shadows) {
      if (!sprite.active) {
        sh.destroy();
        this.shadows.delete(sprite);
        continue;
      }
      sh.setPosition(sprite.x, sprite.y).setDepth(sprite.depth - 0.01);
    }

    if (dt === 0) return;
    const keep: Debris[] = [];
    for (const d of this.debris) {
      d.life -= dt;
      if (!d.landed) {
        d.vy += GRAVITY * dt;
        d.img.x += d.vx * dt;
        d.img.y += d.vy * dt;
        d.img.angle += d.spin * dt;
        if (d.img.y >= d.floorY && d.vy > 0) {
          d.img.y = d.floorY;
          if (d.onLand === 'stain') {
            if (Math.random() < 0.5) this.stain(d.img.x, d.floorY, 0.35);
            d.life = 0;
          } else if (d.onLand === 'vanish') {
            d.life = 0;
          } else if (d.bounce > 0 && Math.abs(d.vy) > 40) {
            d.vy = -d.vy * d.bounce;
            d.vx *= 0.6;
            d.spin *= 0.5;
          } else {
            d.landed = true;
            d.img.setDepth(2 + d.floorY / 1000);
            // 停住時角度對齊到 0 或 180，看起來是「躺」在地上
            d.img.angle = Math.round(d.img.angle / 180) * 180;
          }
        }
      }
      if (d.life <= 0.4 && d.onLand === 'rest') d.img.setAlpha(Math.max(0, d.life / 0.4));
      if (d.life <= 0) this.release(d);
      else keep.push(d);
    }
    this.debris = keep;
  }
}
