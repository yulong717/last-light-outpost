import { SFX, renderSfx } from './SfxBank';
import { LOOP_RATE, renderCricket, renderLoop, type LoopName } from './MusicBank';

/**
 * 音效總管（單例）：
 * - 主音量／音效／音樂／環境音 四條音量匯流排，設定存在 localStorage
 * - 靜音（M 鍵或 HUD 按鈕）
 * - 每次播放隨機挑變體 + 微調音高，避免重複感
 * - 依世界 x 座標做左右聲道（StereoPanner）與遠距衰減
 * - 同種音效限制同時發聲數與最短間隔，霰彈槍不會爆音
 * - 手機自動播放限制：第一次觸控／按鍵時才建立並 resume AudioContext
 * - 切到背景分頁時暫停，回來再繼續
 *
 * 不依賴 Phaser 的 sound 系統，所以任何場景都能直接 import 使用。
 */

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  ambient: number;
  muted: boolean;
}

export interface PlayOptions {
  /** -1（左）～ 1（右） */
  pan?: number;
  /** 額外音量倍率 */
  volume?: number;
  /** 額外音高（半音） */
  semitones?: number;
  /** 延遲幾秒再播 */
  delay?: number;
}

/** 之後若想換成真實錄音（CC0），在這裡把音效名稱對到 public/ 底下的檔案即可 */
const SAMPLE_OVERRIDES: Partial<Record<string, string[]>> = {
  // shot_pistol: ['assets/audio/pistol_1.ogg', 'assets/audio/pistol_2.ogg'],
};

const SETTINGS_KEY = 'llo-audio';
const DEFAULTS: AudioSettings = { master: 0.8, sfx: 0.9, music: 0.5, ambient: 0.6, muted: false };

type Mood = 'off' | 'menu' | 'night';

interface Voice {
  src: AudioBufferSourceNode;
  started: number;
}

class AudioManagerImpl {
  settings: AudioSettings = { ...DEFAULTS };
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<'sfx' | 'music' | 'ambient', GainNode>;
  private buffers = new Map<string, AudioBuffer[]>();
  private voices = new Map<string, Voice[]>();
  private lastPlay = new Map<string, number>();
  private loops = new Map<LoopName, AudioBuffer>();
  private crickets: AudioBuffer[] = [];
  private musicNodes: { calm: GainNode; tension: GainNode; sources: AudioBufferSourceNode[] } | null = null;
  private windNode: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private mood: Mood = 'off';
  private intensity = 0;
  private cricketTimer: number | null = null;
  private listeners: ((s: AudioSettings) => void)[] = [];
  private warmQueue: string[] = [];

  constructor() {
    this.loadSettings();
  }

