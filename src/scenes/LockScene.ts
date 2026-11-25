import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { LockModel, LockSpec } from '../data/explore';
import { Expedition } from '../explore/Expedition';
import { uiButton, uiPanel } from '../explore/ui';
import { GameState } from '../state/GameState';
import { rumble } from '../feel/Haptics';
import { pixelText } from '../utils/text';

export interface LockData {
  spec: LockSpec;
  zone: string;
  /** 寬容度（隊伍膽識）：時間更多、判定更寬 */
  ease: number;
  onDone: (ok: boolean) => void;
}

const PX = 40;
const PY = 24;
const PW = GAME_WIDTH - 80;
const PH = GAME_HEIGHT - 48;

const MODEL_NAME: Record<LockModel, string> = { padlock: '掛鎖', door: '門鎖', cabinet: '櫃鎖', safe: '保險箱鎖', fusebox: '電箱' };
/** 失誤幾次（撥片斷掉）就失敗 */
const MAX_MISTAKES = 3;
const MISTAKE_NOISE = 4;

// ── 鎖芯剖面的尺寸（邏輯像素） ──
/** 剖面左右 */
const LX0 = 128;
const LX1 = 452;
/** 外殼頂 */
const TOP = 92;
/** 剪切線（外殼與鎖膽的交界）：下彈子頂端剛好停在這裡，鎖膽才轉得動 */
const SHEAR = 172;
/** 鎖膽底、鑰匙槽 */
const PLUG_BOTTOM = 238;
const KEYWAY_TOP = 214;
const KEYWAY_BOTTOM = 230;
const HOUSING_BOTTOM = 254;
const DRIVER_LEN = 24;
const PIN_W = 14;

interface Pin {
  x: number;
  /** 下彈子（鑰匙彈子）長度：每根不一樣，要推的高度也不一樣 */
  keyLen: number;
  /** 往上推的速度（彈簧軟硬） */
  speed: number;
  /** 目前推高了多少 */
  lift: number;
  set: boolean;
  /** 放開後掉回去的動畫 */
  falling: boolean;
}

/**
 * 開鎖小遊戲：看得到內部結構的彈子鎖芯剖面（簡化版）。
 *
 * 真實的彈子鎖：每個孔裡有上下兩截彈子，上面壓著彈簧。下彈子長短不一，
 * 要把每一根推到「兩截的接縫剛好對齊剪切線」，扳手的張力會把上彈子卡在外殼裡，鎖膽就能轉。
 *
 * 操作：←→ 選彈子，按住空白鍵（或按住那根彈子）往上推，接縫對到金色剪切線時放開就卡住。
 * 太早放開沒關係，彈子掉回去再推一次；推過頭會讓扳手一滑、上一根卡住的掉回去，記一次失誤。
 * 每根彈子長短、彈簧軟硬不同，推的高度和速度都要重新抓。
 */
