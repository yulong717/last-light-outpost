import Phaser from 'phaser';
import { FEEL } from './FeelConfig';
import { GameEvents } from '../systems/GameEvents';

const EDGE_TEX = 'fx_edge_glow';

/**
 * 畫面層的受擊回饋（固定在鏡頭上，不跟世界捲動）：
 * - 被打：紅色邊框瞬間亮起再淡出
 * - 低血量：紅邊跟著心跳一跳一跳，血越少跳越快
 */
export class ScreenFeedback {
  private edge: Phaser.GameObjects.Image;
  private flash = 0;
  private low = false;
  private beatTimer = 0;
  private beat = 0;

  constructor(private scene: Phaser.Scene, private depth = 92) {
    createEdgeTexture(scene);
    const { width, height } = scene.scale;
    this.edge = scene.add
      .image(0, 0, EDGE_TEX)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDisplaySize(width, height)
      .setTint(0xc4161c)
      .setDepth(this.depth)
      .setAlpha(0);
  }

  /** 被打的瞬間呼叫；strength 0..1 */
  hurt(strength = 1): void {
    this.flash = Math.max(this.flash, 0.55 + 0.45 * strength);
  }

  /** 每幀呼叫，傳入目前血量；回傳是否剛好跨過低血量門檻 */
  update(dt: number, hp: number, maxHp: number): void {
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    const low = hp > 0 && ratio <= FEEL.hurt.lowHpRatio;
    const bus = GameEvents.of(this.scene);
    if (low !== this.low) {
      this.low = low;
      this.beatTimer = 0;
      bus.emit('player:low-hp', { entering: low, hp, maxHp });
    }

    this.flash = Math.max(0, this.flash - dt * 2.4);
    if (low) {
      // 血越少心跳越快：每分鐘 70 ～ 130 下
      const bpm = 70 + 60 * (1 - ratio / FEEL.hurt.lowHpRatio);
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) {
        this.beatTimer = 60 / bpm;
        this.beat = 1;
        bus.emit('player:heartbeat', { hp, maxHp });
      }
    }
    this.beat = Math.max(0, this.beat - dt * 3);
    const base = low ? 0.25 + 0.35 * this.beat : 0;
    this.edge.setAlpha(Math.min(1, Math.max(base, this.flash)));
  }
}

/** 白色邊框光暈（抖色、少階），用 tint 染成紅色 */
function createEdgeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(EDGE_TEX)) return;
  const w = 160;
  const h = 90;
  const t = scene.textures.createCanvas(EDGE_TEX, w, h)!;
  const ctx = t.getContext();
  const img = ctx.createImageData(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - cx) * 0.9, (y - cy) * 1.4) / maxR;
      const v = Math.max(0, d - 0.5) * 9;
      const lo = Math.floor(v);
      const level = (x + y) % 2 === 0 && v - lo > 0.5 ? lo + 1 : lo;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(4, level) * 50;
    }
  }
  ctx.putImageData(img, 0, 0);
  t.refresh();
}
