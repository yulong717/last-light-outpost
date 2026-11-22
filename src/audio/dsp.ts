/**
 * 極簡離線 DSP：在 JS 裡直接算出音效波形（Float32Array），
 * 再交給 Web Audio 播放。不用下載任何音檔，沒有授權問題。
 */

export type Rng = () => number;

/** 可重現的亂數（mulberry32），讓每個變體的聲音固定 */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad 濾波器，可每幾個樣本改一次頻率做掃頻 */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private type: 'lp' | 'hp' | 'bp',
    private fs: number,
    freq: number,
    private q = 0.707,
  ) {
    this.set(freq);
  }

  set(freq: number, q = this.q): void {
    const f = Math.min(Math.max(freq, 10), this.fs * 0.45);
    const w = (2 * Math.PI * f) / this.fs;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (this.type === 'lp') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (this.type === 'hp') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 指數衰減包絡：t 秒時的音量（attack 秒線性淡入） */
export function env(t: number, decay: number, attack = 0.001): number {
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

export class Buf {
  readonly data: Float32Array;

  constructor(
    readonly fs: number,
    readonly seconds: number,
  ) {
    this.data = new Float32Array(Math.ceil(fs * seconds));
  }

  get length(): number {
    return this.data.length;
  }

  /** 在 offset 秒處疊上一段由 fn(t, i) 產生的聲音 */
  add(offset: number, seconds: number, fn: (t: number, i: number) => number): this {
    const start = Math.floor(offset * this.fs);
    const n = Math.min(Math.ceil(seconds * this.fs), this.data.length - start);
    for (let i = 0; i < n; i++) this.data[start + i] += fn(i / this.fs, i);
    return this;
  }

  /** 把峰值正規化到 peak，並在頭尾加一點點淡入淡出避免爆音 */
  normalize(peak = 0.9): this {
    let max = 0;
    for (let i = 0; i < this.data.length; i++) max = Math.max(max, Math.abs(this.data[i]));
    const k = max > 0 ? peak / max : 1;
    const fade = Math.min(64, this.data.length >> 2);
    for (let i = 0; i < this.data.length; i++) {
      let g = k;
      if (i < 8) g *= i / 8;
      const tail = this.data.length - 1 - i;
      if (tail < fade) g *= tail / fade;
      this.data[i] *= g;
    }
    return this;
  }

  /** 柔和削波，讓槍聲更飽滿 */
  saturate(drive = 2): this {
    const norm = Math.tanh(drive);
    for (let i = 0; i < this.data.length; i++) this.data[i] = Math.tanh(this.data[i] * drive) / norm;
    return this;
  }

  /** 便宜的殘響：幾條梳狀延遲，模擬空曠夜晚的回音 */
  reverb(mix = 0.25, size = 1): this {
    const delays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.floor(d * size * this.fs));
    const fb = 0.72;
    const lines = delays.map((d) => ({ buf: new Float32Array(d), i: 0 }));
    const damp = new Biquad('lp', this.fs, 3500);
    for (let i = 0; i < this.data.length; i++) {
      const x = this.data[i];
      let wet = 0;
      for (const l of lines) {
        const y = l.buf[l.i];
        l.buf[l.i] = x + y * fb;
        l.i = (l.i + 1) % l.buf.length;
        wet += y;
      }
      this.data[i] = x + damp.run(wet / lines.length) * mix;
    }
    return this;
  }
}

/** 頭尾交叉淡化，做出無縫循環 */
export function makeLoop(data: Float32Array, fs: number, xfade = 0.5): Float32Array {
  const n = Math.floor(xfade * fs);
  const out = data.slice(0, data.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + data[data.length - n + i] * (1 - k);
  }
  return out;
}