export class LockScene extends Phaser.Scene {
  private d!: LockData;
  private done = false;
  private won = false;
  private mistakes = 0;
  private timeLeft = 0;
  private totalTime = 1;
  private assisted = false;
  private pins: Pin[] = [];
  private sel = 0;
  private holding = false;
  private band = 4;
  private speedMul = 1;
  private pickX = 0;
  /** 鎖膽轉的角度（張力：每卡一根多轉一點，全開時轉到底） */
  private turn = 0;
  /** 剛進到判定帶時的提示閃光 */
  private glint = 0;
  private wasInBand = false;
  private g!: Phaser.GameObjects.Graphics;
  private front!: Phaser.GameObjects.Graphics;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private missText!: Phaser.GameObjects.Text;
  private tip!: Phaser.GameObjects.Text;
  private footer: Phaser.GameObjects.GameObject[] = [];
  private keys!: Record<'left' | 'right' | 'a' | 'd' | 'space' | 'up' | 'w', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('Lock');
  }

  init(d: LockData): void {
    this.d = d;
    this.done = false;
    this.won = false;
    this.mistakes = 0;
    this.assisted = false;
    this.holding = false;
    this.footer = [];
    this.turn = 0;
    this.glint = 0;
    this.wasInBand = false;
    const { tier } = d.spec;
    const n = tier + 2;
    const gap = Math.min(60, (LX1 - LX0 - 80) / (n - 1));
    const x0 = (LX0 + LX1) / 2 - ((n - 1) * gap) / 2 + 16;
    const lens = Phaser.Utils.Array.Shuffle([14, 20, 26, 32, 18, 28, 22]).slice(0, n);
    this.pins = lens.map((keyLen, i) => ({
      x: Math.round(x0 + i * gap),
      keyLen,
      // 越難彈簧越硬（推得快、比較難停準）
      speed: Phaser.Math.Between(26, 38) + tier * 6,
      lift: 0,
      set: false,
      falling: false,
    }));
    this.sel = 0;
    this.pickX = this.pins[0].x;
    // 判定帶：接縫離剪切線幾像素以內算對準
    this.band = (tier === 1 ? 4.5 : tier === 2 ? 3.5 : 3) * d.ease;
    this.speedMul = 1;
    this.totalTime = (24 + n * 6) * d.ease;
  }

  create(): void {
    const { spec } = this.d;
    const touch = this.sys.game.device.input.touch;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllKeys(true);
      this.input.keyboard?.removeAllListeners();
    });
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0);
    uiPanel(this, PX, PY, PW, PH);
    pixelText(this, PX + 14, PY + 10, `開鎖：${MODEL_NAME[spec.model]}`, 11, '#f5d76e');
    pixelText(this, PX + 14, PY + 28, spec.prompt, 8, '#e0e0e0');
    this.tip = pixelText(this, PX + 14, PY + 41, '', 7, '#90a4ae');
    this.tip.setText(touch ? '按住一根彈子往上推，接縫對到金線時放手' : '←→ 選彈子，按住空白鍵往上推，接縫對到金線時放開');
    this.missText = pixelText(this, PX + PW - 14, PY + 12, '', 8, '#ff8a80').setOrigin(1, 0);
    this.add.rectangle(PX + 14, PY + 54, PW - 28, 4, 0x000000).setOrigin(0).setDepth(100);
    this.timerBar = this.add.rectangle(PX + 15, PY + 55, PW - 30, 2, 0xf5d76e).setOrigin(0).setDepth(101);
    this.g = this.add.graphics().setDepth(100);
    this.front = this.add.graphics().setDepth(100);
    // 剖面上的標示
    pixelText(this, LX1 + 6, SHEAR - 4, '◀ 剪切線', 7, '#f5d76e').setDepth(101);
    pixelText(this, LX1 + 6, TOP + 30, '外殼', 7, '#8a7a5a').setDepth(101);
    pixelText(this, LX1 + 6, SHEAR + 18, '鎖膽', 7, '#8a7a5a').setDepth(101);
    this.timeLeft = this.totalTime;
    this.refreshMistakes();
    this.bindInput();
    this.drawFooter();
    this.draw();
  }

  // ── 輸入 ──

  private bindInput(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      a: kb.addKey(K.A),
      d: kb.addKey(K.D),
      space: kb.addKey(K.SPACE),
      up: kb.addKey(K.UP),
      w: kb.addKey(K.W),
    };
    const step = (dir: number) => {
      if (this.done || this.holding) return;
      // 跳過已經卡住的
      for (let k = 1; k <= this.pins.length; k++) {
        const i = (this.sel + dir * k + this.pins.length * 2) % this.pins.length;
        if (!this.pins[i].set) {
          this.sel = i;
          AudioManager.ui('tap');
          return;
        }
      }
    };
    kb.on('keydown-LEFT', () => step(-1));
    kb.on('keydown-A', () => step(-1));
    kb.on('keydown-RIGHT', () => step(1));
    kb.on('keydown-D', () => step(1));
    // 觸控／滑鼠：按住某一根彈子就選它並往上推
    const zone = this.add.zone(LX0, TOP - 10, LX1 - LX0, HOUSING_BOTTOM - TOP + 20).setOrigin(0).setDepth(105).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.done) return;
      const x = p.worldX;
      let best = -1;
      let bd = 1e9;
      this.pins.forEach((pin, i) => {
        const dd = Math.abs(pin.x - x);
        if (!pin.set && dd < bd) {
          bd = dd;
          best = i;
        }
      });
      if (best >= 0 && bd < 40) {
        if (best !== this.sel) this.pins[this.sel].lift = 0;
        this.sel = best;
        this.pointerHold = true;
      }
    });
    this.input.on('pointerup', () => (this.pointerHold = false));
    this.input.on('gameout', () => (this.pointerHold = false));
  }

  private pointerHold = false;

  // ── 主迴圈 ──

  update(_t: number, ms: number): void {
    const dt = Math.min(0.05, ms / 1000);
    this.glint = Math.max(0, this.glint - dt * 3);
    if (!this.done) {
      this.timeLeft -= dt;
      this.timerBar.width = (PW - 30) * Math.max(0, this.timeLeft / this.totalTime);
      if (this.timeLeft < 6) this.timerBar.setFillStyle(Math.floor(this.timeLeft * 4) % 2 ? 0xff6b6b : 0xf5d76e);
      if (this.timeLeft <= 0) this.finish(false);
      this.stepPins(dt);
    }
    // 撥片跟著選中的彈子移動
    this.pickX += (this.pins[this.sel].x - this.pickX) * Math.min(1, dt * 14);
    this.draw();
  }

  private stepPins(dt: number): void {
    const K = this.keys;
    const hold = this.pointerHold || K.space.isDown || K.up.isDown || K.w.isDown;
    const p = this.pins[this.sel];
    // 放開：在判定帶裡就卡住，否則掉回去
    if (this.holding && !hold) {
      this.holding = false;
      if (!p.set && p.lift > 0) {
        if (Math.abs(this.gapOf(p) - SHEAR) <= this.band) this.setPin(p);
        else {
          p.falling = true;
          AudioManager.play('shell_drop');
        }
      }
    }
    if (hold && !p.set && !p.falling) {
      this.holding = true;
      p.lift += p.speed * this.speedMul * dt;
      const inBand = Math.abs(this.gapOf(p) - SHEAR) <= this.band;
      if (inBand && !this.wasInBand) {
        // 對準的瞬間：輕輕一聲、震一下、亮一下
        this.glint = 1;
        AudioManager.ui('tap');
        rumble(25, 0.3);
      }
      this.wasInBand = inBand;
      // 推過頭：下彈子頂進外殼，扳手一滑
      if (this.gapOf(p) < SHEAR - this.band - 7) this.overset(p);
    } else this.wasInBand = false;
    // 掉回去的彈子（彈簧壓回來）
    // 卡住的那根：上彈子留在外殼裡，下彈子自己掉回鑰匙槽
    for (const q of this.pins) {
      if (q === p && this.holding && !q.set && !q.falling) continue;
      if (q.lift > 0) q.lift = Math.max(0, q.lift - 140 * dt);
      if (q.lift <= 0) q.falling = false;
    }
  }

  /** 上下彈子的接縫（下彈子頂端）y */
  private gapOf(p: Pin): number {
    return KEYWAY_TOP - p.keyLen - p.lift;
  }

  private setPin(p: Pin): void {
    p.set = true;
    p.falling = false;
    this.turn += 3;
    AudioManager.play('clip_insert');
    rumble(50, 0.5);
    this.cameras.main.shake(60, 0.002);
    if (this.pins.every((q) => q.set)) return this.finish(true);
    // 自動換到下一根還沒卡住的
    const next = this.pins.findIndex((q, i) => !q.set && i > this.sel);
    this.sel = next >= 0 ? next : this.pins.findIndex((q) => !q.set);
  }

  /** 推過頭：這根掉回去，扳手一滑、最後卡住的那根也掉下來 */
  private overset(p: Pin): void {
    p.falling = true;
    this.holding = false;
    this.pointerHold = false;
    const setOnes = this.pins.filter((q) => q.set);
    const drop = setOnes[setOnes.length - 1];
    if (drop) {
      drop.set = false;
      drop.lift = KEYWAY_TOP - drop.keyLen - SHEAR;
      drop.falling = true;
      this.turn = Math.max(0, this.turn - 3);
    }
    this.tip.setText(drop ? '推過頭了！扳手一滑，有一根掉回去了' : '推過頭了！慢一點，看接縫').setColor('#ff8a80');
    this.mistakes++;
    this.refreshMistakes();
    AudioManager.play('dry_fire');
    rumble(90, 0.6);
    this.cameras.main.shake(140, 0.006);
    const exp = Expedition.current;
    if (exp) exp.noise = Math.min(100, exp.noise + MISTAKE_NOISE);
    if (this.mistakes >= MAX_MISTAKES) this.finish(false);
  }

  // ── 畫面 ──

  private draw(): void {
    const g = this.g;
    g.clear();
    const brass = 0xb8923e;
    const brassD = 0x8a6a2a;
    const brassL = 0xd8b45a;
    const plug = 0xc8a24a;
    const won = this.won;
    // 外殼（上）
    g.fillStyle(0x120f0d, 1).fillRect(LX0 - 2, TOP - 2, LX1 - LX0 + 4, HOUSING_BOTTOM - TOP + 4);
    g.fillStyle(brass, 1).fillRect(LX0, TOP, LX1 - LX0, SHEAR - TOP);
    g.fillStyle(brassL, 1).fillRect(LX0, TOP, LX1 - LX0, 2);
    // 外殼（下）
    g.fillStyle(brass, 1).fillRect(LX0, PLUG_BOTTOM, LX1 - LX0, HOUSING_BOTTOM - PLUG_BOTTOM);
    // 鎖膽：開了就往旁邊轉一點（剖面上看起來是整塊錯開）
    const plugDy = won ? 3 : 0;
    g.fillStyle(0x120f0d, 1).fillRect(LX0, SHEAR - 1 + plugDy, LX1 - LX0, PLUG_BOTTOM - SHEAR + 2);
    g.fillStyle(plug, 1).fillRect(LX0, SHEAR + plugDy, LX1 - LX0, PLUG_BOTTOM - SHEAR);
    g.fillStyle(0xe8c86a, 1).fillRect(LX0, SHEAR + plugDy, LX1 - LX0, 2);
    // 鑰匙槽
    g.fillStyle(0x1a1410, 1).fillRect(LX0, KEYWAY_TOP + plugDy, LX1 - LX0 - 24, KEYWAY_BOTTOM - KEYWAY_TOP);
    // 螺絲、紋路
    for (const x of [LX0 + 10, LX1 - 12]) {
      g.fillStyle(brassD, 1).fillCircle(x, TOP + 10, 4);
      g.fillStyle(brassL, 1).fillRect(x - 3, TOP + 9, 6, 1);
    }
    // 剪切線
    const glow = this.glint;
    g.fillStyle(0xf5d76e, 0.25 + glow * 0.4).fillRect(LX0, SHEAR - this.band, LX1 - LX0, this.band * 2);
    g.fillStyle(0xffe58a, 1).fillRect(LX0, SHEAR, LX1 - LX0, 1);

    this.pins.forEach((p, i) => {
      const x = p.x;
      const selected = i === this.sel && !this.done;
      // 孔
      g.fillStyle(0x2a2016, 1).fillRect(x - PIN_W / 2 - 2, TOP + 10, PIN_W + 4, KEYWAY_TOP - TOP - 10 + plugDy);
      const gap = this.gapOf(p);
      // 上彈子（卡住的停在剪切線上面）
      const dBottom = p.set ? SHEAR : gap;
      const dTop = dBottom - DRIVER_LEN;
      // 彈簧：從孔頂壓到上彈子
      const sTop = TOP + 12;
      const coils = 7;
      const h = Math.max(4, dTop - sTop);
      g.lineStyle(1, 0xc8ccd4, 1);
      for (let k = 0; k < coils; k++) {
        const y0 = sTop + (h * k) / coils;
        const y1 = sTop + (h * (k + 0.5)) / coils;
        const y2 = sTop + (h * (k + 1)) / coils;
        g.lineBetween(x - 5, y0, x + 5, y1);
        g.lineBetween(x + 5, y1, x - 5, y2);
      }
      g.fillStyle(0x120f0d, 1).fillRect(x - PIN_W / 2 - 1, dTop - 1, PIN_W + 2, DRIVER_LEN + 2);
      g.fillStyle(p.set ? 0x9ad17a : 0xb8bcc4, 1).fillRect(x - PIN_W / 2, dTop, PIN_W, DRIVER_LEN);
      g.fillStyle(0xffffff, 0.35).fillRect(x - PIN_W / 2, dTop, 3, DRIVER_LEN);
      // 下彈子（鑰匙彈子，尖頭朝下）
      const kTop = p.set ? KEYWAY_TOP - p.keyLen - p.lift : gap;
      const kLen = p.keyLen;
      const kc = selected ? 0xffd24a : 0xd8a838;
      g.fillStyle(0x120f0d, 1).fillRect(x - PIN_W / 2 - 1, kTop - 1, PIN_W + 2, kLen - 2);
      g.fillStyle(kc, 1).fillRect(x - PIN_W / 2, kTop, PIN_W, kLen - 4);
      g.fillStyle(0x120f0d, 1).fillTriangle(x - PIN_W / 2 - 1, kTop + kLen - 5, x + PIN_W / 2 + 1, kTop + kLen - 5, x, kTop + kLen + 1);
      g.fillStyle(kc, 1).fillTriangle(x - PIN_W / 2, kTop + kLen - 5, x + PIN_W / 2, kTop + kLen - 5, x, kTop + kLen - 1);
      g.fillStyle(0xffffff, 0.3).fillRect(x - PIN_W / 2, kTop, 3, kLen - 5);
      // 接縫：越接近剪切線越亮
      if (!p.set) {
        const off = Math.abs(gap - SHEAR);
        const near = Phaser.Math.Clamp(1 - off / 26, 0, 1);
        const inBand = off <= this.band;
        g.fillStyle(inBand ? 0xffffff : 0xf5d76e, inBand ? 1 : near * 0.9).fillRect(x - PIN_W / 2 - 3, gap - 1, PIN_W + 6, 2);
      }
      // 選中的箭頭
      if (selected) g.fillStyle(0xffd24a, 1).fillTriangle(x - 5, HOUSING_BOTTOM + 14, x + 5, HOUSING_BOTTOM + 14, x, HOUSING_BOTTOM + 6);
    });

    // 張力扳手（鑰匙槽口下緣，L 形）
    const wy = KEYWAY_BOTTOM - 3 + plugDy;
    g.fillStyle(0x120f0d, 1).fillRect(LX0 - 40, wy - 1, 52, 5);
    g.fillStyle(0x6a707a, 1).fillRect(LX0 - 39, wy, 50, 3);
    const ang = Phaser.Math.DegToRad(this.turn * 1.4 + (won ? 25 : 0));
    g.lineStyle(4, 0x6a707a, 1).lineBetween(LX0 - 38, wy + 1, LX0 - 38 - Math.sin(ang) * 30, wy + 1 + Math.cos(ang) * 30);
    // 撥片：從左邊伸進鑰匙槽，前端勾在選中的彈子底下
    const sp = this.pins[this.sel];
    const tipY = sp.set ? KEYWAY_TOP + 2 : Math.min(KEYWAY_BOTTOM - 4, KEYWAY_TOP - sp.lift + 2);
    const baseY = KEYWAY_BOTTOM - 5 + plugDy;
    g.lineStyle(3, 0x120f0d, 1).lineBetween(LX0 - 60, baseY - 6, this.pickX - 6, baseY);
    g.lineStyle(2, 0xd8dce4, 1).lineBetween(LX0 - 60, baseY - 6, this.pickX - 6, baseY);
    g.lineStyle(2, 0xd8dce4, 1).lineBetween(this.pickX - 6, baseY, this.pickX, tipY);
    // 撥片的握柄
    g.fillStyle(0x120f0d, 1).fillRect(LX0 - 79, baseY - 11, 24, 9);
    g.fillStyle(0x7a3a2a, 1).fillRect(LX0 - 78, baseY - 10, 22, 7);

    this.drawFront();
  }

  /** 右邊：鎖的正面（鑰匙孔跟著張力轉，開了就轉到底） */
  private drawFront(): void {
    const g = this.front;
    g.clear();
    const cx = 540;
    const cy = 170;
    const model = this.d.spec.model;
    const won = this.won;
    if (model === 'padlock') {
      const up = won ? 10 : 0;
      g.lineStyle(7, 0x120f0d, 1).beginPath().arc(cx, cy - 24 - up, 20, Math.PI, 0).strokePath();
      g.lineStyle(5, 0xb0b4bc, 1).beginPath().arc(cx, cy - 24 - up, 20, Math.PI, 0).strokePath();
      g.fillStyle(0x120f0d, 1).fillRect(cx - 22, cy - 26 - up, 5, 10).fillRect(cx + 17, cy - 26, 5, 10);
      g.fillStyle(0xb0b4bc, 1).fillRect(cx - 21, cy - 26 - up, 3, 10).fillRect(cx + 18, cy - 26, 3, 10);
      g.fillStyle(0x120f0d, 1).fillRoundedRect(cx - 30, cy - 18, 60, 56, 6);
      g.fillStyle(0xc8a040, 1).fillRoundedRect(cx - 28, cy - 16, 56, 52, 5);
      g.fillStyle(0xe0c060, 1).fillRect(cx - 24, cy - 14, 48, 3);
    } else if (model === 'door') {
      g.fillStyle(0x5a3e28, 1).fillRect(cx - 40, cy - 70, 80, 140);
      g.fillStyle(0x120f0d, 1).fillCircle(cx, cy + 10, 26);
      g.fillStyle(0xb0b4bc, 1).fillCircle(cx, cy + 10, 24);
      g.fillStyle(0xd8dce4, 1).fillCircle(cx - 6, cy + 4, 8);
    } else if (model === 'cabinet') {
      g.fillStyle(0x120f0d, 1).fillRect(cx - 40, cy - 60, 80, 124);
      g.fillStyle(0x5a6470, 1).fillRect(cx - 38, cy - 58, 76, 120);
      for (let y = cy - 50; y < cy - 20; y += 5) g.fillStyle(0x3a424c, 1).fillRect(cx - 30, y, 60, 2);
      g.fillStyle(0x120f0d, 1).fillCircle(cx, cy + 10, 16);
      g.fillStyle(0xb0b4bc, 1).fillCircle(cx, cy + 10, 14);
    } else {
      g.fillStyle(0x120f0d, 1).fillRect(cx - 44, cy - 60, 88, 124);
      g.fillStyle(0x3a4048, 1).fillRect(cx - 42, cy - 58, 84, 120);
      g.fillStyle(0x2a2e34, 1).fillCircle(cx, cy - 22, 20);
      g.fillStyle(0x6a707a, 1).fillCircle(cx, cy - 22, 5);
      g.fillStyle(0x120f0d, 1).fillCircle(cx, cy + 26, 13);
      g.fillStyle(0xb0b4bc, 1).fillCircle(cx, cy + 26, 11);
    }
    // 鑰匙孔（跟著張力轉）
    const ky = model === 'padlock' ? cy + 12 : model === 'safe' ? cy + 26 : cy + 10;
    const a = Phaser.Math.DegToRad(this.turn * 1.4 + (won ? 80 : 0));
    const rotP = (dx: number, dy: number) => ({ x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: ky + dx * Math.sin(a) + dy * Math.cos(a) });
    const c = rotP(0, -3);
    g.fillStyle(0x120f0d, 1).fillCircle(c.x, c.y, 3);
    const p1 = rotP(-2, -2);
    const p2 = rotP(2, -2);
    const p3 = rotP(3, 6);
    const p4 = rotP(-3, 6);
    g.fillTriangle(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y).fillTriangle(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y);
    // 進度：卡住幾根
    const n = this.pins.length;
    const setN = this.pins.filter((p) => p.set).length;
    for (let i = 0; i < n; i++) {
      const x = cx - ((n - 1) * 10) / 2 + i * 10;
      g.fillStyle(i < setN ? 0x9ad17a : 0x3a3f4a, 1).fillCircle(x, 258, 3);
    }
  }

  // ── 共用 ──

  private drawFooter(): void {
    for (const o of this.footer) o.destroy();
    const have = GameState.data.supplies.lockpick;
    const y = PY + PH - 38;
    const can = !this.assisted && have > 0 && !this.done;
    this.footer = [
      ...uiButton(this, PX + 14, y, 220, 26, this.assisted ? '已用開鎖工具輔助' : `用開鎖工具輔助（剩 ${have}）`, () => this.useTool(), {
        enabled: can,
        sub: this.assisted ? '' : have > 0 ? '判定變寬、彈簧變軟' : '沒有開鎖工具',
      }),
      ...uiButton(this, PX + PW - 134, y, 120, 26, '放棄', () => this.finish(false), { fill: 0x3a3f4a, enabled: !this.done }),
    ];
  }

  private useTool(): void {
    if (this.assisted || this.done || !GameState.useSupply('lockpick')) return;
    this.assisted = true;
    this.band *= 1.8;
    this.speedMul = 0.65;
    this.timeLeft = Math.min(this.totalTime, this.timeLeft + 8);
    AudioManager.ui('confirm');
    this.drawFooter();
  }

  private refreshMistakes(): void {
    this.missText.setText(`失誤 ${'●'.repeat(this.mistakes)}${'○'.repeat(MAX_MISTAKES - this.mistakes)}`);
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    this.won = ok;
    this.holding = false;
    this.pointerHold = false;
    this.drawFooter();
    AudioManager.play(ok ? 'bolt' : 'dry_fire');
    if (ok) this.time.delayedCall(180, () => AudioManager.play('stinger_win'));
    else AudioManager.play('player_hurt');
    const t = pixelText(this, (LX0 + LX1) / 2, TOP - 14, ok ? '喀嚓！鎖開了' : '撥片斷了……', 16, ok ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setStroke('#000000', 5);
    t.setDepth(130).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.time.delayedCall(1100, () => {
      const cb = this.d.onDone;
      this.scene.stop();
      cb(ok);
    });
  }
}