  /** 在遊戲啟動時呼叫一次：掛上解鎖與分頁切換的監聽 */
  install(): void {
    const unlock = () => {
      this.ensureContext();
      void this.ctx?.resume();
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
    });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ── 設定 ─────────────────────────────────────────────

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.settings = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
    } catch {
      // 讀不到就用預設值
    }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // 隱私模式寫不進去，忽略
    }
  }

  set(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    for (const k of ['master', 'sfx', 'music', 'ambient'] as const) {
      this.settings[k] = Math.min(1, Math.max(0, Math.round(this.settings[k] * 10) / 10));
    }
    this.saveSettings();
    this.applyVolumes();
    this.listeners.forEach((fn) => fn(this.settings));
  }

  toggleMute(): void {
    this.set({ muted: !this.settings.muted });
  }

  /** 設定改變時通知（給 HUD 的喇叭圖示）；回傳取消函式 */
  onChange(fn: (s: AudioSettings) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, now, 0.03);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, now, 0.03);
    this.buses.music.gain.setTargetAtTime(s.music, now, 0.05);
    this.buses.ambient.gain.setTargetAtTime(s.ambient, now, 0.05);
  }

  // ── 初始化 ───────────────────────────────────────────

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    // 主匯流排後面接一個壓縮器，很多聲音疊在一起時不會破音
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.buses = {
      sfx: ctx.createGain(),
      music: ctx.createGain(),
      ambient: ctx.createGain(),
    };
    Object.values(this.buses).forEach((g) => g.connect(this.master));
    this.applyVolumes();
    // 解鎖後利用空檔預先算好所有音效，之後第一次播放就不會卡
    this.warmQueue = Object.keys(SFX);
    this.warmUp();
    this.loadOverrides();
    if (this.mood !== 'off') this.startMood(this.mood);
    return ctx;
  }

  private warmUp(): void {
    const name = this.warmQueue.shift();
    if (!name) return;
    this.getBuffers(name);
    setTimeout(() => this.warmUp(), 0);
  }

  private loadOverrides(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [name, urls] of Object.entries(SAMPLE_OVERRIDES)) {
      if (!urls?.length) continue;
      Promise.all(urls.map((u) => fetch(u).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab))))
        .then((bufs) => this.buffers.set(name, bufs))
        .catch(() => {
          // 載入失敗就繼續用程式生成的版本
        });
    }
  }

  private toBuffer(data: Float32Array, rate: number, right?: Float32Array): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(right ? 2 : 1, data.length, rate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    if (right) buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
    return buf;
  }

  private getBuffers(name: string): AudioBuffer[] {
    let list = this.buffers.get(name);
    if (!list) {
      const def = SFX[name];
      const fs = this.ctx!.sampleRate;
      list = [];
      for (let v = 0; v < def.variants; v++) list.push(this.toBuffer(renderSfx(name, v, fs), fs));
      this.buffers.set(name, list);
    }
    return list;
  }

  // ── 播放音效 ─────────────────────────────────────────

  /** 介面音效 */
  ui(kind: 'tap' | 'confirm' | 'back' = 'tap'): void {
    this.play(`ui_${kind}`);
  }

  has(name: string): boolean {
    return name in SFX;
  }

  play(name: string, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    const def = SFX[name];
    if (!ctx || !def || ctx.state !== 'running' || this.settings.muted) return;
    const nowMs = performance.now();
    if (nowMs - (this.lastPlay.get(name) ?? -1e9) < def.minGapMs) return;
    this.lastPlay.set(name, nowMs);

    const list = this.getBuffers(name);
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    const semis = (Math.random() * 2 - 1) * def.pitch + (opts.semitones ?? 0);
    src.playbackRate.value = 2 ** (semis / 12);

    const gain = ctx.createGain();
    gain.gain.value = def.volume * (opts.volume ?? 1);
    let node: AudioNode = src;
    node.connect(gain);
    node = gain;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node.connect(p);
      node = p;
    }
    node.connect(this.buses.sfx);

    // 超過同時發聲上限：把最舊的那個淡掉
    const active = (this.voices.get(name) ?? []).filter((v) => v.started + (v.src.buffer?.duration ?? 0) * 1000 > nowMs);
    if (active.length >= def.maxVoices) {
      const oldest = active.shift()!;
      try {
        oldest.src.stop(ctx.currentTime + 0.02);
      } catch {
        // 已經停了
      }
    }
    active.push({ src, started: nowMs });
    this.voices.set(name, active);
    src.start(ctx.currentTime + (opts.delay ?? 0));
  }

  // ── 音樂與環境音 ─────────────────────────────────────

  /** 切換整體氛圍：menu 只有平靜音樂；night 加上夜風、蟲鳴與動態配樂 */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.ctx) this.startMood(mood);
  }

  /** 0..1：戰鬥緊張度，決定第二層配樂（心跳鼓＋低音）的音量 */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.musicNodes) return;
    const t = this.ctx.currentTime;
    this.musicNodes.tension.gain.setTargetAtTime(this.intensity * 0.9, t, 1.2);
    this.musicNodes.calm.gain.setTargetAtTime(1 - this.intensity * 0.35, t, 1.5);
  }

  private getLoop(name: LoopName): AudioBuffer {
    let b = this.loops.get(name);
    if (!b) {
      const s = renderLoop(name);
      b = this.toBuffer(s.left, LOOP_RATE, s.right);
      this.loops.set(name, b);
    }
    return b;
  }

  private startMood(mood: Mood): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // 先淡出舊的
    this.stopMusic(1.5);
    this.stopAmbient(2);
    if (mood === 'off') return;

    // 音樂：兩層同時開始，保持拍子對齊
    const calm = ctx.createGain();
    const tension = ctx.createGain();
    calm.gain.value = 0;
    tension.gain.value = 0;
    calm.connect(this.buses.music);
    tension.connect(this.buses.music);
    const layers: [LoopName, GainNode][] = [
      ['music_calm', calm],
      ['music_tension', tension],
    ];
    const start = t + 0.1;
    const sources = layers.map(([name, g]) => {
      const src = ctx.createBufferSource();
      src.buffer = this.getLoop(name);
      src.loop = true;
      src.connect(g);
      src.start(start);
      return src;
    });
    calm.gain.setTargetAtTime(mood === 'menu' ? 0.8 : 1, start, 1.5);
    this.musicNodes = { calm, tension, sources };
    this.setIntensity(mood === 'night' ? this.intensity : 0);

    if (mood === 'night') {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.buses.ambient);
      const src = ctx.createBufferSource();
      src.buffer = this.getLoop('ambient_wind');
      src.loop = true;
      src.connect(g);
      src.start(start);
      g.gain.setTargetAtTime(0.7, start, 2);
      this.windNode = { gain: g, src };
      this.scheduleCricket();
    }
  }

  private stopMusic(fade: number): void {
    const m = this.musicNodes;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    m.calm.gain.cancelScheduledValues(t);
    m.tension.gain.cancelScheduledValues(t);
    m.calm.gain.setTargetAtTime(0, t, fade / 4);
    m.tension.gain.setTargetAtTime(0, t, fade / 4);
    m.sources.forEach((s) => s.stop(t + fade + 0.1));
    this.musicNodes = null;
  }

  private stopAmbient(fade: number): void {
    if (this.cricketTimer !== null) {
      clearTimeout(this.cricketTimer);
      this.cricketTimer = null;
    }
    const w = this.windNode;
    if (!w || !this.ctx) return;
    const t = this.ctx.currentTime;
    w.gain.gain.cancelScheduledValues(t);
    w.gain.gain.setTargetAtTime(0, t, fade / 4);
    w.src.stop(t + fade + 0.1);
    this.windNode = null;
  }

  /** 蟲鳴：隨機間隔、隨機左右，戰鬥越激烈越安靜（蟲也會怕） */
  private scheduleCricket(): void {
    const wait = 1500 + Math.random() * 4000;
    this.cricketTimer = window.setTimeout(() => {
      const ctx = this.ctx;
      if (!ctx || this.mood !== 'night') return;
      if (ctx.state === 'running' && !this.settings.muted && Math.random() > this.intensity) {
        if (this.crickets.length === 0) {
          for (let i = 0; i < 4; i++) this.crickets.push(this.toBuffer(renderCricket(500 + i, LOOP_RATE), LOOP_RATE));
        }
        const src = ctx.createBufferSource();
        src.buffer = this.crickets[Math.floor(Math.random() * this.crickets.length)];
        src.playbackRate.value = 0.95 + Math.random() * 0.1;
        const g = ctx.createGain();
        g.gain.value = 0.06 + Math.random() * 0.06;
        const p = ctx.createStereoPanner();
        p.pan.value = Math.random() * 1.6 - 0.8;
        src.connect(g).connect(p).connect(this.buses.ambient);
        src.start();
      }
      this.scheduleCricket();
    }, wait);
  }
}

export const AudioManager = new AudioManagerImpl();
