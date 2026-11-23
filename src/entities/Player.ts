import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import { FEEL } from '../feel/FeelConfig';
import { Fx } from '../fx/Fx';
import { GameEvents } from '../systems/GameEvents';
import { GameState } from '../state/GameState';
import { heroBodyTexture, heroBuild } from '../art/HeroArt';

export interface PlayerBounds {
  minX: number;
  maxX: number;
}

/**
 * 主角：在 2.5D 地面帶上自由移動（左右＋前後）。
 * footX / footY 是腳底位置，所有判定都用它；sprite 的 x/y/角度/縮放會因為呼吸、
 * 走路、後座力、受擊等表演而偏移，不拿來做判定。
 *
 * 手感（數值在 src/feel/FeelConfig.ts）：
 * - 有加速度與煞車，不是瞬間到全速
 * - 倒退走（移動方向和瞄準方向相反）較慢
 * - 走路身體前傾、腳步揚塵；轉身時擠壓一下
 * - 被打：閃白轉紅、往後擊退、無敵時間內閃爍
 */
/** 衝刺的慣性：煞車多慢（越小滑越遠）、停止衝刺後慣性持續幾秒 */
const SKID = { decel: 2.6, time: 0.5 };

type FramePick = (phase: string, k: number, contact: boolean) => number;
/**
 * 揮擊影格的排法。第 1 招的 6 格：0 棒在肩後、1 舉起、2 打到正前方（命中格）、3 揮過頭、4 棒子豎起、5 回到備戰。
 * back／chop 是第 2、3 招還沒有專屬影格時，借這 6 格排出來的暫代版本。
 */
