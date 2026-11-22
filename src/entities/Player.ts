import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import { FEEL } from '../feel/FeelConfig';
import { Fx } from '../fx/Fx';
import { GameEvents } from '../systems/GameEvents';

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
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  footX: number;
  footY: number;
  hp: number;
  readonly maxHp: number;
  /** 1 面向右、-1 面向左 */
  facing = 1;
  /** 目前速度（像素 / 秒） */
  vx = 0;
  vy = 0;
  /** 被打後的無敵時間（秒），避免一群霧屍同一幀把人秒掉 */
  private hurtCooldown = 0;
  private walkPhase = 0;
  private stepIndex = 0;
  private recoil = 0;
  /** 外力（受擊、霰彈後座力）造成的速度，會很快衰減 */
  private pushX = 0;
  private pushY = 0;
  private squashAmt = 0;
  private breath = 0;
  private lean = 0;

  constructor(private scene: Phaser.Scene, x: number, y: number, maxHp: number) {
    this.footX = x;
    this.footY = clampLaneY(y);
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.sprite = scene.add.sprite(x, this.footY, 'player', 0);
    // 影格腳底在 64 格中的第 63 列
    this.sprite.setOrigin(0.5, scene.anims.exists('player_shoot') ? 63 / 64 : 1);
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

    // 倒退走較慢
    const back = moveX !== 0 && Math.sign(moveX) !== this.facing ? m.backpedal : 1;
    const tx = moveX * m.speedX * back;
    const ty = moveY * m.speedY;
    // 加速／煞車：指數逼近目標速度，放開時煞得比起步快
    const kx = Math.abs(tx) > Math.abs(this.vx) * 0.5 && tx !== 0 ? m.accel : m.decel;
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
    Fx.of(this.scene)?.footDust(this.footX - this.vx * 0.04, this.footY, Math.sign(this.vx) || this.facing);
    GameEvents.of(this.scene).emit('player:step', {
      x: this.footX,
      y: this.footY,
      foot: this.stepIndex as 0 | 1,
      speed,
    });
  }

  /** 沒有開火影格時的後座力：往後頓 2px */
  kick(): void {
    this.recoil = 2;
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
    this.hp = Math.max(0, this.hp - amount);
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
    const bob = this.walkPhase > 0 ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
    s.x = this.footX - this.recoil * this.facing;
    s.y = this.footY - bob;
    s.setFlipX(this.facing < 0);
    s.setDepth(depthForY(this.footY));
    s.angle = this.lean;
    // 待機呼吸（走路時停掉）＋ 受擊／轉身擠壓
    const breathe = this.walkPhase > 0 ? 0 : Math.sin(this.breath * (Math.PI / 0.9)) * 0.015 + 0.015;
    s.setScale(1 + 0.16 * this.squashAmt, 1 + breathe - 0.12 * this.squashAmt);
    // 無敵時間內閃爍（每 60ms 換一次）
    s.setAlpha(this.hurtCooldown > 0 && Math.floor(this.hurtCooldown * 1000 / 60) % 2 === 0 ? 0.35 : 1);
  }
}
