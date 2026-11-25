import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { QteGrade, QteSpec } from '../data/explore';
import { COMICS, GRADE_LABEL, type ComicDef } from '../data/comics';
import { ComicSequencer } from '../comic/ComicSequencer';
import type { Beat, ComicScript, Rect } from '../comic/types';
import { uiPanel } from '../explore/ui';
import { pixelText } from '../utils/text';
import { rumble } from '../feel/Haptics';

export interface QteData {
  spec: QteSpec;
  /** 寬容度：1 為標準，越大越簡單（隊伍膽識加成） */
  ease: number;
  /** 招牌事件：用漫畫分鏡演出（src/data/comics.ts），zone 決定分鏡配色 */
  comic?: { id: string; zone: string };
  onDone: (grade: QteGrade) => void;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const ARROW: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

/** 一般模式：畫面中間的面板 */
const BOX = { x: 120, y: 110, w: GAME_WIDTH - 240, h: 150 };
/** 漫畫模式的版面：上排兩格交代狀況、左下動作格（QTE 在裡面）、右下結果格 */
const COMIC_RECT: Record<'s1' | 's2' | 'act' | 'result', Rect> = {
  s1: { x: 18, y: 14, w: 300, h: 158 },
  s2: { x: 332, y: 22, w: 290, h: 150 },
  act: { x: 22, y: 188, w: 364, h: 160 },
  result: { x: 400, y: 184, w: 222, h: 164 },
};

/**
 * 快速反應事件（疊在探索畫面上）：
 * - timing：指針來回掃，進到綠區時按下（空白鍵、點擊）
 * - sequence：照順序按方向鍵（觸控有四個方向按鈕）
 * - mash：限時內連打（空白鍵、點擊）
 *
 * 結果分三級：大成功（時機條沒失誤、方向鍵／連打剩很多時間）、成功、失敗。
 *
 * 漫畫模式（data.comic）：用共用的分格演出引擎（src/comic/ComicSequencer.ts）——
 * 第 1、2 格交代狀況 → 動作格揭開，QTE 就在這格裡 → 結果格依評等換圖砸進來，點一下繼續。
 */
export class QteScene extends Phaser.Scene {
  private data0!: QteData;
  private done = false;
  /** 漫畫模式的開場分鏡還沒播完：先不收輸入 */
  private ready = false;
  private timeLeft = 0;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private totalTime = 1;
  private tick: (dt: number) => void = () => {};
  /** QTE 面板的位置（漫畫模式是第 3 格） */
  private PX = BOX.x;
  private PY = BOX.y;
  private PW = BOX.w;
  private PH = BOX.h;
  private comic: ComicDef | null = null;
  /** 時機條失誤次數（大成功判定） */
  private misses = 0;
  /** 漫畫模式：QTE 結束時交還給分格演出 */
  private resolveQte: ((grade: string) => void) | null = null;
  private grade: QteGrade = 'fail';

  constructor() {
    super('Qte');
  }

  init(data: QteData): void {
    this.data0 = data;
    this.done = false;
    this.misses = 0;
    this.tick = () => {};
    this.totalTime = 1;
    this.timeLeft = 0;
    this.comic = data.comic ? COMICS[data.comic.id] ?? null : null;
    this.ready = !this.comic;
    this.resolveQte = null;
    this.grade = 'fail';
    if (this.comic) {
      const r = COMIC_RECT.act;
      this.PX = r.x;
      this.PY = r.y;
      this.PW = r.w;
      this.PH = r.h;
    } else {
      this.PX = BOX.x;
      this.PY = BOX.y;
      this.PW = BOX.w;
      this.PH = BOX.h;
    }
  }

