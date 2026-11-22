import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { QteSpec } from '../data/explore';
import { uiPanel } from '../explore/ui';
import { pixelText } from '../utils/text';
import { rumble } from '../feel/Haptics';

export interface QteData {
  spec: QteSpec;
  /** 寬容度：1 為標準，越大越簡單（隊伍膽識加成） */
  ease: number;
  onDone: (success: boolean) => void;
}

type Dir = 'up' | 'down' | 'left' | 'right';
const ARROW: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

const PX = 120;
const PY = 110;
const PW = GAME_WIDTH - 240;
const PH = 150;

/**
 * 快速反應事件（疊在探索畫面上）：
 * - timing：指針來回掃，進到綠區時按下（空白鍵、點擊）
 * - sequence：照順序按方向鍵（觸控有四個方向按鈕）
 * - mash：限時內連打（空白鍵、點擊）
 */
export class QteScene extends Phaser.Scene {
  private data0!: QteData;
  private done = false;
  private timeLeft = 0;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private totalTime = 1;
  private tick: (dt: number) => void = () => {};

  constructor() {
    super('Qte');
  }

  init(data: QteData): void {
    this.data0 = data;
    this.done = false;
  }

  create(): void {
    const { spec } = this.data0;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0);
    uiPanel(this, PX, PY, PW, PH, 0xff8a6a);
    pixelText(this, GAME_WIDTH / 2, PY + 10, spec.prompt, 10, '#ffd24a').setOrigin(0.5, 0);
    this.add.rectangle(PX + 10, PY + PH - 12, PW - 20, 4, 0x000000).setOrigin(0).setDepth(100);
    this.timerBar = this.add.rectangle(PX + 11, PY + PH - 11, PW - 22, 2, 0xff8a6a).setOrigin(0).setDepth(101);
    if (spec.kind === 'timing') this.setupTiming();
    else if (spec.kind === 'sequence') this.setupSequence();
    else this.setupMash();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.removeAllListeners());
  }

  update(_t: number, deltaMs: number): void {
    if (this.done) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    this.tick(dt);
    if (this.totalTime > 0 && this.timeLeft > 0) {
      this.timeLeft -= dt;
      this.timerBar.width = (PW - 22) * Math.max(0, this.timeLeft / this.totalTime);
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

  // ── 時機條 ──
  private setupTiming(): void {
    const { spec, ease } = this.data0;
    const bx = PX + 30;
    const bw = PW - 60;
    const by = PY + 64;
    this.add.rectangle(bx, by, bw, 16, 0x1c2029).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.3).setDepth(100);
    const zone = this.add.rectangle(bx, by + 1, 10, 14, 0x4caf50, 0.85).setOrigin(0).setDepth(101);
    const needle = this.add.rectangle(bx, by - 4, 3, 24, 0xffffff).setOrigin(0.5, 0).setDepth(102);
    const status = pixelText(this, GAME_WIDTH / 2, by + 26, '', 9).setOrigin(0.5, 0);
    const hint = pixelText(this, GAME_WIDTH / 2, by + 44, '空白鍵或點擊', 7, '#90a4ae').setOrigin(0.5, 0);
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
      if (this.done || lock > 0) return;
      const inZone = needle.x >= zone.x - 1 && needle.x <= zone.x + zone.width + 1;
      if (inZone) {
        hits++;
        AudioManager.ui('confirm');
        this.flash(zone, 0x4caf50);
        if (hits >= spec.count) return this.finish(true);
        place();
      } else {
        misses++;
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
    const seq: Dir[] = Array.from({ length: spec.count }, () => Phaser.Utils.Array.GetRandom(DIRS));
    this.totalTime = this.timeLeft = spec.time * ease;
    const gap = 30;
    const x0 = GAME_WIDTH / 2 - ((seq.length - 1) * gap) / 2;
    const cells = seq.map((d, i) => {
      const bg = this.add.rectangle(x0 + i * gap, PY + 60, 24, 24, 0x2a2f3a).setStrokeStyle(1, 0xffffff, 0.5).setDepth(100);
      const t = pixelText(this, x0 + i * gap, PY + 60, ARROW[d], 12).setOrigin(0.5);
      return { bg, t };
    });
    let at = 0;
    const press = (d: Dir) => {
      if (this.done) return;
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
      const x = GAME_WIDTH / 2 + (i - 1.5) * 44;
      const b = this.add.rectangle(x, by + 10, 36, 26, 0x1c2029).setStrokeStyle(1, 0xffffff, 0.4).setDepth(100);
      pixelText(this, x, by + 10, ARROW[d], 11, '#c8c8c8').setOrigin(0.5);
      b.setInteractive({ useHandCursor: true }).on('pointerdown', () => press(d));
    });
  }

  // ── 連打 ──
  private setupMash(): void {
    const { spec, ease } = this.data0;
    this.totalTime = this.timeLeft = spec.time * ease;
    const need = Math.max(6, Math.round(spec.count / Math.sqrt(ease)));
    const bx = PX + 40;
    const bw = PW - 80;
    const by = PY + 60;
    this.add.rectangle(bx, by, bw, 14, 0x1c2029).setOrigin(0).setStrokeStyle(1, 0xffffff, 0.3).setDepth(100);
    const fill = this.add.rectangle(bx + 1, by + 1, 0, 12, 0xffa726).setOrigin(0).setDepth(101);
    const big = pixelText(this, GAME_WIDTH / 2, by + 34, '連打！', 14, '#ffffff').setOrigin(0.5);
    pixelText(this, GAME_WIDTH / 2, by + 52, '空白鍵或點擊', 7, '#90a4ae').setOrigin(0.5, 0);
    let v = 0;
    this.tick = (dt) => {
      // 不按就慢慢掉回去
      v = Math.max(0, v - dt * need * 0.12);
      fill.width = (bw - 2) * Math.min(1, v / need);
    };
    this.onPress(() => {
      if (this.done) return;
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

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    const t = pixelText(this, GAME_WIDTH / 2, PY + PH / 2, ok ? '成功！' : '失敗！', 18, ok ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setStroke('#000000', 4);
    t.setDepth(110).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    AudioManager.play(ok ? 'ui_confirm' : 'player_hurt');
    this.time.delayedCall(700, () => {
      const cb = this.data0.onDone;
      this.scene.stop();
      cb(ok);
    });
  }
}
