import Phaser from 'phaser';
import { depthForY } from '../config';
import { FX } from '../fx/FxTextures';

/** 低於這個比例：光轉紅、閃爍，角色染血變淡 */
const LOW = 0.35;

export interface HeroStatusInput {
  footX: number;
  footY: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 體力 0..1；不給就不畫體力弧 */
  stamina?: number;
  /** 噪音 0..1（探索街道）；不給就不畫聲波 */
  noise?: number;
}

/**
 * 主角狀態畫在主角身上，不放面板（docs/UI_THEME.md「戰鬥畫面不放面板」）：
 * - 生命＝腳下的光：血越少光圈越小越暗，低於 35% 轉紅並閃爍，角色本身染血、變淡
 * - 體力＝腳下的藍色弧線，滿了就消失
 * - 噪音（探索）＝從主角身上擴散出去的聲波圈，越吵圈越大越紅
 * 都是世界座標的物件，跟著主角走，不會擋到畫面角落的任何東西。
 */
export class HeroStatus {
  private glow: Phaser.GameObjects.Image;
  private ground: Phaser.GameObjects.Graphics;
  private waves: Phaser.GameObjects.Graphics;
  private arc: Phaser.GameObjects.Graphics;
  private staminaA = 0;
  private wavePhase = 0;
  private flicker = 1;
  private flickerT = 0;
  private tinted = false;
  private shown = 1;

  constructor(private scene: Phaser.Scene, private sprite: Phaser.GameObjects.Sprite) {
    this.glow = scene.add.image(0, 0, FX.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(56).setAlpha(0);
    this.ground = scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.waves = scene.add.graphics();
    this.arc = scene.add.graphics();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** 生命比例平滑跟上，掉血時光圈是縮下去而不是跳一下 */
  update(dt: number, s: HeroStatusInput): void {
    const target = s.alive && s.maxHp > 0 ? Phaser.Math.Clamp(s.hp / s.maxHp, 0, 1) : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * 6);
    const r = this.shown;
    const low = s.alive && target < LOW;

    // 低血量：光一閃一閃（像快沒電的燈）
    this.flickerT -= dt;
    if (this.flickerT <= 0) {
      this.flickerT = low ? Phaser.Math.FloatBetween(0.05, 0.18) : 0.2;
      this.flicker = low ? (Math.random() < 0.25 ? 0.35 : Phaser.Math.FloatBetween(0.75, 1)) : 1;
    }

    const color = low ? 0xff3a2a : r < 0.6 ? 0xffa050 : 0xffd27a;
    const size = 0.45 + 0.75 * r;
    this.glow
      .setPosition(s.footX, s.footY - 4)
      .setTint(color)
      .setScale(1.6 * size, 0.7 * size)
      .setAlpha(s.alive ? (0.22 + 0.3 * r) * this.flicker : 0);

    const g = this.ground.clear().setDepth(depthForY(s.footY) - 0.3);
    const ag = this.arc.clear().setDepth(depthForY(s.footY) - 0.25);
    if (s.alive) {
      // 地上的光圈：加色混合畫在角色腳下（深度比角色低，只照亮地面），外圈一條像素細線
      const rx = Math.round(12 + 16 * r);
      const ry = Math.round(4 + 3 * r);
      const f = this.flicker;
      g.fillStyle(color, (0.16 + 0.14 * r) * f).fillEllipse(s.footX, s.footY + 1, rx * 2, ry * 2);
      g.fillStyle(color, (0.14 + 0.12 * r) * f).fillEllipse(s.footX, s.footY + 1, rx * 1.3, ry * 1.3);
      g.lineStyle(1, color, (0.3 + 0.3 * r) * f).strokeEllipse(s.footX, s.footY + 1, rx * 2, ry * 2);

      // 體力弧：腳下前半圈，滿了淡出
      if (s.stamina !== undefined) {
        const want = s.stamina < 0.995 ? 1 : 0;
        this.staminaA += (want - this.staminaA) * Math.min(1, dt * (want ? 10 : 2.5));
        if (this.staminaA > 0.02) {
          const st = Phaser.Math.Clamp(s.stamina, 0, 1);
          const empty = st < 0.25;
          const ax = 14;
          const ay = 5;
          const cy = s.footY + 3;
          const seg = 20;
          const n = Math.round(seg * st);
          for (let i = 0; i < seg; i++) {
            const a = Math.PI * (i / (seg - 1));
            const px = Math.round(s.footX - Math.cos(a) * ax);
            const py = Math.round(cy + Math.sin(a) * ay);
            const on = i < n;
            const c = on ? (empty && Math.floor(this.scene.time.now / 160) % 2 === 0 ? 0xd8402f : 0x5ab4ff) : 0x1c2a3a;
            ag.fillStyle(0x000000, 0.55 * this.staminaA).fillRect(px - 1, py, 3, 2);
            ag.fillStyle(c, (on ? 0.95 : 0.6) * this.staminaA).fillRect(px - 1, py, 2, 1);
          }
        }
      }
    }

    // 噪音聲波：一圈圈往外擴，越吵越大、越紅
    const w = this.waves.clear().setDepth(depthForY(s.footY) - 0.2);
    if (s.alive && s.noise !== undefined && s.noise > 0.05) {
      const n = Phaser.Math.Clamp(s.noise, 0, 1);
      this.wavePhase = (this.wavePhase + dt * (0.6 + n)) % 1;
      const maxR = 18 + 46 * n;
      const c = n > 0.66 ? 0xff5a3a : n > 0.33 ? 0xffb050 : 0xd8d0b8;
      for (let k = 0; k < 3; k++) {
        const t = (this.wavePhase + k / 3) % 1;
        const rr = 10 + (maxR - 10) * t;
        w.lineStyle(1, c, (1 - t) * (0.25 + 0.5 * n));
        w.strokeEllipse(s.footX, s.footY - 24, rr * 2, rr * 1.4);
      }
    }

    // 角色本身：低血量染血、變淡、跟著心跳脈動；被打的閃白／閃紅期間不搶
    const spr = this.sprite;
    if (!spr.active) return;
    if (low) {
      if (!spr.tintFill) {
        const beat = 0.5 + 0.5 * Math.sin(this.scene.time.now / 140);
        const k = 0.35 + 0.35 * beat;
        const gb = Math.round(255 * (1 - k * 0.7));
        spr.setTint(Phaser.Display.Color.GetColor(255, gb, gb));
        // Player.update 每幀會把 alpha 設回 1（無敵閃爍時是 0.35），只在不閃的時候調淡
        if (spr.alpha >= 1) spr.setAlpha(0.82);
        this.tinted = true;
      }
    } else if (this.tinted) {
      this.tinted = false;
      if (!spr.tintFill) spr.clearTint();
    }
  }

  destroy(): void {
    this.glow.destroy();
    this.ground.destroy();
    this.waves.destroy();
    this.arc.destroy();
  }
}
