import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';

export interface PlayerBounds {
  minX: number;
  maxX: number;
}

/**
 * 主角：在 2.5D 地面帶上自由移動（左右＋前後）。
 * footX / footY 是腳底位置，所有判定都用它；sprite 的 y 會因為呼吸、
 * 後座力等表演而微微偏移，不拿來做判定。
 */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  footX: number;
  footY: number;
  hp: number;
  readonly maxHp: number;
  /** 1 面向右、-1 面向左 */
  facing = 1;
  /** 被打後的無敵時間（秒），避免一群霧屍同一幀把人秒掉 */
  private hurtCooldown = 0;
  private walkPhase = 0;
  private recoil = 0;
  /** 移動速度（像素 / 秒）；前後移動比左右慢一點，做出縱深感 */
  private readonly speedX = 78;
  private readonly speedY = 54;

  constructor(private scene: Phaser.Scene, x: number, y: number, maxHp: number) {
    this.footX = x;
    this.footY = clampLaneY(y);
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.sprite = scene.add.sprite(x, this.footY, 'player', 0);
    // 影格腳底在 64 格中的第 63 列
    this.sprite.setOrigin(0.5, scene.anims.exists('player_shoot') ? 63 / 64 : 1);
    // 待機呼吸（程式化動態，之後換成影格動畫）
    scene.tweens.add({ targets: this.sprite, scaleY: 1.03, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.sync();
  }

  get alive(): boolean {
    return this.hp > 0;
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
    if (!this.alive) return;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    this.footX = Phaser.Math.Clamp(this.footX + moveX * this.speedX * dt, bounds.minX, bounds.maxX);
    this.footY = clampLaneY(this.footY + moveY * this.speedY * dt);

    // 永遠面向瞄準方向（邊退邊打是這類遊戲的核心手感）
    this.facing = aimX >= this.footX ? 1 : -1;

    if (len > 0.1) this.walkPhase += dt * 14;
    else this.walkPhase = 0;
    this.recoil = Math.max(0, this.recoil - dt * 40);
    this.sync();
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

  /** 回傳 true 代表這次真的扣血了 */
  takeDamage(amount: number): boolean {
    if (!this.alive || this.hurtCooldown > 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtCooldown = 0.35;
    this.sprite.setTintFill(0xff5252);
    this.scene.time.delayedCall(70, () => this.sprite.clearTint());
    if (!this.alive) {
      this.scene.tweens.killTweensOf(this.sprite);
      this.scene.tweens.add({ targets: this.sprite, angle: -90 * this.facing, alpha: 0.4, duration: 400 });
    }
    return true;
  }

  private sync(): void {
    const bob = this.walkPhase > 0 ? Math.abs(Math.sin(this.walkPhase)) * 1.5 : 0;
    this.sprite.x = this.footX - this.recoil * this.facing;
    this.sprite.y = this.footY - bob;
    this.sprite.setFlipX(this.facing < 0);
    this.sprite.setDepth(depthForY(this.footY));
  }
}
