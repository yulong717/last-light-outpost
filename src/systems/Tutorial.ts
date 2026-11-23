import Phaser from 'phaser';
import { AudioManager } from '../audio/AudioManager';
import { TUTORIAL_DUMMIES, TUTORIAL_STEPS, TUTORIAL_WAVE, type TutorialFocus, type TutorialStepDef } from '../data/tutorial';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { GameEvents } from './GameEvents';
import type { WeaponSystem } from './WeaponSystem';
import { WaveSpawner } from './WaveSpawner';

/** 給 UIScene 畫提示框的資料（DefenseScene 的 'tutorial' 事件） */
export interface TutorialHud {
  title: string;
  hint: string;
  /** 第幾步（1 起算）／共幾步 */
  step: number;
  total: number;
  /** 進度文字，例如「1 / 2」；沒有就不顯示 */
  progress?: string;
  focus: TutorialFocus;
  /** 這一步剛完成（提示框打勾） */
  cleared?: boolean;
}

export interface TutorialHost {
  scene: Phaser.Scene;
  player: Player;
  weapons: () => WeaponSystem;
  zombies: () => Zombie[];
  /** 在指定 x 生一隻霧屍（y 隨機）；x 省略就照一般夜晚從鏡頭右緣外生成 */
  spawn: (enemyId: string, x?: number) => void;
  /** 路障的 x（練習用的霧屍生在路障前方不遠處） */
  barricadeX: number;
  touch: boolean;
  onDone: () => void;
}

/**
 * 開局教學的導演：一步一步出提示、放練習用的霧屍、判斷完成條件，
 * 最後放一小波霧屍，清光就呼叫 onDone。步驟與文字在 src/data/tutorial.ts。
 */
export class Tutorial {
  readonly steps: TutorialStepDef[];
  private index = -1;
  private count = 0;
  private cleared = false;
  private lastX = 0;
  private lastY = 0;
  private spawnWait = 0;
  /** 最後一波用的出怪器（只有最後一步才建立） */
  spawner?: WaveSpawner;
  private offs: (() => void)[] = [];

  constructor(private host: TutorialHost) {
    // 只有一把槍的主角（阿凱、好運姐）沒有換槍這一步
    const guns = host.weapons().weapons.length;
    this.steps = TUTORIAL_STEPS.filter((s) => s.id !== 'swap' || guns >= 2);
    const bus = GameEvents.of(host.scene);
    const on = <K extends 'enemy:death' | 'player:melee-hit' | 'player:reload-start' | 'player:weapon-switch'>(k: K, fn: () => void) => {
      bus.on(k, fn);
      this.offs.push(() => bus.off(k, fn));
    };
    on('enemy:death', () => this.step?.id === 'shoot' && this.add(1));
    on('player:melee-hit', () => this.step?.id === 'melee' && this.add(1));
    on('player:reload-start', () => this.step?.id === 'reload' && this.add(1));
    on('player:weapon-switch', () => this.step?.id === 'swap' && this.add(1));
    host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  get step(): TutorialStepDef | undefined {
    return this.steps[this.index];
  }

  /** 最後一波開打後，HUD 上方顯示的波次 */
  get inWave(): boolean {
    return this.step?.id === 'wave';
  }

  start(): void {
    this.enter(0);
  }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
  }

  private enter(i: number): void {
    this.index = i;
    this.count = 0;
    this.cleared = false;
    this.spawnWait = 0.6;
    const s = this.step!;
    const p = this.host.player;
    this.lastX = p.footX;
    this.lastY = p.footY;
    if (s.id === 'reload') {
      const w = this.host.weapons();
      // 已經在換彈（打空自動換）或備彈打光了就直接算過；彈匣是滿的就先倒掉一些，才有東西可換
      if (w.reloading || w.reserve() <= 0) {
        this.add(1);
        return;
      }
      const a = w.active;
      if (a.ammo >= a.def.magazine) a.ammo = Math.min(a.ammo, Math.max(1, Math.floor(a.def.magazine / 3)));
    }
    if (s.id === 'wave') {
      this.spawner = new WaveSpawner(this.host.scene, TUTORIAL_WAVE, (id) => this.host.spawn(id));
      this.spawner.start();
    }
    this.emit();
  }

  private add(n: number): void {
    const s = this.step;
    if (!s || this.cleared) return;
    this.count += n;
    if (this.count >= s.goal) this.clear();
    else this.emit();
  }

  private clear(): void {
    this.cleared = true;
    this.emit();
    AudioManager.ui('confirm');
    const next = this.index + 1;
    this.host.scene.time.delayedCall(this.step?.id === 'wave' ? 600 : 1100, () => {
      if (next >= this.steps.length) this.host.onDone();
      else this.enter(next);
    });
  }

  /** 每幀呼叫（教學進行中） */
  update(dt: number): void {
    const s = this.step;
    if (!s || this.cleared) return;
    const p = this.host.player;
    const alive = this.host.zombies().filter((z) => !z.dead).length;
    switch (s.id) {
      case 'move': {
        const d = Math.hypot(p.footX - this.lastX, (p.footY - this.lastY) * 1.5);
        this.lastX = p.footX;
        this.lastY = p.footY;
        if (d > 0) this.add(d);
        break;
      }
      case 'shoot':
      case 'melee': {
        // 練習用的霧屍一次一隻；被打掉還沒過關就再補一隻
        if (alive > 0) break;
        this.spawnWait -= dt;
        if (this.spawnWait > 0) break;
        this.spawnWait = 0.8;
        const x = s.id === 'shoot' ? this.host.barricadeX + 200 : Math.max(this.host.barricadeX + 110, p.footX + 120);
        this.host.spawn('basic', x);
        // 近戰練習一次放兩隻，可以試試一刀掃兩隻
        if (s.id === 'melee' && TUTORIAL_DUMMIES.melee - this.count >= 2) this.host.spawn('basic', x + 24);
        break;
      }
      case 'wave': {
        this.spawner?.update(alive);
        if (this.spawner?.done && alive === 0) this.add(1);
        else this.emit(alive);
        break;
      }
      default:
        break;
    }
  }

  private lastHud = '';

  private emit(alive?: number): void {
    const s = this.step;
    if (!s) return;
    let progress: string | undefined;
    if (s.id === 'shoot' || s.id === 'melee') progress = `${Math.min(this.count, s.goal)} / ${s.goal}`;
    else if (s.id === 'move') progress = `${Math.min(100, Math.round((this.count / s.goal) * 100))}%`;
    else if (s.id === 'wave' && alive !== undefined) progress = this.spawner?.done ? `剩 ${alive} 隻` : '屍群逼近中…';
    let hint = this.host.touch ? s.touch : s.desktop;
    let focus = s.focus;
    // 子彈打光（阿凱的手槍備彈有限）：提醒改用近戰
    const w = this.host.weapons();
    if (s.id === 'wave' && w.weapons.every((g) => g.ammo === 0) && w.reserve() <= 0 && !w.reloading) {
      hint = this.host.touch ? '子彈打光了！按「近戰」也能收拾牠們' : '子彈打光了！右鍵或 V 近戰也能收拾牠們';
      focus = 'melee';
    }
    const hud: TutorialHud = {
      title: s.title,
      hint,
      step: this.index + 1,
      total: this.steps.length,
      progress,
      focus,
      cleared: this.cleared,
    };
    // 內容沒變就不重送，UIScene 不必每幀重排文字
    const key = JSON.stringify(hud);
    if (key === this.lastHud) return;
    this.lastHud = key;
    this.host.scene.events.emit('tutorial', hud);
  }
}
