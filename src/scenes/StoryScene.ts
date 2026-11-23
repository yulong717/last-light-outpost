import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { registerUIRect } from '../input/InputManager';
import { uiButton, uiPanel } from '../explore/ui';
import { pixelText } from '../utils/text';
import { ensureIllustration, ILLUS_H, ILLUS_W, type IllustrationId } from '../art/IllustrationArt';
import { ensureHeroTexture, heroBuild } from '../art/HeroArt';
import type { HeroId } from '../data/heroes';

export interface StoryData {
  title: string;
  lines: string[];
  /** 小字：這章的目標 */
  objective?: string;
  onClose?: () => void;
  /** 上方的關卡插圖（src/art/IllustrationArt.ts） */
  art?: IllustrationId;
  /** 插圖裡站著的主角（序章用） */
  hero?: HeroId;
}

/**
 * 劇情卡：序章、章節開場。蓋在白天畫面上，點「繼續」關掉。
 * 打開時整個畫面算 UI，底下的建造點擊不會穿透。
 */
export class StoryScene extends Phaser.Scene {
  constructor() {
    super('Story');
  }

  create(data: StoryData): void {
    const unreg = registerUIRect({ x: 0, y: 0, w: GAME_WIDTH, h: GAME_HEIGHT });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unreg);
    // 擋住底下的點擊
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72).setOrigin(0).setInteractive();

    const w = 440;
    const x = (GAME_WIDTH - w) / 2;
    const lineH = 15;
    const textH = 92 + data.lines.length * lineH + (data.objective ? 22 : 0);
    // 插圖高度：放得下就整張，放不下就只露出下半（地面、地標、霧屍那一段）
    const artH = data.art ? Math.max(0, Math.min(ILLUS_H, GAME_HEIGHT - 16 - textH - 10)) : 0;
    const h = textH + (artH ? artH + 10 : 0);
    const y = Math.max(8, (GAME_HEIGHT - h) / 2);
    const objs: Phaser.GameObjects.GameObject[] = [uiPanel(this, x, y, w, h)];
    let ty = y;
    if (data.art && artH > 0) {
      const key = ensureIllustration(this, data.art);
      const ax = x + (w - ILLUS_W) / 2;
      const ay = y + 10;
      const img = this.add.image(ax, ay, key).setOrigin(0).setDepth(100).setCrop(0, ILLUS_H - artH, ILLUS_W, artH);
      img.y = ay - (ILLUS_H - artH);
      objs.push(img);
      objs.push(this.add.rectangle(ax, ay, ILLUS_W, artH).setOrigin(0).setStrokeStyle(1, 0xf5d76e, 0.35).setDepth(101));
      if (data.hero) {
        const hk = ensureHeroTexture(this, data.hero);
        if (hk) {
          const b = heroBuild(data.hero);
          objs.push(this.add.ellipse(ax + 60, ay + artH - 6, 34, 6, 0x000000, 0.5).setDepth(101));
          objs.push(this.add.image(ax + 60, ay + artH - 5, hk, 0).setOrigin(0.5, 1).setScale(b.w, b.h).setDepth(102));
        }
      }
      ty = y + artH + 10;
    }
    objs.push(pixelText(this, GAME_WIDTH / 2, ty + 12, data.title, 12, '#f5d76e').setOrigin(0.5, 0));
    data.lines.forEach((l, i) => {
      objs.push(pixelText(this, x + 22, ty + 40 + i * lineH, l, 8, '#e0e0e0').setWordWrapWidth(w - 44, true));
    });
    let by = ty + 46 + data.lines.length * lineH;
    if (data.objective) {
      objs.push(pixelText(this, x + 22, by, `目標：${data.objective}`, 8, '#9ad17a'));
      by += 22;
    }
    objs.push(...uiButton(this, GAME_WIDTH / 2 - 70, by, 140, 26, '繼續 ▶', () => this.close(data), { fill: 0x3a4a2a, size: 9 }));

    // 逐行淡入
    objs.forEach((o, i) => {
      const t = o as unknown as Phaser.GameObjects.Components.Alpha;
      t.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, duration: 260, delay: 60 + i * 70 });
    });
    this.input.keyboard?.once('keydown-SPACE', () => this.close(data));
  }

  private closed = false;

  private close(data: StoryData): void {
    if (this.closed) return;
    this.closed = true;
    AudioManager.ui('confirm');
    this.scene.stop();
    data.onClose?.();
  }

  init(): void {
    this.closed = false;
  }
}
