import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { registerUIRect } from '../input/InputManager';
import { ComicSequencer } from '../comic/ComicSequencer';
import type { ComicScript } from '../comic/types';
import { CINEMATICS } from '../data/cinematics';

export interface ComicSceneData {
  /** 劇本物件，或 src/data/cinematics.ts 的 id */
  script: ComicScript | string;
  zone?: string;
  onDone?: () => void;
}

/** 在 from 場景上蓋一段漫畫演出 */
export function playComic(from: Phaser.Scene, data: ComicSceneData): void {
  from.scene.launch('Comic', data);
  from.scene.bringToTop('Comic');
}

/**
 * 劇情漫畫演出（序章開場、過場、角色介紹）：蓋在任何畫面上，播完呼叫 onDone 並關掉自己。
 * 演出本體在 src/comic/ComicSequencer.ts，QTE 等互動演出直接在自己的場景裡用 ComicSequencer。
 */
export class ComicScene extends Phaser.Scene {
  constructor() {
    super('Comic');
  }

  create(data: ComicSceneData): void {
    const unreg = registerUIRect({ x: 0, y: 0, w: GAME_WIDTH, h: GAME_HEIGHT });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unreg);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 1).setOrigin(0).setInteractive();
    const script = typeof data.script === 'string' ? CINEMATICS[data.script] : data.script;
    if (!script) {
      this.finish(data);
      return;
    }
    const seq = new ComicSequencer(this, script, { zone: data.zone });
    seq
      .run()
      .then(() => seq.fadeOut())
      .then(() => this.finish(data));
  }

  private finish(data: ComicSceneData): void {
    const cb = data.onDone;
    this.scene.stop();
    cb?.();
  }
}
