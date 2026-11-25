import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { QteGrade, QteSpec } from '../data/explore';
import { COMICS, GRADE_LABEL, type ComicDef, type ComicPanel } from '../data/comics';
import { ensureComicPanel, PANEL_H, PANEL_W, type PanelSlot } from '../art/ComicArt';
import { uiPanel } from '../explore/ui';
import { pixelText, wrapCJK } from '../utils/text';
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
/** 漫畫模式：2×2 分鏡格（每格 128×78 放大 2 倍） */
const SCALE = 2;
const CELL_W = PANEL_W * SCALE;
const CELL_H = PANEL_H * SCALE;
const GX = [Math.round((GAME_WIDTH - CELL_W * 2 - 28) / 2), 0];
GX[1] = GX[0] + CELL_W + 28;
const GY = [14, 14 + CELL_H + 16];

/**
 * 快速反應事件（疊在探索畫面上）：
 * - timing：指針來回掃，進到綠區時按下（空白鍵、點擊）
 * - sequence：照順序按方向鍵（觸控有四個方向按鈕）
 * - mash：限時內連打（空白鍵、點擊）
 *
 * 結果分三級：大成功（時機條沒失誤、方向鍵／連打剩很多時間）、成功、失敗。
 *
 * 漫畫模式（data.comic）：像美式漫畫一樣一格一格滑進來——
 * 第 1、2 格交代狀況 → 第 3 格是動作格，QTE 就在這格裡 → 第 4 格依結果換成不同的結果圖，點一下繼續。
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
    if (this.comic) {
      this.PX = GX[0];
      this.PY = GY[1];
      this.PW = CELL_W;
      this.PH = CELL_H;
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

  // ── 漫畫分鏡 ──

  /** 一格分鏡：黑框、放大的插圖、旁白框、狀聲詞；從 dir 方向滑進來 */
  private panel(col: number, row: number, slot: PanelSlot, p: ComicPanel | null, dir: 'left' | 'right' | 'up', delay: number, art = true): Phaser.GameObjects.Container {
    const id = this.data0.comic!.id;
    const zone = this.data0.comic!.zone;
    const x = GX[col];
    const y = GY[row];
    const c = this.add.container(x, y).setDepth(60);
    c.add(this.add.rectangle(-3, -3, CELL_W + 6, CELL_H + 6, 0x000000).setOrigin(0));
    c.add(this.add.rectangle(-1, -1, CELL_W + 2, CELL_H + 2, 0xf0e6d0).setOrigin(0));
    if (art) c.add(this.add.image(0, 0, ensureComicPanel(this, id, slot, zone)).setOrigin(0).setScale(SCALE));
    if (p) this.caption(c, p);
    const dx = dir === 'left' ? -GAME_WIDTH * 0.6 : dir === 'right' ? GAME_WIDTH * 0.6 : 0;
    const dy = dir === 'up' ? GAME_HEIGHT * 0.5 : 0;
    c.x += dx;
    c.y += dy;
    c.setAlpha(0);
    this.tweens.add({ targets: c, x, y, alpha: 1, duration: 280, delay, ease: 'Cubic.easeOut', onStart: () => AudioManager.ui('tap') });
    return c;
  }

  /** 旁白框（左上，黃底黑字）＋狀聲詞（右下，大字斜放） */
  private caption(c: Phaser.GameObjects.Container, p: ComicPanel): void {
    if (p.caption) {
      const t = wrapCJK(this.add.text(8, 6, p.caption, { fontFamily: 'monospace', fontSize: '9px', color: '#1a1408' }).setResolution(4), CELL_W - 40);
      const box = this.add.rectangle(3, 3, t.width + 10, t.height + 6, 0xf5e08a).setOrigin(0).setStrokeStyle(1, 0x000000);
      c.add([box, t]);
    }
    if (p.sfx) {
      const s = pixelText(this, CELL_W - 12, CELL_H - 14, p.sfx, 16, '#ffd24a').setOrigin(1, 1).setStroke('#000000', 4).setAngle(-8);
      c.add(s);
    }
  }

  /** 開場：第 1、2 格依序滑進來，接著第 3 格（動作格＋QTE）。點一下可以跳過等待 */
  private comicIntro(cm: ComicDef): void {
    // 漫畫頁的底：深色紙＋網點
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0c0a08, 0.92).setOrigin(0).setDepth(50);
    const dots = this.add.graphics().setDepth(51);
    dots.fillStyle(0x3a3228, 0.35);
    for (let y = 0; y < GAME_HEIGHT; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < GAME_WIDTH; x += 6) dots.fillRect(x, y, 1, 1);
    this.panel(0, 0, 's1', cm.setup[0], 'left', 0);
    this.panel(1, 0, 's2', cm.setup[1], 'right', 700);
    // 動作格：第 2 格放大裁切、壓暗，QTE 疊在上面
    const act = this.panel(0, 1, 's2', null, 'up', 1400, false);
    const img = this.add.image(CELL_W / 2, CELL_H / 2, ensureComicPanel(this, cm.id, 's2', this.data0.comic!.zone)).setScale(SCALE * 1.6);
    const mask = this.make.graphics({}, false);
    act.add(img);
    act.add(this.add.rectangle(0, 0, CELL_W, CELL_H, 0x000000, 0.62).setOrigin(0));
    const t = wrapCJK(this.add.text(8, 6, cm.action, { fontFamily: 'monospace', fontSize: '9px', color: '#1a1408' }).setResolution(4), CELL_W - 24);
    act.add([this.add.rectangle(3, 3, t.width + 10, t.height + 6, 0xffd24a).setOrigin(0).setStrokeStyle(1, 0x000000), t]);
    // 裁切：放大的圖不要跑出格子
    mask.fillStyle(0xffffff).fillRect(GX[0], GY[1], CELL_W, CELL_H);
    img.setMask(mask.createGeometryMask());
    // 結果格先放一個空框
    const empty = this.add.rectangle(GX[1] - 3, GY[1] - 3, CELL_W + 6, CELL_H + 6, 0x000000, 0.5).setOrigin(0).setDepth(55);
    empty.setStrokeStyle(1, 0x3a3228);
    pixelText(this, GX[1] + CELL_W / 2, GY[1] + CELL_H / 2, '？', 22, '#3a3228').setOrigin(0.5).setDepth(56);
    const start = () => {
      if (this.ready) return;
      this.ready = true;
      for (const o of this.children.list) this.tweens.killTweensOf(o);
      this.snapPanels();
      this.setWidgetsAlpha(1);
    };
    this.time.delayedCall(1750, start);
    // 開場時點一下：直接跳到 QTE（不會算成一次按壓）
    this.input.once('pointerdown', () => start());
    this.input.keyboard?.once('keydown', () => start());
  }

  /** 跳過開場時把三格擺回定位 */
  private snapPanels(): void {
    const cells = this.children.list.filter((o) => o instanceof Phaser.GameObjects.Container && (o as Phaser.GameObjects.Container).depth === 60) as Phaser.GameObjects.Container[];
    const spots = [
      [GX[0], GY[0]],
      [GX[1], GY[0]],
      [GX[0], GY[1]],
    ];
    cells.slice(0, 3).forEach((c, i) => c.setPosition(spots[i][0], spots[i][1]).setAlpha(1));
  }

  /** 結果格：依評等換圖、蓋上評等章，點一下繼續 */
  private comicResult(grade: QteGrade): void {
    const cm = this.comic!;
    this.panel(1, 1, grade, cm.result[grade], 'right', 0);
    const g = GRADE_LABEL[grade];
    const stamp = pixelText(this, GX[1] + CELL_W / 2, GY[1] + CELL_H / 2, g.text, 22, g.color).setOrigin(0.5).setStroke('#000000', 5).setDepth(120).setAngle(-10);
    stamp.setScale(2.2).setAlpha(0);
    this.tweens.add({ targets: stamp, scale: 1, alpha: 1, delay: 260, duration: 180, ease: 'Back.easeOut', onComplete: () => this.cameras.main.shake(120, grade === 'fail' ? 0.01 : 0.004) });
    this.tweens.add({ targets: stamp, alpha: 0, delay: 1300, duration: 300 });
    const hint = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 10, '點一下繼續', 8, '#c8b88a').setOrigin(0.5, 1).setDepth(120).setAlpha(0);
    this.time.delayedCall(700, () => {
      hint.setAlpha(1);
      this.tweens.add({ targets: hint, alpha: 0.35, yoyo: true, repeat: -1, duration: 500 });
      const go = () => this.close(grade);
      this.input.once('pointerdown', go);
      this.input.keyboard?.once('keydown', go);
    });
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
      this.time.delayedCall(220, () => this.comicResult(grade));
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
