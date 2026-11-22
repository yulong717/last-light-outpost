import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { registerUIRect } from '../input/InputManager';
import { uiButton, uiPanel } from '../explore/ui';
import { pixelText } from '../utils/text';

export interface StoryData {
  title: string;
  lines: string[];
  /** 小字：這章的目標 */
  objective?: string;
  onClose?: () => void;
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
    const h = 92 + data.lines.length * lineH + (data.objective ? 22 : 0);
    const y = Math.max(20, (GAME_HEIGHT - h) / 2);
    const objs: Phaser.GameObjects.GameObject[] = [uiPanel(this, x, y, w, h)];
    objs.push(pixelText(this, GAME_WIDTH / 2, y + 12, data.title, 12, '#f5d76e').setOrigin(0.5, 0));
    data.lines.forEach((l, i) => {
      objs.push(pixelText(this, x + 22, y + 40 + i * lineH, l, 8, '#e0e0e0').setWordWrapWidth(w - 44, true));
    });
    let by = y + 46 + data.lines.length * lineH;
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