const MELEE_FRAMES: Record<'own' | 'back' | 'chop', FramePick> = {
  own: (ph, k, hit) => (ph === 'windup' ? (k < 0.5 ? 0 : 1) : ph === 'active' ? (hit || k < 0.5 ? 2 : 3) : k < 0.5 ? 4 : 5),
  // 回掃：從揮過頭的位置直接反手拉回來
  back: (ph, k, hit) => (ph === 'windup' ? 3 : ph === 'active' ? (hit || k < 0.6 ? 2 : 1) : k < 0.5 ? 0 : 5),
  // 下劈：棒子高舉蓄力，再一口氣劈到底
  chop: (ph, k, hit) => (ph === 'windup' ? (k < 0.6 ? 4 : 1) : ph === 'active' ? (hit || k < 0.5 ? 2 : 3) : k < 0.6 ? 3 : 5),
};

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  footX: number;
  footY: number;
  hp: number;
  /** 血量下限：開局教學設 1，怎麼打都不會倒下 */
  minHp = 0;
  readonly maxHp: number;
  /** 1 面向右、-1 面向左 */
  facing = 1;
  /** 目前速度（像素 / 秒） */
  vx = 0;
  vy = 0;
  /** 被打後的無敵時間（秒），避免一群霧屍同一幀把人秒掉 */
  private hurtCooldown = 0;
  private walkPhase = 0;
  private aiAnim = false;
  /** AI 影格的球棒揮擊正在播放（WeaponRig 這時不畫手與球棒） */
  aiMeleeFrame = -1;

  /** 依近戰階段挑揮擊影格；回傳 true 表示由角色影格自己畫手與球棒 */
  /** 揮擊用哪張影格表：連段第 2、3 招有自己的影格就用（akai_ai_melee2／3），沒有就借第 1 招的格子 */
  aiMeleeKey = 'akai_ai_melee';

  setMeleePose(mp: { phase: string; k: number; contact?: boolean; step?: number } | null): boolean {
    if (!this.aiAnim || !this.scene.textures.exists('akai_ai_melee') || !mp) {
      this.aiMeleeFrame = -1;
      return false;
    }
    const k = Math.min(0.999, Math.max(0, mp.k));
    if (mp.phase === 'ready') {
      this.aiMeleeFrame = 99; // 持棒待機／走路
      return true;
    }
    const step = mp.step ?? 1;
    const own = step > 1 ? `akai_ai_melee${step}` : 'akai_ai_melee';
    if (this.scene.textures.exists(own)) {
      // 每招自己的影格表：起手 0–1、出手 2（命中格）–3、收招 4–5
      this.aiMeleeKey = own;
      this.aiMeleeFrame = MELEE_FRAMES.own(mp.phase, k, !!mp.contact);
    } else {
      // 還沒有專屬影格：借第 1 招的格子排出不同的順序
      this.aiMeleeKey = 'akai_ai_melee';
      this.aiMeleeFrame = (step === 2 ? MELEE_FRAMES.back : step === 3 ? MELEE_FRAMES.chop : MELEE_FRAMES.own)(mp.phase, k, !!mp.contact);
    }
    return true;
  }
  private stepIndex = 0;
  /** 往同一個方向連走了幾步（阿凱走滿幾步進入衝刺）、往哪個方向 */
  runSteps = 0;
  private runDir = 0;
  /** 衝刺中（HeroSystem 設定）：有慣性，放開或反向會滑一段 */
  dashing = false;
  private skidT = 0;
  private wasDashing = false;
  private recoil = 0;
  /** 外力（受擊、霰彈後座力）造成的速度，會很快衰減 */
  private pushX = 0;
  private pushY = 0;
  private squashAmt = 0;
  private breath = 0;
  private lean = 0;
  /** 武器負重的移動速度倍率（機槍較慢） */
  speedMul = 1;
  /** 近戰揮擊的身體角度（度），由 MeleeSystem 設定 */
  swingLean = 0;
  /** 主角體型縮放（阿凱瘦小、馬克壯） */
  private readonly build: { w: number; h: number };

  constructor(private scene: Phaser.Scene, x: number, y: number, maxHp: number) {
    this.footX = x;
    this.footY = clampLaneY(y);
    this.maxHp = maxHp;
    this.hp = maxHp;
    // 有擦掉手臂的身體圖就用它，手與武器由 WeaponRig 畫
    // 每位主角有自己的像素形象（src/art/HeroArt.ts）；畫不出來時退回舊的共用圖
    const hero = GameState.data.hero ?? 'soldier';
    // 阿凱（student）改用 H3 生成的影格（64×64 腳底在第 61 列，64×72 在第 69 列）
    this.aiAnim = hero === 'student' && scene.anims.exists('akai_ai_walk');
    const heroBody = this.aiAnim ? 'akai_ai_idle' : heroBodyTexture(scene, hero);
    this.build = heroBody && !this.aiAnim ? heroBuild(hero) : { w: 1, h: 1 };
    const body = heroBody !== null || scene.textures.exists('player_body');
    this.sprite = scene.add.sprite(x, this.footY, heroBody ?? (body ? 'player_body' : 'player'), 0);
    // 影格腳底在 64 格中的第 63 列（AI 影格在第 61 列）
    this.sprite.setOrigin(0.5, this.aiAnim ? 62 / 64 : body || scene.anims.exists('player_shoot') ? 63 / 64 : 1);
    if (this.aiAnim) this.sprite.play('akai_ai_idle');
    this.sync();
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  get invulnerable(): boolean {
    return this.hurtCooldown > 0;
  }

  /** 0..1：目前移動速度佔最高速度的比例（散射懲罰、腳步用） */
  get moveFactor(): number {
    return Math.min(1, Math.hypot(this.vx / FEEL.move.speedX, this.vy / FEEL.move.speedY));
  }

  /** 槍口的大約高度與位置（相對腳底），用來算射線起點 */
  get gunX(): number {
    return this.footX + 10 * this.facing;
  }

  get gunY(): number {
    return this.footY - 40;
  }

  /** 走路上下顛簸（像素），WeaponRig 跟著身體動 */
  get bob(): number {
    // AI 影格：依當格頭頂高度（idle 頭頂在第 6 列）讓手臂跟著身體起伏
    if (this.aiAnim) return 0;
    return this.walkPhase > 0 ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
  }

  update(dt: number, moveX: number, moveY: number, aimX: number, bounds: PlayerBounds): void {
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);
    this.recoil = Math.max(0, this.recoil - dt * 40);
    this.squashAmt = Math.max(0, this.squashAmt - dt * 9);
    if (!this.alive) return;
    const m = FEEL.move;

    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    // 永遠面向瞄準方向（邊退邊打是這類遊戲的核心手感）；轉身時擠壓一下
    const facing = aimX >= this.footX ? 1 : -1;
    if (facing !== this.facing) this.squashAmt = Math.max(this.squashAmt, 0.6);
    this.facing = facing;

    // 連走步數：放開左右、或改按反方向就重算
    const inDir = Math.abs(moveX) > 0.3 ? Math.sign(moveX) : 0;
    if (inDir === 0 || (this.runDir !== 0 && inDir !== this.runDir)) {
      this.runSteps = 0;
      this.runDir = inDir;
    } else if (this.runDir === 0) this.runDir = inDir;
    // 衝刺結束（放開、反向、出手）後還會滑一小段
    if (this.wasDashing && !this.dashing) this.skidT = SKID.time;
    this.wasDashing = this.dashing;
    this.skidT = Math.max(0, this.skidT - dt);

    // 倒退走較慢
    const back = moveX !== 0 && Math.sign(moveX) !== this.facing ? m.backpedal : 1;
    const tx = moveX * m.speedX * back * this.speedMul;
    const ty = moveY * m.speedY * this.speedMul;
    // 加速／煞車：指數逼近目標速度，放開時煞得比起步快
    let kx: number = Math.abs(tx) > Math.abs(this.vx) * 0.5 && tx !== 0 ? m.accel : m.decel;
    // 慣性：衝刺中或剛停下時，煞車和反向都很慢（腳底會揚塵）
    const braking = tx === 0 || Math.sign(tx) !== Math.sign(this.vx);
    if ((this.dashing || this.skidT > 0) && braking && Math.abs(this.vx) > 10) {
      kx = SKID.decel;
      if (Math.random() < dt * 25) Fx.of(this.scene)?.footDust(this.footX, this.footY, Math.sign(this.vx));
    }
    const ky = Math.abs(ty) > Math.abs(this.vy) * 0.5 && ty !== 0 ? m.accel : m.decel;
    this.vx += (tx - this.vx) * (1 - Math.exp(-kx * dt));
    this.vy += (ty - this.vy) * (1 - Math.exp(-ky * dt));
    if (Math.abs(this.vx) < 0.5 && tx === 0) this.vx = 0;
    if (Math.abs(this.vy) < 0.5 && ty === 0) this.vy = 0;

    const pushDecay = Math.exp(-10 * dt);
    this.pushX *= pushDecay;
    this.pushY *= pushDecay;

    this.footX = Phaser.Math.Clamp(this.footX + (this.vx + this.pushX) * dt, bounds.minX, bounds.maxX);
    this.footY = clampLaneY(this.footY + (this.vy + this.pushY) * dt);

    // 走路：步伐相位，每半圈落一隻腳
    const speed = this.moveFactor;
    if (speed > 0.15) {
      const prev = Math.floor(this.walkPhase / Math.PI);
      this.walkPhase += dt * m.stepsPerSecond * Math.PI * (0.6 + 0.4 * speed);
      if (Math.floor(this.walkPhase / Math.PI) !== prev) this.step(speed);
    } else {
      this.walkPhase = 0;
    }
    // 往移動方向前傾（倒退時往後仰一點）
    const targetLean = (this.vx / m.speedX) * m.lean;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 12);
    this.breath += dt;
    this.sync();
  }

  private step(speed: number): void {
    this.stepIndex ^= 1;
    if (this.runDir !== 0 && Math.sign(this.vx) === this.runDir) this.runSteps++;
    Fx.of(this.scene)?.footDust(this.footX - this.vx * 0.04, this.footY, Math.sign(this.vx) || this.facing);
    GameEvents.of(this.scene).emit('player:step', {
      x: this.footX,
      y: this.footY,
      foot: this.stepIndex as 0 | 1,
      speed,
    });
  }

  /** 近戰打中的反作用力：身體壓扁一下 */
  impact(amount: number): void {
    this.squashAmt = Math.max(this.squashAmt, amount);
  }

  /** 沒有開火影格時的後座力：往後頓 2px */
  kick(): void {
    this.recoil = 2;
  }

  /** 清掉外力（被抓住時不會被打飛） */
  clearPush(): void {
    this.pushX = 0;
    this.pushY = 0;
  }

  /** 給一段無敵時間（閃身步、大難不死） */
  grantIframes(seconds: number): void {
    this.hurtCooldown = Math.max(this.hurtCooldown, seconds);
  }

  /** 補血（醫護夥伴用），回傳實際補了多少 */
  heal(amount: number): number {
    if (!this.alive) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /** 外力推一下（霰彈後座力、被打退），單位像素 / 秒 */
  push(vx: number, vy = 0): void {
    this.pushX += vx;
    this.pushY += vy;
  }

  /**
   * 回傳 true 代表這次真的扣血了。
   * fromX / fromY 是攻擊者位置，用來決定往哪邊擊退。
   */
  takeDamage(amount: number, fromX = this.footX - this.facing, fromY = this.footY): boolean {
    if (!this.alive || this.hurtCooldown > 0) return false;
    const h = FEEL.hurt;
    this.hp = Math.max(this.minHp, this.hp - amount);
    this.hurtCooldown = h.iframes;

    // 往攻擊者反方向擊退（y 方向小一點）
    const dx = this.footX - fromX;
    const dy = this.footY - fromY;
    const d = Math.hypot(dx, dy * 2) || 1;
    this.push((dx / d) * h.knockback, ((dy * 2) / d) * h.knockback * 0.35);
    this.squashAmt = 1;

    // 閃白 → 閃紅 → 恢復，讀得出「被打了」
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(45, () => this.sprite.active && this.sprite.setTintFill(0xff3b3b));
    this.scene.time.delayedCall(120, () => this.sprite.active && this.sprite.clearTint());

    GameEvents.of(this.scene).emit('player:hurt', { amount, hp: this.hp, maxHp: this.maxHp, fromX, fromY });
    if (!this.alive) {
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.setAlpha(1);
      this.scene.tweens.add({ targets: this.sprite, angle: -90 * this.facing, alpha: 0.4, duration: 400 });
      GameEvents.of(this.scene).emit('player:death', { x: this.footX, y: this.footY });
    }
    return true;
  }

  private sync(): void {
    const s = this.sprite;
    if (!this.alive) return;
    if (this.aiAnim && this.aiMeleeFrame >= 0 && this.aiMeleeFrame < 99) {
      s.anims.stop();
      s.setTexture(this.aiMeleeKey, this.aiMeleeFrame);
    } else if (this.aiAnim) {
      const bat = this.aiMeleeFrame === 99;
      const want = (this.walkPhase > 0 ? 'akai_ai_walk' : 'akai_ai_idle') + (bat ? '_bat' : '');
      if (s.anims.currentAnim?.key !== want || !s.anims.isPlaying) s.play(want);
    }
    // 64×64 影格腳底在第 61 列，持棒／揮擊的 64×72 影格腳底在第 69 列
    if (this.aiAnim) s.setOrigin(0.5, s.height > 64 ? 70 / 72 : 62 / 64);
    // AI 影格本身有上下起伏，不再疊加程式顛簸
    const bob = this.walkPhase > 0 && !this.aiAnim ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
    s.x = this.footX - this.recoil * this.facing;
    s.y = this.footY - bob;
    s.setFlipX(this.facing < 0);
    s.setDepth(depthForY(this.footY));
    s.angle = this.lean + this.swingLean * this.facing;
    // 待機呼吸（走路時停掉）＋ 受擊／轉身擠壓
    const breathe = this.walkPhase > 0 ? 0 : Math.sin(this.breath * (Math.PI / 0.9)) * 0.015 + 0.015;
    s.setScale(this.build.w * (1 + 0.16 * this.squashAmt), this.build.h * (1 + breathe - 0.12 * this.squashAmt));
    // 無敵時間內閃爍（每 60ms 換一次）
    s.setAlpha(this.hurtCooldown > 0 && Math.floor(this.hurtCooldown * 1000 / 60) % 2 === 0 ? 0.35 : 1);
  }
}
