import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { LockKind, LockSpec } from '../data/explore';
import { Expedition } from '../explore/Expedition';
import { uiButton, uiPanel } from '../explore/ui';
import { GameState } from '../state/GameState';
import { rumble } from '../feel/Haptics';
import { pixelText } from '../utils/text';

export interface LockData {
  spec: LockSpec;
  /** 這次抽到的開鎖方式 */
  kind: LockKind;
  zone: string;
  /** 寬容度（隊伍膽識）：時間更多、判定更寬 */
  ease: number;
  onDone: (ok: boolean) => void;
}

const PX = 40;
const PY = 24;
const PW = GAME_WIDTH - 80;
const PH = GAME_HEIGHT - 48;
/** 內容區 */
const BX = PX + 14;
const BY = PY + 62;
const BW = PW - 28;
const BH = 196;

const KIND_NAME: Record<LockKind, string> = { dial: '密碼轉盤', pins: '彈子鎖', wires: '電箱接線' };
const KIND_HELP: Record<LockKind, { pc: string; touch: string }> = {
  pins: { pc: '彈子跑到金線時按空白鍵／點擊，把它卡住', touch: '彈子跑到金線時點一下，把它卡住' },
  dial: { pc: '點房間裡的東西找線索；←→ 選位數、↑↓ 轉、Enter 試開', touch: '點房間裡的東西找線索，再轉右邊的轉盤、按「轉開」' },
  wires: { pc: '點接頭旋轉，把電從左邊的電池接到右邊的鎖', touch: '點接頭旋轉，把電從左邊的電池接到右邊的鎖' },
};
/** 失誤幾次就失敗 */
const MAX_MISTAKES = 3;
/** 每次失誤加多少噪音 */
const MISTAKE_NOISE = 4;

// 電箱接線：上右下左的連接位元
const N = 1;
const E = 2;
const S = 4;
const Wb = 8;
const rot = (m: number) => ((m << 1) | (m >> 3)) & 15;

/**
 * 開鎖小遊戲（疊在探索畫面上），三種輪替：
 * - 密碼轉盤：線索藏在房間裡（便利貼、月曆、相框…），點開找到每一位數字再轉開
 * - 彈子鎖：彈子上下跳，跑到金線時按下把它卡住，一根一根推完
 * - 電箱接線：旋轉接頭，把電從左邊接到右邊
 * 失誤會弄出聲響（噪音）；失誤 3 次或時間到就失敗。帶著開鎖工具可以花一個讓這次變簡單。
 */
export class LockScene extends Phaser.Scene {
  private d!: LockData;
  private done = false;
  private mistakes = 0;
  private timeLeft = 0;
  private totalTime = 1;
  private assisted = false;
  private timerBar!: Phaser.GameObjects.Rectangle;
  private missText!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Container;
  private footer: Phaser.GameObjects.GameObject[] = [];
  private tick: (dt: number) => void = () => {};
  /** 輔助：每種玩法自己決定怎麼變簡單 */
  private assist: () => void = () => {};

  constructor() {
    super('Lock');
  }

  init(d: LockData): void {
    this.d = d;
    this.done = false;
    this.mistakes = 0;
    this.assisted = false;
    this.tick = () => {};
    this.assist = () => {};
    this.footer = [];
  }

