import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { RENDER_SCALE } from '../render/RenderScale';
import { UI_FONT, fontPx, wrapCJK } from '../utils/text';
import { rumble } from '../feel/Haptics';
import { resolveComicArt } from './art';
import type { Beat, ComicScript, PanelBeat, PanelCam, PanelSfx, PanelText, Rect } from './types';

export interface SequencerOptions {
  /** 區域（qte/ 分鏡依區域換配色） */
  zone?: string;
  /** 底色的不透明度（疊在遊戲畫面上的演出可以透一點） */
  bgAlpha?: number;
  /** 互動節拍：交給宿主，回傳結果字串（例如 QTE 的 great / ok / fail） */
  interact?: (id: string, rect: Rect | null) => Promise<string>;
}

/** 網點貼圖：step×step 的格子裡一個點（交錯排列，所以貼圖是 step×2 見方） */
function dotTexture(scene: Phaser.Scene, step: number, c: number, a: number): string {
  const key = `comic_dots_${step}_${c.toString(16)}_${a}`;
  if (scene.textures.exists(key)) return key;
  const t = scene.textures.createCanvas(key, step * 2, step * 2)!;
  const ctx = t.getContext();
  ctx.fillStyle = `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(step, 0, 1, 1);
  ctx.fillRect(step / 2, step, 1, 1);
  ctx.fillRect(step + step / 2, step, 1, 1);
  t.refresh();
  return key;
}

/** 演出 UI（跳過鈕、提示）的深度：必須小於 100，QTE 元件從 100 起跳 */
const D_BG = 8;
const D_PANEL = 10;
const D_TITLE = 92;
const D_FLASH = 94;
const D_UI = 96;

/** 快轉時，還在跑的進場動畫加速幾倍 */
const FF_SPEED = 40;

interface View {
  x: number;
  y: number;
  sx: number;
  sy: number;
  alpha: number;
  angle: number;
}

interface LivePanel {
  id: string;
  beat: PanelBeat;
  w: number;
  h: number;
  c: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  aw: number;
  ah: number;
  /** 插圖剛好蓋滿畫格的倍率 */
  base: number;
  maskG: Phaser.GameObjects.Graphics;
  fxG: Phaser.GameObjects.Graphics;
  dim: Phaser.GameObjects.Rectangle;
  cm?: Phaser.FX.ColorMatrix;
  view: View;
  cam: { z: number; x: number; y: number };
  camTween?: Phaser.Tweens.Tween;
  /** 裁切揭露：可見範圍（畫格寬高的比例） */
  reveal: { x0: number; x1: number; y0: number; y1: number };
  /** 退到背景的程度 0（焦點）..1（最舊） */
  dimLevel: number;
  appliedDim: number;
  frozen: boolean;
  speedAt: number;
  /** 突破格子的物件插在這個位置（畫面之上、文字與擬聲字之下） */
  popIndex: number;
}

/**
 * 漫畫分格演出引擎：在任何場景裡依劇本（ComicScript）一格一格演出。
 *
 * 核心規則：
 * - 新畫格依劇本的位置、大小、傾斜角度進場，舊畫格不消失，依「出現先後」逐層壓暗、褪色、微縮，退到背景
 * - 最新（或被 focus 叫回來）的畫格保持明亮清晰，是當下的焦點
 * - 點一下：動畫跑到一半就快轉到定位；已經定位就往下一格；劇本可以要求某格一定要點才往下走
 * - interact 節拍把控制權交給宿主場景（QTE），宿主回傳結果後，branch 依結果接不同的畫格
 *
 * 用法：new ComicSequencer(scene, script, opts).run().then(...)；場景關閉時自動清理。
 */
export class ComicSequencer {
  private panels = new Map<string, LivePanel>();
  /** 焦點順序：最後一個是焦點 */
  private order: LivePanel[] = [];
  private depthSeq = D_PANEL;
  private tweensLive = new Set<Phaser.Tweens.Tween>();
  private sleepers = new Set<() => void>();
  private tapWaiters = new Set<() => void>();
  /** 這一拍被點過：剩下的進場動畫快轉 */
  private ff = false;
  /** 正在跑進場動畫（點一下 = 快轉） */
  private busy = false;
  private interacting = false;
  private stopped = false;
  private lastResult = '';
  private flashRect!: Phaser.GameObjects.Rectangle;
  private hint!: Phaser.GameObjects.Text;
  private hintTween?: Phaser.Tweens.Tween;
  private skipBtn?: Phaser.GameObjects.Text;
  private bgObjs: Phaser.GameObjects.GameObject[] = [];
  private onUpdate = (): void => this.update();
  private onPointer = (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void => {
    if (this.skipBtn && over.includes(this.skipBtn)) return;
    this.tap();
  };
  private onKey = (): void => this.tap();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly script: ComicScript,
    private readonly opts: SequencerOptions = {},
  ) {
    const bg = script.bg ?? 0x0c0a08;
    const bgRect = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, bg, opts.bgAlpha ?? 1).setOrigin(0).setDepth(D_BG);
    // 深色紙上的網點（預先畫成貼圖，不要每幀畫幾千個點）
    const dots = scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, dotTexture(scene, 6, 0x3a3228, 0.35)).setOrigin(0).setDepth(D_BG);
    this.bgObjs.push(bgRect, dots);
    this.flashRect = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0xffffff, 0).setOrigin(0).setDepth(D_FLASH);
    this.hint = scene.add.text(GAME_WIDTH - 10, GAME_HEIGHT - 6, '▼', this.style(9, '#f5e08a')).setOrigin(1, 1).setDepth(D_UI).setAlpha(0);
    this.hint.setStroke('#000000', 3);
    if (script.skippable) {
      this.skipBtn = scene.add.text(GAME_WIDTH - 8, 6, '跳過 ▶▶', this.style(8, '#c8b88a')).setOrigin(1, 0).setDepth(D_UI).setAlpha(0.75);
      this.skipBtn.setStroke('#000000', 3).setPadding(4, 2, 4, 2);
      this.skipBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.skip());
    }
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    scene.input.on('pointerdown', this.onPointer);
    scene.input.keyboard?.on('keydown-SPACE', this.onKey);
    scene.input.keyboard?.on('keydown-ENTER', this.onKey);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  /** 播完整段（含結尾等玩家點一下）；被跳過也會 resolve */
  async run(): Promise<void> {
    if (this.script.mood) AudioManager.setMood(this.script.mood as Parameters<typeof AudioManager.setMood>[0]);
    await this.playBeats(this.script.beats);
    if (!this.stopped && this.script.endTap !== false) await this.hold('tap');
    this.stopped = true;
  }

  /** 收掉所有畫格（淡出），宿主想自己接轉場時可以不呼叫 */
  async fadeOut(ms = 260): Promise<void> {
    const objs = [...this.order.map((p) => p.c), ...this.bgObjs, this.hint];
    if (this.skipBtn) objs.push(this.skipBtn);
    this.ff = false;
    await this.tween({ targets: objs, alpha: 0, duration: ms });
    for (const p of this.order) p.view.alpha = 0;
  }

  /** 畫格在畫面上的位置（宿主要在格子裡放東西時用） */
  rectOf(id: string): Rect | null {
    return this.panels.get(id)?.beat.rect ?? null;
  }

  // ── 節拍 ─────────────────────────────────────

  private async playBeats(beats: Beat[]): Promise<void> {
    for (const b of beats) {
      if (this.stopped) return;
      this.ff = false;
      await this.beat(b);
    }
  }

  private async beat(b: Beat): Promise<void> {
    switch (b.type) {
      case 'panel':
        return this.panel(b);
      case 'freeze':
        return this.freeze(b.id, b.hold, b.sound);
      case 'focus': {
        const p = this.panels.get(b.id);
        if (!p) return;
        this.order = this.order.filter((q) => q !== p).concat(p);
        p.c.setDepth(++this.depthSeq);
        this.restack();
        AudioManager.ui('tap');
        return this.hold(b.hold ?? 1600);
      }
      case 'move': {
        const p = this.panels.get(b.id);
        if (!p) return;
        this.busy = true;
        await this.tween({
          targets: p.view,
          x: b.rect.x + b.rect.w / 2,
          y: b.rect.y + b.rect.h / 2,
          sx: b.rect.w / p.w,
          sy: b.rect.h / p.h,
          angle: b.tilt ?? p.view.angle,
          duration: b.dur ?? 420,
          ease: 'Cubic.easeInOut',
        });
        p.beat = { ...p.beat, rect: b.rect };
        this.busy = false;
        return;
      }
      case 'remove': {
        const p = this.panels.get(b.id);
        if (!p) return;
        await this.tween({ targets: p.view, alpha: 0, duration: 200 });
        this.drop(p);
        return;
      }
      case 'clear':
        return this.clear(b.dir ?? 'left');
      case 'wait':
        return this.hold(b.ms);
      case 'sound':
        AudioManager.play(b.key);
        return;
      case 'interact': {
        this.interacting = true;
        this.hideHint();
        const rect = b.panel ? this.rectOf(b.panel) : null;
        this.lastResult = this.opts.interact ? await this.opts.interact(b.id, rect) : '';
        this.interacting = false;
        return;
      }
      case 'branch':
        return this.playBeats(b.cases[this.lastResult] ?? b.cases.default ?? []);
      case 'title':
        return this.title(b.text, b.sub, b.hold);
    }
  }

  // ── 畫格 ─────────────────────────────────────

  private async panel(b: PanelBeat): Promise<void> {
    const old = this.panels.get(b.id);
    if (old) this.drop(old);
    const p = this.build(b);
    this.panels.set(b.id, p);
    this.order.push(p);
    if (b.dimOthers !== false) this.restack();
    this.busy = true;
    const jobs: Promise<unknown>[] = [this.enter(p)];
    if (b.sound) AudioManager.play(b.sound);
    else AudioManager.ui('tap');
    for (const t of b.texts ?? []) jobs.push(this.text(p, t));
    for (const s of b.sfx ?? []) jobs.push(this.sfx(p, s));
    if (b.pop) jobs.push(this.pop(p));
    await Promise.all(jobs);
    this.busy = false;
    // 格內運鏡：進場之後慢慢推
    this.startCam(p);
    const chars = (b.texts ?? []).reduce((n, t) => n + t.text.length, 0);
    const auto = Phaser.Math.Clamp(900 + chars * 55, 1100, 4200);
    await this.hold(b.hold ?? auto);
  }

  private build(b: PanelBeat): LivePanel {
    const s = this.scene;
    const { w, h } = b.rect;
    const c = s.add.container(b.rect.x + w / 2, b.rect.y + h / 2).setDepth(++this.depthSeq);
    // 外框：黑邊＋一圈紙白＋格子裡的暗底（裁切揭露前看得到空框）
    c.add(s.add.rectangle(0, 0, w + 6, h + 6, b.border ?? 0x000000));
    c.add(s.add.rectangle(0, 0, w + 2, h + 2, 0xf0e6d0));
    c.add(s.add.rectangle(0, 0, w, h, 0x050505));
    const key = resolveComicArt(s, b.art, this.opts.zone);
    const img = s.add.image(0, 0, key);
    const aw = img.width;
    const ah = img.height;
    // 剛好蓋滿畫格的倍率；接近整數倍時吸到整數，像素比較整齊
    const cover = Math.max(w / aw, h / ah);
    const base = Math.abs(cover - Math.round(cover)) < 0.08 ? Math.max(cover, Math.round(cover)) : cover;
    c.add(img);
    const fxG = s.add.graphics();
    c.add(fxG);
    if (b.shade) c.add(s.add.rectangle(0, 0, w, h, 0x000000, b.shade));
    if (b.fx?.includes('red')) c.add(s.add.rectangle(0, 0, w, h, 0x900000, 0.22));
    if (b.fx?.includes('halftone')) c.add(this.halftone(w, h, 0xffffff, 0.12));
    const dim = s.add.rectangle(0, 0, w + 6, h + 6, 0x05040a, 0);
    const maskG = s.make.graphics({}, false);
    const mask = maskG.createGeometryMask();
    img.setMask(mask);
    fxG.setMask(mask);
    let cm: Phaser.FX.ColorMatrix | undefined;
    try {
      cm = img.preFX?.addColorMatrix();
    } catch {
      cm = undefined;
    }
    const from = b.cam?.from ?? {};
    const p: LivePanel = {
      id: b.id,
      beat: b,
      w,
      h,
      c,
      img,
      aw,
      ah,
      base,
      maskG,
      fxG,
      dim,
      cm,
      view: { x: c.x, y: c.y, sx: 1, sy: 1, alpha: 1, angle: b.tilt ?? 0 },
      cam: { z: from.zoom ?? 1, x: from.x ?? 0.5, y: from.y ?? 0.5 },
      reveal: { x0: 0, x1: 1, y0: 0, y1: 1 },
      dimLevel: 0,
      appliedDim: -1,
      frozen: false,
      speedAt: 0,
      popIndex: c.list.length,
    };
    // dim 疊在最上面（文字、擬聲字、突破的物件也一起退到背景），在 text()/pop() 之後重新排到最上
    c.add(dim);
    this.sync(p);
    return p;
  }

  /** 進場動畫 */
  private enter(p: LivePanel): Promise<void> {
    const b = p.beat;
    const v = p.view;
    const tx = v.x;
    const ty = v.y;
    const dur = b.dur ?? (b.enter === 'slam' ? 240 : 340);
    const ease = 'Cubic.easeOut';
    switch (b.enter ?? 'slide-left') {
      case 'slide-left':
        v.x = -p.w / 2 - 20;
        v.alpha = 0;
        return this.tween({ targets: v, x: tx, alpha: 1, duration: dur, ease });
      case 'slide-right':
        v.x = GAME_WIDTH + p.w / 2 + 20;
        v.alpha = 0;
        return this.tween({ targets: v, x: tx, alpha: 1, duration: dur, ease });
      case 'slide-up':
        v.y = GAME_HEIGHT + p.h / 2 + 20;
        v.alpha = 0;
        return this.tween({ targets: v, y: ty, alpha: 1, duration: dur, ease });
      case 'slide-down':
        v.y = -p.h / 2 - 20;
        v.alpha = 0;
        return this.tween({ targets: v, y: ty, alpha: 1, duration: dur, ease });
      case 'zoom':
        v.sx = v.sy = 0.35;
        v.alpha = 0;
        return this.tween({ targets: v, sx: 1, sy: 1, alpha: 1, duration: dur, ease: 'Back.easeOut' });
      case 'unfold-x':
        v.sx = 0.02;
        return this.tween({ targets: v, sx: 1, duration: dur, ease });
      case 'unfold-y':
        v.sy = 0.02;
        return this.tween({ targets: v, sy: 1, duration: dur, ease });
      case 'wipe-right':
        p.reveal.x1 = 0;
        return this.tween({ targets: p.reveal, x1: 1, duration: dur * 1.4, ease: 'Sine.easeInOut' });
      case 'wipe-left':
        p.reveal.x0 = 1;
        return this.tween({ targets: p.reveal, x0: 0, duration: dur * 1.4, ease: 'Sine.easeInOut' });
      case 'wipe-down':
        p.reveal.y1 = 0;
        return this.tween({ targets: p.reveal, y1: 1, duration: dur * 1.4, ease: 'Sine.easeInOut' });
      case 'slam':
        v.sx = v.sy = 1.55;
        v.alpha = 0;
        return this.tween({ targets: v, sx: 1, sy: 1, alpha: 1, duration: dur, ease: 'Quad.easeIn' }).then(() => this.impact(p));
      case 'cut':
      default:
        return Promise.resolve();
    }
  }

  /** 重大事件落地：白閃、震動、手把震動 */
  private impact(p: LivePanel): void {
    const fx = p.beat.fx ?? [];
    if (p.beat.enter === 'slam' || fx.includes('flash')) this.flash();
    if (p.beat.enter === 'slam' || fx.includes('shake')) {
      this.scene.cameras.main.shake(220, 0.012);
      rumble(120, 0.7);
    }
  }

  private flash(a = 0.9, ms = 220): void {
    this.flashRect.setAlpha(a);
    this.scene.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms, ease: 'Quad.easeOut' });
  }

  private startCam(p: LivePanel): void {
    const to = p.beat.cam?.to;
    if (!to || p.frozen) return;
    const auto = typeof p.beat.hold === 'number' ? p.beat.hold : 3000;
    p.camTween = this.scene.tweens.add({
      targets: p.cam,
      z: to.zoom ?? p.cam.z,
      x: to.x ?? p.cam.x,
      y: to.y ?? p.cam.y,
      duration: p.beat.cam?.dur ?? auto,
      ease: 'Sine.easeInOut',
    });
  }

  /** 依焦點順序重新分配「退到背景」的程度 */
  private restack(): void {
    const n = this.order.length;
    this.order.forEach((p, i) => {
      const age = n - 1 - i;
      const target = age === 0 ? 0 : Math.min(1, 0.55 + (age - 1) * 0.18);
      this.scene.tweens.add({ targets: p, dimLevel: target, duration: 380, ease: 'Sine.easeOut' });
      // 舊畫格的速度線停下來
      if (age > 0) p.fxG.clear();
    });
  }

  private freeze(id: string | undefined, hold: number | 'tap' | undefined, sound?: string): Promise<void> {
    const p = id ? this.panels.get(id) : this.order[this.order.length - 1];
    if (!p) return Promise.resolve();
    p.frozen = true;
    p.camTween?.pause();
    p.fxG.clear();
    this.flash(1, 300);
    AudioManager.play(sound ?? 'ui_confirm');
    // 定格的質感：網點＋一點冷色、整格微微放大
    const ht = this.halftone(p.w, p.h, 0xffffff, 0.22);
    const cold = this.scene.add.rectangle(0, 0, p.w, p.h, 0x203048, 0.18);
    p.c.addAt(cold, p.c.getIndex(p.fxG) + 1);
    p.c.addAt(ht, p.c.getIndex(p.fxG) + 1);
    p.cm?.saturate(-0.5);
    p.view.sx = p.view.sy = 1.04;
    this.scene.tweens.add({ targets: p.view, sx: 1, sy: 1, duration: 260, ease: 'Back.easeOut' });
    this.scene.cameras.main.shake(140, 0.006);
    return this.hold(hold ?? 900);
  }

  private async clear(dir: 'left' | 'right' | 'up' | 'down' | 'fade'): Promise<void> {
    const list = [...this.order];
    if (!list.length) return;
    this.busy = true;
    const jobs = list.map((p, i) => {
      const cfg: Record<string, number> = { alpha: 0 };
      if (dir === 'left') cfg.x = p.view.x - GAME_WIDTH;
      if (dir === 'right') cfg.x = p.view.x + GAME_WIDTH;
      if (dir === 'up') cfg.y = p.view.y - GAME_HEIGHT;
      if (dir === 'down') cfg.y = p.view.y + GAME_HEIGHT;
      return this.tween({ targets: p.view, ...cfg, duration: 320, delay: i * 50, ease: 'Cubic.easeIn' });
    });
    AudioManager.ui('back');
    await Promise.all(jobs);
    list.forEach((p) => this.drop(p));
    this.busy = false;
  }

  private async title(text: string, sub: string | undefined, hold: number | 'tap' | undefined): Promise<void> {
    const s = this.scene;
    const subLines = sub ? sub.split('\n').length : 0;
    const band = s.add.rectangle(0, GAME_HEIGHT / 2, GAME_WIDTH, (sub ? 60 : 56) + subLines * 18, 0x000000, 0.86).setOrigin(0, 0.5).setDepth(D_TITLE);
    const t = s.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - (subLines * 18) / 2 - (sub ? 4 : 0), text, { ...this.style(20, '#f5d76e'), fontStyle: 'bold' }).setOrigin(0.5).setDepth(D_TITLE);
    t.setStroke('#000000', 5);
    const objs: Phaser.GameObjects.GameObject[] = [band, t];
    if (sub) objs.push(s.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - (subLines * 18) / 2 + 18, sub, { ...this.style(9, '#d8cfb8'), align: 'center' }).setOrigin(0.5, 0).setDepth(D_TITLE).setLineSpacing(4));
    band.scaleY = 0;
    t.setScale(1.6).setAlpha(0);
    this.busy = true;
    AudioManager.play('stinger_win');
    await Promise.all([
      this.tween({ targets: band, scaleY: 1, duration: 200, ease: 'Cubic.easeOut' }),
      this.tween({ targets: t, scale: 1, alpha: 1, duration: 260, delay: 120, ease: 'Back.easeOut' }),
    ]);
    this.busy = false;
    await this.hold(hold ?? 1800);
    this.ff = false;
    await this.tween({ targets: objs, alpha: 0, duration: 260 });
    objs.forEach((o) => o.destroy());
  }

  // ── 文字 ─────────────────────────────────────

  private style(size: number, color: string): Phaser.Types.GameObjects.Text.TextStyle {
    return { fontFamily: UI_FONT, fontSize: `${fontPx(size)}px`, color, resolution: RENDER_SCALE };
  }

  /** 旁白框／對白泡泡：框先彈出來，字再一個一個打出來 */
  private async text(p: LivePanel, t: PanelText): Promise<void> {
    const s = this.scene;
    const kind = t.kind ?? 'caption';
    const maxW = t.w ?? Math.min(p.w - t.x - 8, kind === 'caption' ? 220 : 170);
    const lx = t.x - p.w / 2;
    const ly = t.y - p.h / 2;
    const pad = kind === 'caption' ? 5 : 7;
    const label = wrapCJK(s.add.text(lx + pad, ly + pad - 1, t.text, this.style(7, '#16120a')), maxW);
    label.setLineSpacing(1);
    const full = label.text;
    const bw = label.width + pad * 2;
    const bh = label.height + pad * 2 - 2;
    const g = s.add.graphics();
    this.drawBox(g, kind, lx, ly, bw, bh, t.tail ? [t.tail[0] - p.w / 2, t.tail[1] - p.h / 2] : undefined);
    const group = [g, label];
    group.forEach((o) => o.setAlpha(0));
    p.c.add(group);
    p.c.bringToTop(p.dim);
    await this.sleep((t.delay ?? 0) + 160);
    if (this.stopped) return;
    group.forEach((o) => o.setAlpha(1));
    g.setScale(0.85);
    this.tween({ targets: g, scale: 1, duration: 120, ease: 'Back.easeOut' });
    // 打字機（照時間推進，不受幀率影響）
    const chars = Array.from(full);
    const tw = { n: 0 };
    await this.tween({
      targets: tw,
      n: chars.length,
      duration: chars.length * 28,
      onUpdate: () => label.setText(chars.slice(0, Math.ceil(tw.n)).join('')),
    });
    label.setText(full);
  }

  private drawBox(g: Phaser.GameObjects.Graphics, kind: string, x: number, y: number, w: number, h: number, tail?: [number, number]): void {
    if (kind === 'caption') {
      g.fillStyle(0x000000).fillRect(x + 2, y + 2, w, h);
      g.fillStyle(0xf5e08a).fillRect(x, y, w, h);
      g.lineStyle(1, 0x000000).strokeRect(x, y, w, h);
      return;
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (tail && kind === 'speech') {
      // 尾巴：從泡泡底部中間附近拉一個三角形到說話的人
      const bx = Phaser.Math.Clamp(tail[0], x + 8, x + w - 8);
      const by = tail[1] > cy ? y + h - 2 : y + 2;
      g.fillStyle(0xffffff).lineStyle(1.5, 0x000000);
      g.fillTriangle(bx - 5, by, bx + 5, by, tail[0], tail[1]);
      g.strokeTriangle(bx - 5, by, bx + 5, by, tail[0], tail[1]);
    }
    if (kind === 'shout') {
      const pts: Phaser.Math.Vector2[] = [];
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = i % 2 ? 1 : 1.22;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * (w / 2 + 6) * r, cy + Math.sin(a) * (h / 2 + 6) * r));
      }
      g.fillStyle(0xffffff).fillPoints(pts, true);
      g.lineStyle(1.5, 0x000000).strokePoints(pts, true);
      return;
    }
    g.fillStyle(0xffffff).fillRoundedRect(x, y, w, h, Math.min(8, h / 2));
    g.lineStyle(kind === 'thought' ? 1 : 1.5, 0x000000).strokeRoundedRect(x, y, w, h, Math.min(8, h / 2));
    if (tail && kind === 'speech') {
      // 蓋掉尾巴根部的框線
      const bx = Phaser.Math.Clamp(tail[0], x + 8, x + w - 8);
      const by = tail[1] > cy ? y + h - 1 : y;
      g.fillStyle(0xffffff).fillRect(bx - 4, by - 1, 8, 3);
    }
    if (tail && kind === 'thought') {
      for (let i = 1; i <= 3; i++) {
        const k = i / 4;
        const px = Phaser.Math.Linear(cx, tail[0], k);
        const py = Phaser.Math.Linear(tail[1] > cy ? y + h : y, tail[1], k);
        g.fillStyle(0xffffff).fillCircle(px, py, 4 - i);
        g.lineStyle(1, 0x000000).strokeCircle(px, py, 4 - i);
      }
    }
  }

  /** 擬聲字：放大砸下來、微微晃動 */
  private async sfx(p: LivePanel, f: PanelSfx): Promise<void> {
    const s = this.scene;
    const t = s.add.text(f.x - p.w / 2, f.y - p.h / 2, f.text, { ...this.style(f.size ?? 16, f.color ?? '#ffd24a'), fontStyle: 'bold' });
    t.setOrigin(0.5).setStroke('#000000', 6).setAngle(f.angle ?? -8).setAlpha(0);
    t.setShadow(3, 3, '#000000', 0, true, true);
    p.c.add(t);
    p.c.bringToTop(p.dim);
    await this.sleep((f.delay ?? 0) + 200);
    if (this.stopped) return;
    t.setAlpha(1).setScale(2.4);
    await this.tween({ targets: t, scale: 1, duration: 170, ease: 'Back.easeOut' });
    this.scene.tweens.add({ targets: t, angle: (f.angle ?? -8) + 3, duration: 90, yoyo: true, repeat: 2 });
  }

  /** 突破格子邊界的物件 */
  private async pop(p: LivePanel): Promise<void> {
    const b = p.beat.pop!;
    const key = resolveComicArt(this.scene, b.art, this.opts.zone);
    const img = this.scene.add.image(b.x - p.w / 2, b.y - p.h / 2, key).setScale(b.scale ?? p.base).setAlpha(0);
    p.c.addAt(img, p.popIndex);
    await this.sleep((b.delay ?? 0) + 120);
    if (this.stopped) return;
    const [dx, dy] = b.from ?? [0, 30];
    const tx = img.x;
    const ty = img.y;
    img.setPosition(tx + dx, ty + dy).setAlpha(1);
    await this.tween({ targets: img, x: tx, y: ty, duration: 180, ease: 'Back.easeOut' });
  }

  private halftone(w: number, h: number, c: number, a: number): Phaser.GameObjects.TileSprite {
    return this.scene.add.tileSprite(0, 0, w, h, dotTexture(this.scene, 4, c, a));
  }

  // ── 每幀 ─────────────────────────────────────

  private update(): void {
    const now = this.scene.time.now;
    for (const p of this.order) {
      this.sync(p);
      const focus = p === this.order[this.order.length - 1];
      if (focus && !p.frozen && now - p.speedAt > 70) {
        p.speedAt = now;
        this.drawSpeed(p);
      }
    }
  }

  /** 把 view / 鏡頭 / 裁切 / 退場程度套到實際物件上 */
  private sync(p: LivePanel): void {
    const v = p.view;
    const shrink = 1 - p.dimLevel * 0.035;
    p.c.setPosition(v.x, v.y).setScale(v.sx * shrink, v.sy * shrink).setAngle(v.angle).setAlpha(v.alpha);
    // 格內鏡頭
    const sc = p.base * Math.max(1, p.cam.z);
    p.img.setScale(sc);
    const iw = p.aw * sc;
    const ih = p.ah * sc;
    const mx = Math.max(0, (iw - p.w) / 2);
    const my = Math.max(0, (ih - p.h) / 2);
    p.img.x = Phaser.Math.Clamp((0.5 - p.cam.x) * iw, -mx, mx);
    p.img.y = Phaser.Math.Clamp((0.5 - p.cam.y) * ih, -my, my);
    // 遮罩（世界座標）：跟著容器的位置、縮放、角度
    const r = p.reveal;
    p.maskG.clear();
    p.maskG.fillStyle(0xffffff);
    p.maskG.fillRect(-p.w / 2 + r.x0 * p.w, -p.h / 2 + r.y0 * p.h, Math.max(0, (r.x1 - r.x0) * p.w), Math.max(0, (r.y1 - r.y0) * p.h));
    p.maskG.setPosition(p.c.x, p.c.y).setScale(p.c.scaleX, p.c.scaleY).setAngle(p.c.angle);
    // 退到背景：壓暗＋褪色
    if (Math.abs(p.appliedDim - p.dimLevel) > 0.005) {
      p.appliedDim = p.dimLevel;
      p.dim.setAlpha(p.dimLevel * 0.7);
      if (p.cm && !p.frozen) {
        p.cm.reset();
        p.cm.saturate(-0.85 * p.dimLevel);
      }
    }
  }

  /** 焦點格的速度線：每 70ms 重畫一次，線條會閃動 */
  private drawSpeed(p: LivePanel): void {
    const fx = p.beat.fx ?? [];
    const g = p.fxG;
    if (!fx.includes('speed') && !fx.includes('dash')) return;
    g.clear();
    const hw = p.w / 2;
    const hh = p.h / 2;
    if (fx.includes('speed')) {
      const cx = (p.cam.x - 0.5) * p.w * 0.6;
      const cy = (p.cam.y - 0.5) * p.h * 0.6;
      const R = Math.hypot(p.w, p.h);
      const inner = Math.min(p.w, p.h) * 0.34;
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = inner + Math.random() * inner * 0.6;
        const wdt = 1 + Math.random() * 2.2;
        g.fillStyle(0xffffff, 0.35 + Math.random() * 0.35);
        const x0 = cx + Math.cos(a) * r0;
        const y0 = cy + Math.sin(a) * r0;
        const nx = -Math.sin(a) * wdt;
        const ny = Math.cos(a) * wdt;
        g.fillTriangle(x0, y0, cx + Math.cos(a) * R + nx, cy + Math.sin(a) * R + ny, cx + Math.cos(a) * R - nx, cy + Math.sin(a) * R - ny);
      }
    }
    if (fx.includes('dash')) {
      for (let i = 0; i < 16; i++) {
        const y = -hh + Math.random() * p.h;
        const len = 20 + Math.random() * 60;
        g.fillStyle(0xffffff, 0.3 + Math.random() * 0.3);
        g.fillRect(-hw + Math.random() * p.w - len / 2, y, len, 1);
      }
    }
  }

  // ── 時間控制 ──────────────────────────────────

  private tween(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((res) => {
      if (this.stopped) return res();
      const t = this.scene.tweens.add({
        ...cfg,
        onComplete: () => {
          this.tweensLive.delete(t);
          res();
        },
        onStop: () => {
          this.tweensLive.delete(t);
          res();
        },
      });
      this.tweensLive.add(t);
      if (this.ff) t.timeScale = FF_SPEED;
    });
  }

  /** 演出中的等待：點一下（快轉）就立刻結束 */
  private sleep(ms: number): Promise<void> {
    if (this.ff || this.stopped || ms <= 0) return Promise.resolve();
    return new Promise((res) => {
      const done = (): void => {
        ev.remove(false);
        this.sleepers.delete(done);
        res();
      };
      const ev = this.scene.time.delayedCall(ms, done);
      this.sleepers.add(done);
    });
  }

  /** 停留：等時間到或玩家點一下；'tap' 一定要點 */
  private hold(ms: number | 'tap'): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.showHint(ms === 'tap');
    return new Promise((res) => {
      let ev: Phaser.Time.TimerEvent | undefined;
      const done = (): void => {
        ev?.remove(false);
        this.tapWaiters.delete(done);
        this.hideHint();
        res();
      };
      if (ms !== 'tap') ev = this.scene.time.delayedCall(ms, done);
      this.tapWaiters.add(done);
    });
  }

  private tap(): void {
    if (this.interacting || this.stopped) return;
    if (this.busy) {
      this.fastForward();
      return;
    }
    const w = [...this.tapWaiters];
    w.forEach((f) => f());
  }

  private fastForward(): void {
    this.ff = true;
    for (const t of this.tweensLive) t.timeScale = FF_SPEED;
    [...this.sleepers].forEach((f) => f());
  }

  /** 跳過整段 */
  skip(): void {
    if (this.stopped || this.interacting) return;
    this.stopped = true;
    this.fastForward();
    [...this.tapWaiters].forEach((f) => f());
    AudioManager.ui('back');
  }

  private showHint(must: boolean): void {
    this.hint.setText(must ? '點一下繼續 ▼' : '▼');
    this.hint.setAlpha(1);
    this.hintTween?.remove();
    this.hintTween = this.scene.tweens.add({ targets: this.hint, alpha: 0.3, yoyo: true, repeat: -1, duration: 450 });
  }

  private hideHint(): void {
    this.hintTween?.remove();
    this.hintTween = undefined;
    this.hint.setAlpha(0);
  }

  private drop(p: LivePanel): void {
    p.camTween?.remove();
    p.maskG.destroy();
    p.c.destroy();
    this.panels.delete(p.id);
    this.order = this.order.filter((q) => q !== p);
  }

  private destroy(): void {
    this.stopped = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate);
    this.scene.input.off('pointerdown', this.onPointer);
    this.scene.input.keyboard?.off('keydown-SPACE', this.onKey);
    this.scene.input.keyboard?.off('keydown-ENTER', this.onKey);
    [...this.order].forEach((p) => p.maskG.destroy());
  }
}

export type { PanelCam };
