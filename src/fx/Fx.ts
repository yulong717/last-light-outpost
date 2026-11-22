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
}

const GRAVITY = 520;
const MAX_DEBRIS = 260;
const CORPSE_STAY = 7000;
const DEPTH_BURST = 57;
const MAX_CORPSES = 24;

const registry = new WeakMap<Phaser.Scene, Fx>();

export class Fx {
  private debris: Debris[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private decals: Phaser.GameObjects.RenderTexture;
  private shadows = new Map<Phaser.GameObjects.Sprite, Phaser.GameObjects.Image>();
  private corpses: Phaser.GameObjects.Sprite[] = [];
  private freezeUntil = 0;
  private squashTweens = new WeakMap<Phaser.GameObjects.Sprite, Phaser.Tweens.Tween>();

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
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
      registry.delete(scene);
      this.debris = [];
      this.pool = [];
      this.shadows.clear();
      this.corpses = [];
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
    sprite.setScale(baseScaleX * (1 + 0.18 * amount), baseScale * (1 - 0.14 * amount));
    const tw = this.scene.tweens.add({
      targets: sprite,
      scaleX: baseScaleX,
      scaleY: baseScale,
      duration: 110,
      ease: 'Back.easeOut',
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

    if (opt.headshot && opt.headFrame && opt.neckRow) {
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

  private dropCorpse(c: Phaser.GameObjects.Sprite): void {
    this.corpses = this.corpses.filter((x) => x !== c);
    c.destroy();
  }

  // ───────────────────── 粒子與碎片 ─────────────────────

  /** 子彈命中：往子彈方向噴血，落地成血跡 */
  bulletHit(x: number, y: number, dirX: number, floorY: number, headshot: boolean): void {
    this.blood(x, y, dirX, floorY, headshot ? 14 : 6, headshot ? 1.2 : 0.8);
    // 一兩顆亮色火花，表示打中了
    for (let i = 0; i < 2; i++) {
      this.spawn(FX.px, x, y, {
        vx: -dirX * Phaser.Math.Between(20, 60),
        vy: -Phaser.Math.Between(10, 60),
        floorY,
        life: 0.12,
        onLand: 'vanish',
        tint: 0xfff3a0,
      });
    }
    if (headshot) this.popText(x, y - 8, '爆頭', '#ffd24a');
  }

  blood(x: number, y: number, dirX: number, floorY: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const big = Math.random() < 0.25;
      this.spawn(big ? FX.px2 : FX.px, x, y, {
        vx: dirX * Phaser.Math.Between(30, 140) * power + Phaser.Math.Between(-20, 20),
        vy: -Phaser.Math.Between(20, 140) * power,
        floorY: floorY + Phaser.Math.Between(-2, 3),
        life: 2,
        onLand: 'stain',
        tint: Phaser.Utils.Array.GetRandom([0x8a1010, 0xa31818, 0x5e0b0b]),
      });
    }
  }

  /** 拋殼：從槍膛往後上方彈出，在地上彈兩下後停住 */
  ejectShell(x: number, y: number, floorY: number, facing = 1): void {
    this.spawn(FX.shell, x, y, {
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
      const p = this.scene.add
        .image(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, FX.smoke)
        .setDepth(53)
        .setAlpha(0.35)
        .setScale(0.4)
        .setTint(0xbfc4cc);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Math.cos(angle) * Phaser.Math.Between(4, 10),
        y: p.y - Phaser.Math.Between(6, 14),
        scale: Phaser.Math.FloatBetween(0.9, 1.4),
        alpha: 0,
        duration: Phaser.Math.Between(300, 500),
        delay: i * 40,
        onComplete: () => p.destroy(),
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
      const p = this.scene.add.image(x + Phaser.Math.Between(-8, 8), y - 1, FX.smoke).setScale(0.3).setAlpha(0.25).setTint(0x8a8378).setDepth(3);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Phaser.Math.Between(-10, 10),
        y: p.y - Phaser.Math.Between(2, 6),
        scale: 0.8,
        alpha: 0,
        duration: 450,
        onComplete: () => p.destroy(),
      });
    }
  }

  /** 腳步揚塵：一兩小團灰往腳後方散開，很淡 */
  footDust(x: number, y: number, dirX: number): void {
    for (let i = 0; i < 2; i++) {
      const p = this.scene.add
        .image(x + Phaser.Math.Between(-2, 2), y - 1, FX.smoke)
        .setScale(0.18)
        .setAlpha(0.22)
        .setTint(0x8a8378)
        .setDepth(2 + y / 1000);
      this.scene.tweens.add({
        targets: p,
        x: p.x - dirX * Phaser.Math.Between(3, 7),
        y: p.y - Phaser.Math.Between(1, 4),
        scale: 0.45,
        alpha: 0,
        duration: Phaser.Math.Between(260, 380),
        onComplete: () => p.destroy(),
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
      tint: Phaser.Utils.Array.GetRandom([0x6e0f0f, 0x561010, 0x7a1414]),
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

  /** 跳字：往上飄、放大再縮回 */
  popText(x: number, y: number, text: string, color: string): void {
    const t = pixelText(this.scene, x, y, text, 8, color).setOrigin(0.5).setDepth(60).setStroke('#000000', 3).setScale(0.6);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 90, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, y: y - 16, alpha: 0, delay: 250, duration: 400, onComplete: () => t.destroy() });
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
