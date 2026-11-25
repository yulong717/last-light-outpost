import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import type { LockSpec } from '../data/explore';
import { Expedition } from '../explore/Expedition';
import { uiButton, uiPanel } from '../explore/ui';
import { GameState } from '../state/GameState';
import { rumble } from '../feel/Haptics';
import { pixelText } from '../utils/text';

export interface WiringData {
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
/** 內容區 */
const BX = PX + 14;
const BY = PY + 62;
const BW = PW - 28;
const BH = 196;

const HELP = { pc: '點接頭旋轉（或方向鍵選、空白鍵轉），把電從左邊的電池接到右邊', touch: '點接頭旋轉，把電從左邊的電池接到右邊' };
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
 * 電箱接線（疊在探索畫面上）：旋轉接頭，把電從左邊的電池接到右邊的開關。
 * 時間到或亂轉太多次（火花）就失敗；帶著開鎖工具可以花一個，前半段路自動接好。
 */
export class WiringScene extends Phaser.Scene {
  private d!: WiringData;
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
    super('Wiring');
  }

  init(d: WiringData): void {
    this.d = d;
    this.done = false;
    this.mistakes = 0;
    this.assisted = false;
    this.tick = () => {};
    this.assist = () => {};
    this.footer = [];
  }

  create(): void {
    const { spec } = this.d;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.removeAllListeners());
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7).setOrigin(0);
    uiPanel(this, PX, PY, PW, PH);
    pixelText(this, PX + 14, PY + 10, '電箱接線', 11, '#f5d76e');
    pixelText(this, PX + 14, PY + 28, spec.prompt, 8, '#e0e0e0');
    const touch = this.sys.game.device.input.touch;
    pixelText(this, PX + 14, PY + 41, HELP[touch ? 'touch' : 'pc'], 7, '#90a4ae');
    this.missText = pixelText(this, PX + PW - 14, PY + 12, '', 8, '#ff8a80').setOrigin(1, 0);
    this.add.rectangle(BX, PY + 54, BW, 4, 0x000000).setOrigin(0).setDepth(100);
    this.timerBar = this.add.rectangle(BX + 1, PY + 55, BW - 2, 2, 0xf5d76e).setOrigin(0).setDepth(101);
    this.body = this.add.container(0, 0).setDepth(100);
    this.refreshMistakes();
    this.setupWires();
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
    const t = pixelText(this, GAME_WIDTH / 2, BY + BH / 2, ok ? '通電了！' : '打不開……', 18, ok ? '#9ad17a' : '#ff6b6b').setOrigin(0.5).setStroke('#000000', 5);
    t.setDepth(130).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.time.delayedCall(900, () => {
      const cb = this.d.onDone;
      this.scene.stop();
      cb(ok);
    });
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
