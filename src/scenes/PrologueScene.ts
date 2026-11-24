import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { illustrationFor } from '../art/IllustrationArt';
import { getZone } from '../data/explore';
import { PROLOGUE_OUTRO, PROLOGUE_REWARD, PROLOGUE_STAGES, PROLOGUE_TITLE } from '../data/prologue';
import { Expedition } from '../explore/Expedition';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import type { ExploreFieldData, FieldResult } from './ExploreFieldScene';
import type { ExploreMapData } from './ExploreMapScene';
import type { StoryData } from './StoryScene';

export interface PrologueData {
  /** 從第幾層開始（測試用；預設 0 = 頂樓，會先播開場） */
  from?: number;
}

/**
 * 序章＝第一夜：阿凱在學校頂樓醒來，一層一層往下逃出學校。
 * 每一層是一個 ExploreFieldScene 小關卡（單軸、只能近戰），這個場景負責：
 * 開場卡 → 每層的樓層轉場 → 打完叫醒、下一層 → 倒下就重來這一層 → 逃出校門後的收尾與第二章開場 → 強制出發探索。
 * 內容在 src/data/prologue.ts，說明見 docs/PROLOGUE.md。
 */
export class PrologueScene extends Phaser.Scene {
  private index = 0;
  private retries = 0;

  constructor() {
    super('Prologue');
  }

  create(data: PrologueData = {}): void {
    this.index = Phaser.Math.Clamp(data.from ?? 0, 0, PROLOGUE_STAGES.length - 1);
    this.retries = 0;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0);
    AudioManager.setMood('menu');
    // 序章借用探索的小關卡：一趟沒有同行隊員的「市立高中」
    Expedition.current = new Expedition(getZone('school')!, []);
    if (this.index === 0) {
      const story: StoryData = {
        ...PROLOGUE_TITLE,
        art: illustrationFor('school'),
        hero: 'student',
        onClose: () => this.floorIntro(),
      };
      this.scene.launch('Story', story);
      this.scene.bringToTop('Story');
    } else this.floorIntro();
  }

  /** 樓層轉場：黑底大字＋一句旁白，點一下或等兩秒半就開打 */
  private floorIntro(): void {
    const st = PROLOGUE_STAGES[this.index];
    const objs: Phaser.GameObjects.GameObject[] = [];
    const floor = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 26, st.floor, 26, '#f5d76e').setOrigin(0.5).setStroke('#000000', 4);
    const line = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 16, st.narration, 9, '#d8d8d8').setOrigin(0.5).setWordWrapWidth(GAME_WIDTH - 120, true);
    const step = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 40, `${this.index + 1} / ${PROLOGUE_STAGES.length}`, 8, '#6a7078').setOrigin(0.5);
    objs.push(floor, line, step);
    for (const o of objs) (o as Phaser.GameObjects.Text).setAlpha(0);
    this.tweens.add({ targets: objs, alpha: 1, duration: 400 });
    AudioManager.ui('confirm');
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      this.tweens.add({ targets: objs, alpha: 0, duration: 250, onComplete: () => {
        objs.forEach((o) => o.destroy());
        this.playStage();
      } });
    };
    this.time.delayedCall(2600, go);
    this.time.delayedCall(400, () => this.input.once('pointerdown', go));
    this.input.keyboard?.once('keydown-SPACE', go);
  }

  private playStage(): void {
    const st = PROLOGUE_STAGES[this.index];
    const data: ExploreFieldData = {
      spec: st.spec,
      stage: st,
      onDone: (r) => this.stageDone(r),
    };
    this.scene.sleep();
    this.scene.launch('ExploreField', data);
  }

  private stageDone(r: FieldResult): void {
    this.scene.wake();
    this.cameras.main.fadeIn(250, 0, 0, 0);
    if (r.result === 'down' || r.result === 'failed') {
      // 倒下就重來這一層（序章不會 Game Over）
      this.retries++;
      const t = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT / 2, '你倒下了……再試一次', 12, '#ff8a80').setOrigin(0.5).setStroke('#000000', 4);
      this.time.delayedCall(1400, () => {
        t.destroy();
        this.playStage();
      });
      return;
    }
    this.index++;
    if (this.index < PROLOGUE_STAGES.length) this.floorIntro();
    else this.escaped();
  }

  /**
   * 逃出校門：序章（第一夜）結束。
   * 完成阿凱的第一章、開放區域、天亮變第 2 天，然後直接把人推出門探索（不回據點、不能取消）。
   */
  private escaped(): void {
    Expedition.current = null;
    const gs = GameState;
    gs.addLoot(PROLOGUE_REWARD);
    gs.completeChapter();
    gs.data.story.introSeen = 1;
    gs.data.tutorialDone = true;
    gs.data.day = 2;
    gs.startNewDay();
    gs.save();
    const outro: StoryData = {
      ...PROLOGUE_OUTRO,
      art: illustrationFor('school'),
      hero: 'student',
      onClose: () => this.nextChapter(),
    };
    this.scene.launch('Story', outro);
    this.scene.bringToTop('Story');
  }

  /** 接著播第二章的開場，播完出發 */
  private nextChapter(): void {
    const ch = GameState.chapter;
    const leave = () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const d: ExploreMapData = { forced: true };
        this.scene.start('ExploreMap', d);
      });
    };
    if (!ch) return leave();
    const story: StoryData = {
      title: ch.title,
      lines: ch.intro,
      art: illustrationFor(ch.zone),
      objective: `${ch.objective}（${getZone(ch.zone)?.name ?? ''}・城市地圖上的★）`,
      onClose: () => {
        GameState.markIntroSeen();
        GameState.save();
        leave();
      },
    };
    this.time.delayedCall(150, () => {
      this.scene.launch('Story', story);
      this.scene.bringToTop('Story');
    });
  }
}