  create(): void {
    const { spec } = this.data0;
    const { PX, PY, PW, PH } = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.removeAllListeners());
    if (this.comic) {
      this.comicIntro(this.comic);
    } else {
      this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0);
      uiPanel(this, PX, PY, PW, PH, 0xff8a6a);
      pixelText(this, GAME_WIDTH / 2, PY + 10, spec.prompt, 10, '#ffd24a').setOrigin(0.5, 0);
    }
    this.add.rectangle(PX + 10, PY + PH - 12, PW - 20, 4, 0x000000).setOrigin(0).setDepth(100);
    this.timerBar = this.add.rectangle(PX + 11, PY + PH - 11, PW - 22, 2, 0xff8a6a).setOrigin(0).setDepth(101);
    if (spec.kind === 'timing') this.setupTiming();
    else if (spec.kind === 'sequence') this.setupSequence();
    else this.setupMash();
    // 漫畫模式：QTE 的元件先藏起來，動作格滑進來之後才出現
    if (this.comic) this.setWidgetsAlpha(0);
  }

  /** QTE 元件（深度 100 以上）一起顯示／隱藏 */
  private setWidgetsAlpha(a: number): void {
    for (const o of this.children.list) {
      const go = o as Phaser.GameObjects.GameObject & { depth: number; setAlpha?: (a: number) => unknown };
      if (go.depth >= 100) go.setAlpha?.(a);
    }
  }

  // ── 漫畫分鏡（src/comic/ComicSequencer.ts） ──

  /**
   * 招牌事件的分格演出：第 1、2 格交代狀況 → 動作格用 wipe 揭開，QTE 在這格裡進行
   * → 結果格依評等換圖砸進來。點一下快轉，結果格點一下繼續。
   */
  private comicIntro(cm: ComicDef): void {
    const zone = this.data0.comic!.zone;
    const art = (slot: string) => `qte/${cm.id}/${slot}`;
    const res = (grade: QteGrade): Beat[] => {
      const r = cm.result[grade];
      const g = GRADE_LABEL[grade];
      const big = grade !== 'ok';
      return [
        {
          type: 'panel',
          id: 'result',
          art: art(grade),
          rect: COMIC_RECT.result,
          tilt: grade === 'fail' ? -2.5 : 1.5,
          enter: big ? 'slam' : 'slide-up',
          fx: grade === 'fail' ? ['red', 'shake'] : grade === 'great' ? ['speed'] : [],
          cam: { from: { zoom: 1.2 }, to: { zoom: 1 }, dur: 900 },
          texts: r.caption ? [{ text: r.caption, x: 8, y: 8, w: COMIC_RECT.result.w - 30 }] : [],
          sfx: [
            ...(r.sfx ? [{ text: r.sfx, x: COMIC_RECT.result.w - 50, y: COMIC_RECT.result.h - 26, size: 16 }] : []),
            { text: g.text, x: COMIC_RECT.result.w / 2, y: COMIC_RECT.result.h / 2 + 8, size: 22, color: g.color, angle: -10, delay: 260 },
          ],
          hold: 'tap',
        },
      ];
    };
    const script: ComicScript = {
      id: `qte_${cm.id}`,
      endTap: false,
      beats: [
        { type: 'panel', id: 's1', art: art('s1'), rect: COMIC_RECT.s1, tilt: -1.2, enter: 'slide-left', texts: [{ text: cm.setup[0].caption, x: 8, y: 8 }], sfx: cm.setup[0].sfx ? [{ text: cm.setup[0].sfx, x: COMIC_RECT.s1.w - 50, y: COMIC_RECT.s1.h - 24 }] : [], hold: 800 },
        { type: 'panel', id: 's2', art: art('s2'), rect: COMIC_RECT.s2, tilt: 1, enter: 'slide-right', cam: { from: { zoom: 1 }, to: { zoom: 1.15 }, dur: 2000 }, texts: [{ text: cm.setup[1].caption, x: 8, y: 8 }], sfx: cm.setup[1].sfx ? [{ text: cm.setup[1].sfx, x: COMIC_RECT.s2.w - 50, y: COMIC_RECT.s2.h - 24 }] : [], hold: 800 },
        // 動作格：第 2 格放大裁切、壓暗，QTE 疊在上面
        { type: 'panel', id: 'act', art: art('s2'), rect: COMIC_RECT.act, enter: 'wipe-right', shade: 0.6, fx: ['speed'], cam: { from: { zoom: 1.7, x: 0.55, y: 0.45 } }, texts: [{ text: cm.action, x: 6, y: 6, w: COMIC_RECT.act.w - 30 }], hold: 1 },
        { type: 'interact', id: 'qte', panel: 'act' },
        { type: 'branch', cases: { great: res('great'), ok: res('ok'), fail: res('fail') } },
      ],
    };
    const seq = new ComicSequencer(this, script, {
      zone,
      bgAlpha: 0.92,
      interact: () =>
        new Promise<string>((resolve) => {
          this.resolveQte = resolve;
          this.ready = true;
          this.setWidgetsAlpha(1);
        }),
    });
    seq.run().then(() => this.close(this.grade));
  }

  update(_t: number, deltaMs: number): void {
    if (this.done || !this.ready) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    this.tick(dt);
    if (this.totalTime > 0 && this.timeLeft > 0) {
      this.timeLeft -= dt;
      this.timerBar.width = (this.PW - 22) * Math.max(0, this.timeLeft / this.totalTime);
      if (this.timeLeft <= 0) this.finish(false);
    }
  }

  /** 空白鍵、Enter、點擊都算「按下」 */
  private onPress(fn: () => void): void {
    this.input.keyboard?.on('keydown-SPACE', fn);
    this.input.keyboard?.on('keydown-ENTER', fn);
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) fn();
    });
  }

  /** 開場分鏡播完才算數 */
  private get live(): boolean {
    return this.ready && !this.done;
  }

  // ── 時機條 ──
  private setupTiming(): void {
    const { spec, ease } = this.data0;
    const { PX, PY, PW } = this;
    const bx = PX + 30;
    const bw = PW - 60;
    const by = PY + 64;
    this.add.rectangle(bx, by, bw, 16, 0x1c2029).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.3).setDepth(100);
    const zone = this.add.rectangle(bx, by + 1, 10, 14, 0x4caf50, 0.85).setOrigin(0).setDepth(101);
    const needle = this.add.rectangle(bx, by - 4, 3, 24, 0xffffff).setOrigin(0.5, 0).setDepth(102);
    const status = pixelText(this, (PX + PW / 2), by + 26, '', 9).setOrigin(0.5, 0);
    const hint = pixelText(this, (PX + PW / 2), by + 44, '空白鍵或點擊', 7, '#90a4ae').setOrigin(0.5, 0);
    hint.setAlpha(0.8);
    let hits = 0;
    let misses = 0;
    let t = 0;
    let lock = 0;
    this.timerBar.setVisible(false);
    const period = spec.time * ease;
    const place = () => {
      const w = bw * Phaser.Math.Clamp((0.2 - hits * 0.025) * ease, 0.08, 0.35);
      zone.width = w;
      zone.x = bx + Phaser.Math.FloatBetween(0.15, 0.85) * (bw - w);
    };
    place();
    const label = () => status.setText(`${'●'.repeat(hits)}${'○'.repeat(spec.count - hits)}　還能失誤 ${1 - misses} 次`);
    label();
    this.tick = (dt) => {
      if (lock > 0) {
        lock -= dt;
        return;
      }
      t += dt;
      // 來回掃：0→1→0
      const ph = (t / period) % 2;
      needle.x = bx + (ph < 1 ? ph : 2 - ph) * bw;
    };
    this.onPress(() => {
      if (!this.live || lock > 0) return;
      const inZone = needle.x >= zone.x - 1 && needle.x <= zone.x + zone.width + 1;
      if (inZone) {
        hits++;
        AudioManager.ui('confirm');
        this.flash(zone, 0x4caf50);
        if (hits >= spec.count) return this.finish(true);
        place();
      } else {
        misses++;
        this.misses = misses;
        AudioManager.play('dry_fire');
        rumble(60, 0.5);
        this.cameras.main.shake(120, 0.006);
        if (misses > 1) return this.finish(false);
      }
      lock = 0.25;
      label();
    });
  }

  // ── 方向鍵序列 ──
  private setupSequence(): void {
    const { spec, ease } = this.data0;
    const { PX, PY, PW } = this;
    const seq: Dir[] = Array.from({ length: spec.count }, () => Phaser.Utils.Array.GetRandom(DIRS));
    this.totalTime = this.timeLeft = spec.time * ease;
    const gap = 30;
    const x0 = (PX + PW / 2) - ((seq.length - 1) * gap) / 2;
    const cells = seq.map((d, i) => {
      const bg = this.add.rectangle(x0 + i * gap, PY + 60, 24, 24, 0x2a2f3a).setStrokeStyle(1, 0xffffff, 0.5).setDepth(100);
      const t = pixelText(this, x0 + i * gap, PY + 60, ARROW[d], 12).setOrigin(0.5);
      return { bg, t };
    });
    let at = 0;
    const press = (d: Dir) => {
      if (!this.live) return;
      if (d !== seq[at]) {
        AudioManager.play('dry_fire');
        cells[at].bg.setFillStyle(0xa83232);
        this.cameras.main.shake(150, 0.008);
        rumble(80, 0.6);
        return this.finish(false);
      }
      cells[at].bg.setFillStyle(0x3a7a2a);
      AudioManager.ui('tap');
      at++;
      if (at >= seq.length) this.finish(true);
    };
    const kb = this.input.keyboard;
    const bind: [string, Dir][] = [
      ['UP', 'up'], ['W', 'up'], ['DOWN', 'down'], ['S', 'down'], ['LEFT', 'left'], ['A', 'left'], ['RIGHT', 'right'], ['D', 'right'],
    ];
    for (const [k, d] of bind) kb?.on(`keydown-${k}`, () => press(d));
    // 觸控方向鍵
    const by = PY + 96;
    DIRS.forEach((d, i) => {
      const x = (PX + PW / 2) + (i - 1.5) * 44;
      const b = this.add.rectangle(x, by + 10, 36, 26, 0x1c2029).setStrokeStyle(1, 0xffffff, 0.4).setDepth(100);
      pixelText(this, x, by + 10, ARROW[d], 11, '#c8c8c8').setOrigin(0.5);
      b.setInteractive({ useHandCursor: true }).on('pointerdown', () => press(d));
    });
  }

  // ── 連打 ──
  private setupMash(): void {
    const { spec, ease } = this.data0;
    const { PX, PY, PW } = this;
    this.totalTime = this.timeLeft = spec.time * ease;
    const need = Math.max(6, Math.round(spec.count / Math.sqrt(ease)));
    const bx = PX + 40;
    const bw = PW - 80;
    const by = PY + 60;
    this.add.rectangle(bx, by, bw, 14, 0x1c2029).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.3).setDepth(100);
    const fill = this.add.rectangle(bx + 1, by + 1, 0, 12, 0xffa726).setOrigin(0).setDepth(101);
    const big = pixelText(this, (PX + PW / 2), by + 34, '連打！', 14, '#ffffff').setOrigin(0.5);
    pixelText(this, (PX + PW / 2), by + 52, '空白鍵或點擊', 7, '#90a4ae').setOrigin(0.5, 0);
    let v = 0;
    this.tick = (dt) => {
      // 不按就慢慢掉回去
      v = Math.max(0, v - dt * need * 0.12);
      fill.width = (bw - 2) * Math.min(1, v / need);
    };
    this.onPress(() => {
      if (!this.live) return;
      v += 1;
      AudioManager.ui('tap');
      big.setScale(1.25);
      this.tweens.add({ targets: big, scale: 1, duration: 80 });
      if (v >= need) this.finish(true);
    });
  }

  private flash(o: Phaser.GameObjects.Rectangle, color: number): void {
    const f = this.add.rectangle(o.x, o.y, o.width, o.height, color, 1).setOrigin(0).setDepth(103);
    this.tweens.add({ targets: f, alpha: 0, scaleY: 2, duration: 200, onComplete: () => f.destroy() });
  }

  /** 評等：時機條沒失誤、方向鍵／連打剩一半左右的時間 = 大成功 */
  private gradeOf(ok: boolean): QteGrade {
    if (!ok) return 'fail';
    const kind = this.data0.spec.kind;
    if (kind === 'timing') return this.misses === 0 ? 'great' : 'ok';
    const left = this.timeLeft / Math.max(0.01, this.totalTime);
    return left > (kind === 'mash' ? 0.4 : 0.45) ? 'great' : 'ok';
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    const grade = this.gradeOf(ok);
    AudioManager.play(grade === 'fail' ? 'player_hurt' : grade === 'great' ? 'stinger_win' : 'ui_confirm');
    if (grade === 'fail') rumble(160, 0.8);
    if (this.comic) {
      // 動作格上的元件淡掉，結果格滑進來
      for (const o of this.children.list) {
        const go = o as Phaser.GameObjects.GameObject & { depth: number };
        if (go.depth >= 100) this.tweens.add({ targets: go, alpha: 0, duration: 200 });
      }
      this.grade = grade;
      this.time.delayedCall(220, () => this.resolveQte?.(grade));
      return;
    }
    const g = GRADE_LABEL[grade];
    const t = pixelText(this, GAME_WIDTH / 2, this.PY + this.PH / 2, g.text, 18, g.color).setOrigin(0.5).setStroke('#000000', 4);
    t.setDepth(110).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.time.delayedCall(700, () => this.close(grade));
  }

  private close(grade: QteGrade): void {
    const cb = this.data0.onDone;
    this.scene.stop();
    cb(grade);
  }
}
