import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { FX } from './FxTextures';

export interface AtmosphereOptions {
  /** 地面高度（霧貼著地面飄） */
  groundY: number;
  /** 據點燈的位置；不給就不放燈 */
  lamp?: { x: number; y: number };
}

/**
 * 夜晚氣氛：飄落的灰燼、貼地流動的霧、會閃爍的據點燈、畫面暗角。
 * 全部是程式產生的貼圖 + 補間動畫，不需要任何美術檔。
 */
export function createAtmosphere(scene: Phaser.Scene, opt: AtmosphereOptions): void {
  const width = GAME_WIDTH;
  const height = GAME_HEIGHT;

  // 灰燼：慢慢落下、左右飄
  scene.add.particles(0, -4, FX.px, {
    x: { min: 0, max: width + 80 },
    lifespan: 9000,
    speedY: { min: 8, max: 18 },
    speedX: { min: -14, max: -4 },
    alpha: { start: 0.5, end: 0 },
    tint: [0x9aa3ad, 0xc9c2b8, 0xff9a5a],
    frequency: 160,
    quantity: 1,
    advance: 9000,
  }).setDepth(40).setScrollFactor(0);

  // 貼地霧：幾團大霧從右往左慢慢流過，前後兩層有視差
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 5; i++) {
      const y = opt.groundY - 6 + layer * 14 + Phaser.Math.Between(-6, 6);
      const fog = scene.add
        .image(Phaser.Math.Between(0, width), y, FX.fog)
        .setTint(0x9aa3ad)
        .setAlpha(layer === 0 ? 0.04 : 0.05)
        .setScale(Phaser.Math.FloatBetween(1.5, 2.6), Phaser.Math.FloatBetween(1, 1.6))
        .setDepth(layer === 0 ? 4 : 30)
        // 霧在畫面座標中流動，鏡頭捲動時不會只蓋住戰場的前半段
        .setScrollFactor(0);
      const speed = layer === 0 ? 6 : 12;
      const drift = (): void => {
        const dist = fog.x + fog.displayWidth / 2;
        scene.tweens.add({
          targets: fog,
          x: -fog.displayWidth / 2,
          duration: (dist / speed) * 1000,
          onComplete: () => {
            fog.x = width + fog.displayWidth / 2;
            drift();
          },
        });
      };
      drift();
      // 霧本身也慢慢「呼吸」
      scene.tweens.add({ targets: fog, alpha: fog.alpha * 1.8, duration: Phaser.Math.Between(2500, 4500), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  // 據點燈：加色混合的光暈 + 隨機閃爍
  if (opt.lamp) {
    const { x, y } = opt.lamp;
    scene.add.rectangle(x, y, 4, 3, 0xffd27a).setDepth(9);
    const glow = scene.add.image(x, y + 6, FX.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(9).setAlpha(0.8);
    const flicker = (): void => {
      const off = Math.random() < 0.08;
      glow.setAlpha(off ? 0.25 : Phaser.Math.FloatBetween(0.7, 0.9));
      glow.setScale(off ? 0.9 : Phaser.Math.FloatBetween(0.97, 1.03));
      scene.time.delayedCall(off ? 60 : Phaser.Math.Between(80, 260), flicker);
    };
    flicker();
  }

  // 暗角固定在鏡頭上
  scene.add.image(0, 0, FX.vignette).setOrigin(0).setScrollFactor(0).setDepth(90).setDisplaySize(width, height);
}

export interface NightLight {
  x: number;
  y: number;
  /** 光圈大小倍率（1 = 一盞路燈） */
  scale?: number;
  color?: number;
}

/**
 * 入夜調色：整個戰場慢慢壓暗、偏冷藍（乘法混合），再把燈、主角身邊的光加回來。
 * 疊在角色之上、特效（槍口火光、曳光、血）之下，所以開槍的火光仍然很亮。
 * follow：會跟著移動的光源（主角的手電筒餘光）。
 */
export function nightGrade(scene: Phaser.Scene, lights: NightLight[], follow?: Phaser.GameObjects.Components.Transform): void {
  const shade = scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x6670a0)
    .setOrigin(0)
    .setScrollFactor(0)
    .setDepth(55)
    .setBlendMode(Phaser.BlendModes.MULTIPLY)
    .setAlpha(0);
  scene.tweens.add({ targets: shade, alpha: 1, duration: 1800, ease: 'Sine.easeIn' });
  const pools: Phaser.GameObjects.Image[] = [];
  for (const l of lights) {
    const g = scene.add
      .image(l.x, l.y, FX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(l.color ?? 0xffc070)
      .setScale(2.4 * (l.scale ?? 1), 1.6 * (l.scale ?? 1))
      .setDepth(56)
      .setAlpha(0);
    pools.push(g);
  }
  scene.tweens.add({ targets: pools, alpha: 0.32, duration: 1800 });
  if (follow) {
    const halo = scene.add.image(follow.x, follow.y, FX.glow).setBlendMode(Phaser.BlendModes.ADD).setTint(0x9ab0ff).setScale(1.8, 1.3).setDepth(56).setAlpha(0);
    scene.tweens.add({ targets: halo, alpha: 0.26, duration: 1800 });
    const sync = (): void => {
      if (!halo.active) return;
      halo.setPosition(follow.x, follow.y - 18);
    };
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, sync);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, sync));
  }
}