  create(): void {
    const { spec, kind } = this.d;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.removeAllListeners());
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0);
    uiPanel(this, PX, PY, PW, PH);
    pixelText(this, PX + 14, PY + 10, `開鎖：${KIND_NAME[kind]}`, 11, '#f5d76e');
    pixelText(this, PX + 14, PY + 28, spec.prompt, 8, '#e0e0e0');
    const touch = this.sys.game.device.input.touch;
    pixelText(this, PX + 14, PY + 41, KIND_HELP[kind][touch ? 'touch' : 'pc'], 7, '#90a4ae');
    this.missText = pixelText(this, PX + PW - 14, PY + 12, '', 8, '#ff8a80').setOrigin(1, 0);
    this.add.rectangle(BX, PY + 54, BW, 4, 0x000000).setOrigin(0).setDepth(100);
    this.timerBar = this.add.rectangle(BX + 1, PY + 55, BW - 2, 2, 0xf5d76e).setOrigin(0).setDepth(101);
    this.body = this.add.container(0, 0).setDepth(100);
    this.refreshMistakes();
    if (kind === 'pins') this.setupPins();
    else if (kind === 'dial') this.setupDial();
    else this.setupWires();
    this.timeLeft = this.totalTime;
    this.drawFooter();
  }

  update(_t: number, ms: number): void {
    if (this.done) return;
    const dt = Math.min(0.05, ms / 1000);
    this.tick(dt);
    this.timeLeft -= dt;
    this.timerBar.width = (BW - 2) * Math.max(0, this.timeLeft / this.totalTime);
    if (this.timeLeft < 5) this.timerBar.setFillStyle(Math.floor(this.timeLeft * 4) % 2 ? 0xff6b6b : 0xf5d76e);
    if (this.timeLeft <= 0) this.finish(false);
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
        sub: this.assisted ? '' : have > 0 ? '這次變簡單' : '沒有開鎖工具',
      }),
      ...uiButton(this, PX + PW - 134, y, 120, 26, '放棄', () => this.finish(false), { fill: 0x3a3f4a, enabled: !this.done }),
    ];
  }

  private useTool(): void {
    if (this.assisted || this.done || !GameState.useSupply('lockpick')) return;
    this.assisted = true;
    this.timeLeft = Math.min(this.totalTime, this.timeLeft + 8);
    AudioManager.ui('confirm');
    this.assist();
    this.drawFooter();
  }

  private refreshMistakes(): void {
    this.missText.setText(`失誤 ${'●'.repeat(this.mistakes)}${'○'.repeat(MAX_MISTAKES - this.mistakes)}`);
  }

  /** 失誤：吵、晃、記一次；滿了就失敗 */
  private mistake(): void {
    this.mistakes++;
    this.refreshMistakes();
    AudioManager.play('dry_fire');
    rumble(80, 0.6);
    this.cameras.main.shake(140, 0.007);
    const exp = Expedition.current;
    if (exp) exp.noise = Math.min(100, exp.noise + MISTAKE_NOISE);
    if (this.mistakes >= MAX_MISTAKES) this.finish(false);
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    this.drawFooter();
    AudioManager.play(ok ? 'stinger_win' : 'player_hurt');
    const t = pixelText(this, GAME_WIDTH / 2, BY + BH / 2, ok ? '喀！鎖開了' : '打不開……', 18, ok ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setStroke('#000000', 5);
    t.setDepth(130).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.time.delayedCall(900, () => {
      const cb = this.d.onDone;
      this.scene.stop();
      cb(ok);
    });
  }

  /** 空白鍵、Enter、點空白處都算按下 */
  private onPress(fn: () => void): void {
    this.input.keyboard?.on('keydown-SPACE', fn);
    this.input.keyboard?.on('keydown-ENTER', fn);
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) fn();
    });
  }

  // ── 彈子鎖 ──

  private setupPins(): void {
    const { spec, ease } = this.d;
    const n = spec.tier + 2;
    this.totalTime = (10 + n * 3) * ease;
    const g = this.add.graphics().setDepth(100);
    this.body.add(g);
    const cx = GAME_WIDTH / 2;
    const gap = 56;
    const x0 = cx - ((n - 1) * gap) / 2;
    const top = BY + 14;
    const shear = BY + 78;
    const bottom = BY + BH - 20;
    let band = 6 * ease;
    let speedMul = 1;
    const pins = Array.from({ length: n }, (_, i) => ({
      x: x0 + i * gap,
      phase: Math.random() * Math.PI * 2,
      speed: 2.6 + Math.random() * 1.6 + spec.tier * 0.5,
      set: false,
      y: shear,
    }));
    let at = 0;
    let t = 0;
    let flash = 0;
    // 彈子的頂端在 shear ± amp 之間跳
    const amp = 46;
    const topOf = (p: (typeof pins)[number]) => (p.set ? shear : shear + Math.sin(p.phase + t * p.speed * speedMul) * amp);
    this.assist = () => {
      band *= 1.8;
      speedMul = 0.65;
    };
    const draw = () => {
      g.clear();
      // 鎖芯外殼
      g.fillStyle(0x2a2620, 1).fillRect(x0 - 40, top, (n - 1) * gap + 80, bottom - top);
      g.fillStyle(0x4a4236, 1).fillRect(x0 - 38, top + 2, (n - 1) * gap + 76, bottom - top - 4);
      g.fillStyle(0x6a5a40, 1).fillRect(x0 - 38, shear, (n - 1) * gap + 76, bottom - shear - 2);
      // 判定帶
      g.fillStyle(0xf5d76e, 0.18).fillRect(x0 - 38, shear - band, (n - 1) * gap + 76, band * 2);
      g.fillStyle(0xf5d76e, 1).fillRect(x0 - 38, shear, (n - 1) * gap + 76, 1);
      pins.forEach((p, i) => {
        const y = topOf(p);
        p.y = y;
        // 彈簧
        g.lineStyle(1, 0x9aa0a8, 0.8);
        for (let k = top + 4; k < y - 26; k += 4) g.lineBetween(p.x - 6, k, p.x + 6, k + 2);
        // 上彈子（驅動）＋下彈子
        const col = p.set ? 0x9ad17a : i === at ? 0xffd24a : 0xc8a040;
        g.fillStyle(0x120f0d, 1).fillRect(p.x - 9, y - 27, 18, 28);
        g.fillStyle(col, 1).fillRect(p.x - 8, y - 26, 16, 26);
        g.fillStyle(0xffffff, 0.25).fillRect(p.x - 8, y - 26, 4, 26);
        g.fillStyle(0x120f0d, 1).fillRect(p.x - 7, y + 1, 14, 30);
        g.fillStyle(0xb0b4bc, 1).fillRect(p.x - 6, y + 2, 12, 28);
        if (i === at && !p.set) {
          g.fillStyle(0xffd24a, 1).fillTriangle(p.x - 6, bottom + 12, p.x + 6, bottom + 12, p.x, bottom + 4);
        }
      });
      // 開鎖工具：從左邊伸到目前這根下面
      const cur = pins[Math.min(at, n - 1)];
      g.lineStyle(2, 0xd8d8e0, 1).lineBetween(PX + 30, bottom - 8, cur.x, bottom - 8);
      g.lineBetween(cur.x, bottom - 8, cur.x + 2, bottom - 14);
      if (flash > 0) g.fillStyle(0xffffff, flash).fillRect(x0 - 38, shear - 2, (n - 1) * gap + 76, 4);
    };
    this.tick = (dt) => {
      t += dt;
      flash = Math.max(0, flash - dt * 3);
      draw();
    };
    this.onPress(() => {
      if (this.done || at >= n) return;
      const p = pins[at];
      if (Math.abs(topOf(p) - shear) <= band) {
        p.set = true;
        at++;
        flash = 0.8;
        AudioManager.ui('confirm');
        if (at >= n) this.finish(true);
      } else {
        // 推歪了：上一根也掉回去
        if (at > 0) {
          at--;
          pins[at].set = false;
        }
        this.mistake();
      }
    });
    draw();
  }

  // ── 密碼轉盤 ──

  private setupDial(): void {
    const { spec, ease } = this.d;
    const n = spec.tier >= 3 ? 4 : 3;
    this.totalTime = (34 + n * 6) * ease;
    const code = Array.from({ length: n }, () => Phaser.Math.Between(0, 9));
    // 房間（左半）：幾樣東西，其中 n 樣藏著某一位數字
    const rx = BX;
    const ry = BY;
    const rw = 300;
    const rh = BH;
    const g = this.add.graphics().setDepth(100);
    this.body.add(g);
    g.fillStyle(0x2c2a2e, 1).fillRect(rx, ry, rw, rh);
    g.fillStyle(0x3a3640, 1).fillRect(rx, ry, rw, rh - 50);
    for (let x = rx + 8; x < rx + rw; x += 26) g.fillStyle(0x34303a, 1).fillRect(x, ry, 1, rh - 50);
    g.fillStyle(0x24201c, 1).fillRect(rx, ry + rh - 50, rw, 50);
    g.fillStyle(0x120f0d, 1).fillRect(rx, ry + rh - 50, rw, 1);
    // 桌子
    g.fillStyle(0x5a3e28, 1).fillRect(rx + 120, ry + rh - 78, 150, 8);
    g.fillStyle(0x3a281a, 1).fillRect(rx + 126, ry + rh - 70, 6, 40).fillRect(rx + 258, ry + rh - 70, 6, 40);
    // 保險箱（右下角）
    g.fillStyle(0x120f0d, 1).fillRect(rx + 20, ry + rh - 92, 70, 62);
    g.fillStyle(0x4a5058, 1).fillRect(rx + 22, ry + rh - 90, 66, 58);
    g.fillStyle(0x2a2e34, 1).fillCircle(rx + 55, ry + rh - 61, 14);
    g.fillStyle(0x9aa0a8, 1).fillCircle(rx + 55, ry + rh - 61, 4);
    type Spot = { name: string; x: number; y: number; w: number; h: number; color: number; draw?: (gg: Phaser.GameObjects.Graphics) => void };
    const spots: Spot[] = [
      { name: '月曆', x: rx + 16, y: ry + 14, w: 44, h: 50, color: 0xe8e0d0 },
      { name: '相框', x: rx + 84, y: ry + 20, w: 36, h: 30, color: 0x8a6a3a },
      { name: '便利貼', x: rx + 150, y: ry + rh - 96, w: 16, h: 16, color: 0xf5e08a },
      { name: '牆上的刮痕', x: rx + 220, y: ry + 26, w: 50, h: 26, color: 0x4a4650 },
      { name: '檯燈', x: rx + 230, y: ry + rh - 108, w: 22, h: 30, color: 0x6a8a5a },
      { name: '垃圾桶', x: rx + 100, y: ry + rh - 58, w: 20, h: 26, color: 0x5a5a62 },
      { name: '鍵盤', x: rx + 180, y: ry + rh - 86, w: 40, h: 8, color: 0x2a2a30 },
    ];
    for (const s of spots) {
      g.fillStyle(0x120f0d, 1).fillRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
      g.fillStyle(s.color, 1).fillRect(s.x, s.y, s.w, s.h);
      if (s.name === '月曆') {
        g.fillStyle(0xc03030, 1).fillRect(s.x, s.y, s.w, 10);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) g.fillStyle(0x9a9080, 1).fillRect(s.x + 3 + i * 7, s.y + 14 + j * 9, 4, 5);
      } else if (s.name === '相框') {
        g.fillStyle(0x6a8aa0, 1).fillRect(s.x + 4, s.y + 4, s.w - 8, s.h - 8);
      } else if (s.name === '牆上的刮痕') {
        g.lineStyle(1, 0x8a8490, 0.8);
        for (let i = 0; i < 5; i++) g.lineBetween(s.x + 6 + i * 8, s.y + 4, s.x + 2 + i * 8, s.y + s.h - 4);
      } else if (s.name === '檯燈') {
        g.fillStyle(0xf5d76e, 0.25).fillTriangle(s.x - 10, s.y + s.h, s.x + s.w + 10, s.y + s.h, s.x + s.w / 2, s.y + 6);
      }
    }
    // 哪幾樣東西藏著數字（第幾位）
    const order = Phaser.Utils.Array.Shuffle(spots.map((_, i) => i));
    const clueOf = new Map<number, number>();
    for (let k = 0; k < n; k++) clueOf.set(order[k], k);
    const found = new Set<number>();
    const marks = (pos: number) => Array.from({ length: n }, (_, i) => (i === pos ? '●' : '○')).join('');
    let searching = false;
    const reveal = (si: number) => {
      const s = spots[si];
      const pos = clueOf.get(si);
      const txt = pos === undefined ? '什麼也沒有' : `${marks(pos)}\n${code[pos]}`;
      const lbl = pixelText(this, s.x + s.w / 2, s.y + s.h / 2, txt, pos === undefined ? 7 : 9, pos === undefined ? '#90a4ae' : '#ffd24a').setOrigin(0.5).setAlign('center');
      lbl.setStroke('#000000', 3).setDepth(110);
      this.body.add(lbl);
      if (pos !== undefined) found.add(pos);
    };
    spots.forEach((s, si) => {
      const z = this.add.zone(s.x - 4, s.y - 4, s.w + 8, s.h + 8).setOrigin(0).setDepth(105).setInteractive({ useHandCursor: true });
      this.body.add(z);
      z.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (this.done || searching) return;
        z.disableInteractive();
        searching = true;
        AudioManager.ui('tap');
        const dots = pixelText(this, s.x + s.w / 2, s.y - 8, '翻找中…', 7, '#c8c8c8').setOrigin(0.5).setDepth(110);
        this.body.add(dots);
        this.time.delayedCall(700, () => {
          dots.destroy();
          searching = false;
          reveal(si);
        });
      });
    });
    pixelText(this, rx + 4, ry + rh - 12, '提示：●○○ 代表第 1 位', 7, '#90a4ae').setDepth(101);

    // 轉盤（右半）
    const val = Array.from({ length: n }, () => 0);
    let sel = 0;
    const dx0 = rx + rw + 20;
    const dw = 38;
    const dgap = 8;
    const dy = ry + 40;
    const dg = this.add.graphics().setDepth(100);
    this.body.add(dg);
    const digits = val.map((_, i) => {
      const x = dx0 + i * (dw + dgap);
      const t = pixelText(this, x + dw / 2, dy + 36, '0', 18, '#f2ece0').setOrigin(0.5).setDepth(102);
      this.body.add(t);
      const up = this.add.zone(x, dy, dw, 22).setOrigin(0).setDepth(105).setInteractive({ useHandCursor: true });
      const dn = this.add.zone(x, dy + 50, dw, 22).setOrigin(0).setDepth(105).setInteractive({ useHandCursor: true });
      this.body.add([up, dn]);
      const spin = (d: number) => (e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        sel = i;
        turn(d);
      };
      up.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => spin(1)(e));
      dn.on('pointerdown', (_p: unknown, _x: unknown, _y: unknown, e: Phaser.Types.Input.EventData) => spin(-1)(e));
      return t;
    });
    const feedback = pixelText(this, dx0, dy + 86, '', 8, '#c8c8c8').setDepth(102);
    this.body.add(feedback);
    const drawDials = () => {
      dg.clear();
      val.forEach((v, i) => {
        const x = dx0 + i * (dw + dgap);
        dg.fillStyle(0x120f0d, 1).fillRect(x - 1, dy - 1, dw + 2, 74);
        dg.fillStyle(i === sel ? 0x4a4236 : 0x2a2620, 1).fillRect(x, dy, dw, 72);
        dg.fillStyle(0x6a5a40, 1).fillRect(x, dy + 22, dw, 28);
        dg.fillStyle(0xf5d76e, 1).fillTriangle(x + dw / 2 - 6, dy + 16, x + dw / 2 + 6, dy + 16, x + dw / 2, dy + 6);
        dg.fillTriangle(x + dw / 2 - 6, dy + 56, x + dw / 2 + 6, dy + 56, x + dw / 2, dy + 66);
        if (i === sel) dg.lineStyle(1, 0xffd24a, 1).strokeRect(x - 2, dy - 2, dw + 4, 76);
        digits[i].setText(`${v}`);
      });
    };
    const turn = (d: number) => {
      if (this.done) return;
      val[sel] = (val[sel] + d + 10) % 10;
      AudioManager.ui('tap');
      drawDials();
    };
    const tryOpen = () => {
      if (this.done) return;
      const right = val.filter((v, i) => v === code[i]).length;
      if (right === n) return this.finish(true);
      feedback.setText(`喀……對了 ${right} 位`).setColor('#ff8a80');
      this.mistake();
    };
    const kb = this.input.keyboard;
    kb?.on('keydown-LEFT', () => ((sel = (sel + n - 1) % n), drawDials()));
    kb?.on('keydown-RIGHT', () => ((sel = (sel + 1) % n), drawDials()));
    kb?.on('keydown-A', () => ((sel = (sel + n - 1) % n), drawDials()));
    kb?.on('keydown-D', () => ((sel = (sel + 1) % n), drawDials()));
    kb?.on('keydown-UP', () => turn(1));
    kb?.on('keydown-W', () => turn(1));
    kb?.on('keydown-DOWN', () => turn(-1));
    kb?.on('keydown-S', () => turn(-1));
    kb?.on('keydown-ENTER', tryOpen);
    for (let k = 0; k <= 9; k++) kb?.on(`keydown-${['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'][k]}`, () => {
      val[sel] = k;
      sel = Math.min(n - 1, sel + 1);
      drawDials();
    });
    this.body.add(uiButton(this, dx0, dy + 104, n * (dw + dgap) - dgap, 26, '轉開', tryOpen, { fill: 0x3a4a2a, size: 9 }));
    this.assist = () => {
      // 開鎖工具：貼著箱門聽，直接聽出一位還沒找到的數字
      const left = code.map((_, i) => i).filter((i) => !found.has(i));
      const pos = left.length ? Phaser.Utils.Array.GetRandom(left) : 0;
      val[pos] = code[pos];
      found.add(pos);
      feedback.setText(`聽出第 ${pos + 1} 位是 ${code[pos]}`).setColor('#9ad17a');
      drawDials();
    };
    drawDials();
  }

  // ── 電箱接線 ──

  private setupWires(): void {
    const { spec, ease } = this.d;
    const cols = spec.tier === 1 ? 4 : spec.tier === 2 ? 5 : 6;
    const rows = spec.tier === 3 ? 4 : 3;
    this.totalTime = (18 + cols * rows * 1.4) * ease;
    const T = Math.min(40, Math.floor((BH - 10) / rows));
    const gx = GAME_WIDTH / 2 - (cols * T) / 2;
    const gy = BY + (BH - rows * T) / 2;
    // 先走出一條路：從左邊某一列往右，可以上下彎
    const r0 = Phaser.Math.Between(0, rows - 1);
    const path: { c: number; r: number }[] = [{ c: 0, r: r0 }];
    const seen = new Set([`0,${r0}`]);
    let c = 0;
    let r = r0;
    while (c < cols - 1) {
      const opts: [number, number][] = [[1, 0]];
      if (r > 0 && !seen.has(`${c},${r - 1}`)) opts.push([0, -1]);
      if (r < rows - 1 && !seen.has(`${c},${r + 1}`)) opts.push([0, 1]);
      const [dc, dr] = Math.random() < 0.45 ? opts[0] : Phaser.Utils.Array.GetRandom(opts);
      c += dc;
      r += dr;
      seen.add(`${c},${r}`);
      path.push({ c, r });
    }
    const r1 = r;
    const want: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
    const dirBit = (a: { c: number; r: number }, b: { c: number; r: number }) => (b.c > a.c ? E : b.c < a.c ? Wb : b.r > a.r ? S : N);
    const opp = (m: number) => rot(rot(m));
    path.forEach((p, i) => {
      const inBit = i === 0 ? Wb : opp(dirBit(path[i - 1], p));
      const outBit = i === path.length - 1 ? E : dirBit(p, path[i + 1]);
      want[p.r][p.c] = inBit | outBit;
    });
    const onPath = new Set(path.map((p) => `${p.c},${p.r}`));
    const shapes = [N | S, N | E, N | E | S];
    const tiles = want.map((row, rr) =>
      row.map((m, cc) => {
        const base = onPath.has(`${cc},${rr}`) ? m : Phaser.Utils.Array.GetRandom(shapes);
        let cur = base;
        const k = Phaser.Math.Between(1, 3);
        for (let i = 0; i < k; i++) cur = rot(cur);
        return { mask: cur, fixed: false, solution: base };
      }),
    );
    let cursor = { c: 0, r: r0 };
    // 運氣太好一開始就通了：把第一格轉歪
    const solvedAtStart = () => path.every((p) => tiles[p.r][p.c].mask === want[p.r][p.c]);
    if (solvedAtStart()) tiles[path[0].r][path[0].c].mask = rot(tiles[path[0].r][path[0].c].mask);
    const g = this.add.graphics().setDepth(100);
    this.body.add(g);
    let powered = new Set<string>();
    const flow = () => {
      const on = new Set<string>();
      const q: { c: number; r: number; from: number }[] = [{ c: 0, r: r0, from: Wb }];
      while (q.length) {
        const cur = q.shift()!;
        if (cur.c < 0 || cur.r < 0 || cur.c >= cols || cur.r >= rows) continue;
        const key = `${cur.c},${cur.r}`;
        const m = tiles[cur.r][cur.c].mask;
        if (!(m & cur.from) || on.has(key)) continue;
        on.add(key);
        if (m & N) q.push({ c: cur.c, r: cur.r - 1, from: S });
        if (m & S) q.push({ c: cur.c, r: cur.r + 1, from: N });
        if (m & E) q.push({ c: cur.c + 1, r: cur.r, from: Wb });
        if (m & Wb) q.push({ c: cur.c - 1, r: cur.r, from: E });
      }
      return on;
    };
    const draw = () => {
      g.clear();
      g.fillStyle(0x120f0d, 1).fillRect(gx - 4, gy - 4, cols * T + 8, rows * T + 8);
      // 電池與鎖
      g.fillStyle(0x3a7a3a, 1).fillRect(gx - 34, gy + r0 * T + T / 2 - 10, 24, 20);
      g.fillStyle(0xd8d8d8, 1).fillRect(gx - 12, gy + r0 * T + T / 2 - 4, 4, 8);
      g.fillStyle(0xffd24a, 1).fillRect(gx - 10, gy + r0 * T + T / 2 - 2, 10, 4);
      const lit = powered.has(`${cols - 1},${r1}`) && tiles[r1][cols - 1].mask & E;
      g.fillStyle(lit ? 0x9ad17a : 0x8a3a3a, 1).fillRect(gx + cols * T + 10, gy + r1 * T + T / 2 - 12, 22, 24);
      g.fillStyle(lit ? 0xffd24a : 0x4a4a4a, 1).fillRect(gx + cols * T, gy + r1 * T + T / 2 - 2, 10, 4);
      for (let rr = 0; rr < rows; rr++) {
        for (let cc = 0; cc < cols; cc++) {
          const x = gx + cc * T;
          const y = gy + rr * T;
          const tl = tiles[rr][cc];
          const on = powered.has(`${cc},${rr}`);
          g.fillStyle(tl.fixed ? 0x3a3424 : 0x2a2e34, 1).fillRect(x + 1, y + 1, T - 2, T - 2);
          const col = on ? 0xffd24a : 0x7a808a;
          const w = 6;
          const mx = x + T / 2;
          const my = y + T / 2;
          g.fillStyle(0x120f0d, 1);
          if (tl.mask & N) g.fillRect(mx - w / 2 - 1, y, w + 2, T / 2);
          if (tl.mask & S) g.fillRect(mx - w / 2 - 1, my, w + 2, T / 2);
          if (tl.mask & E) g.fillRect(mx, my - w / 2 - 1, T / 2, w + 2);
          if (tl.mask & Wb) g.fillRect(x, my - w / 2 - 1, T / 2, w + 2);
          g.fillStyle(col, 1);
          if (tl.mask & N) g.fillRect(mx - w / 2, y, w, T / 2);
          if (tl.mask & S) g.fillRect(mx - w / 2, my, w, T / 2);
          if (tl.mask & E) g.fillRect(mx, my - w / 2, T / 2, w);
          if (tl.mask & Wb) g.fillRect(x, my - w / 2, T / 2, w);
          g.fillStyle(on ? 0xfff0a0 : 0x9aa0a8, 1).fillRect(mx - 4, my - 4, 8, 8);
          if (cc === cursor.c && rr === cursor.r) g.lineStyle(2, 0xffffff, 0.8).strokeRect(x + 2, y + 2, T - 4, T - 4);
          if (tl.fixed) g.lineStyle(1, 0xf5d76e, 0.8).strokeRect(x + 1, y + 1, T - 2, T - 2);
        }
      }
    };
    const update = () => {
      powered = flow();
      draw();
      if (powered.has(`${cols - 1},${r1}`) && tiles[r1][cols - 1].mask & E) this.finish(true);
    };
    const turn = (cc: number, rr: number) => {
      if (this.done) return;
      const tl = tiles[rr][cc];
      if (tl.fixed) return;
      tl.mask = rot(tl.mask);
      cursor = { c: cc, r: rr };
      AudioManager.ui('tap');
      update();
    };
    const hit = this.add.zone(gx, gy, cols * T, rows * T).setOrigin(0).setDepth(105).setInteractive({ useHandCursor: true });
    this.body.add(hit);
    hit.on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      const cc = Math.floor((p.worldX - gx) / T);
      const rr = Math.floor((p.worldY - gy) / T);
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) turn(cc, rr);
    });
    const kb = this.input.keyboard;
    const move = (dc: number, dr: number) => {
      cursor = { c: Phaser.Math.Clamp(cursor.c + dc, 0, cols - 1), r: Phaser.Math.Clamp(cursor.r + dr, 0, rows - 1) };
      draw();
    };
    kb?.on('keydown-LEFT', () => move(-1, 0));
    kb?.on('keydown-RIGHT', () => move(1, 0));
    kb?.on('keydown-UP', () => move(0, -1));
    kb?.on('keydown-DOWN', () => move(0, 1));
    kb?.on('keydown-A', () => move(-1, 0));
    kb?.on('keydown-D', () => move(1, 0));
    kb?.on('keydown-W', () => move(0, -1));
    kb?.on('keydown-S', () => move(0, 1));
    kb?.on('keydown-SPACE', () => turn(cursor.c, cursor.r));
    kb?.on('keydown-ENTER', () => turn(cursor.c, cursor.r));
    // 接線不會「接錯」：失誤改成碰到亂接的火花——連續亂轉很多次才算
    let spins = 0;
    hit.on('pointerdown', () => {
      spins++;
      if (spins > cols * rows * 4) {
        spins = 0;
        this.mistake();
      }
    });
    this.assist = () => {
      // 開鎖工具：前半段路自動接好、鎖住
      path.slice(0, Math.ceil(path.length / 2)).forEach((p) => {
        const tl = tiles[p.r][p.c];
        tl.mask = tl.solution;
        tl.fixed = true;
      });
      update();
    };
    update();
  }
}
