import { Biquad, env, rng, type Rng } from './dsp';

/**
 * 程式化的環境音與背景音樂。全部在瀏覽器裡算出可無縫循環的波形，
 * 用較低的取樣率（22050Hz）省下計算時間，低頻為主的聲音聽不出差別。
 *
 * 音樂分兩層、長度相同、同時開始播放：
 *   music_calm    陰暗的合成器長音 + 零星鐘聲（白天／波次間）
 *   music_tension 心跳鼓 + 八分音符低音脈衝（霧屍多時淡入）
 * AudioManager 依場上霧屍數量調整第二層的音量，做出動態配樂。
 */
export const LOOP_RATE = 22050;

export interface Stereo {
  left: Float32Array;
  right: Float32Array;
}

const BPM = 120;
const BEAT = 60 / BPM;
/** 4 個和弦，每個 2 小節（8 拍） */
const CHORD_BEATS = 8;
/** A 小調：Am – F – Dm – E，低八度 */
const CHORDS: number[][] = [
  [57, 60, 64],
  [53, 57, 60],
  [50, 53, 57],
  [52, 56, 59],
];
const ROOTS = [33, 29, 26, 28];
const LOOP_SECONDS = CHORDS.length * CHORD_BEATS * BEAT;

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** 長度 loop + tail 的聲音，把尾巴疊回開頭，得到完美無縫的循環 */
function wrap(data: Float32Array, loopLen: number): Float32Array {
  const out = data.slice(0, loopLen);
  for (let i = loopLen; i < data.length; i++) out[i - loopLen] += data[i];
  return out;
}

function normalizeStereo(s: Stereo, peak: number): Stereo {
  let max = 0;
  for (const ch of [s.left, s.right]) for (let i = 0; i < ch.length; i++) max = Math.max(max, Math.abs(ch[i]));
  const k = max > 0 ? peak / max : 1;
  for (const ch of [s.left, s.right]) for (let i = 0; i < ch.length; i++) ch[i] *= k;
  return s;
}

function renderPad(r: Rng, fs: number, side: number): Float32Array {
  const loopLen = Math.floor(LOOP_SECONDS * fs);
  const tail = Math.floor(3 * fs);
  const out = new Float32Array(loopLen + tail);
  const chordLen = CHORD_BEATS * BEAT;
  CHORDS.forEach((chord, ci) => {
    const start = Math.floor(ci * chordLen * fs);
    const n = Math.floor((chordLen + 2.5) * fs);
    const lp = new Biquad('lp', fs, 600, 0.9);
    const voices = chord.flatMap((note) =>
      [-1, 1].map((d) => ({ f: midi(note) * (1 + d * 0.004 + side * 0.002), ph: r() })),
    );
    // 和弦根音再低八度，讓畫面底下有重量
    voices.push({ f: midi(chord[0] - 12), ph: r() });
    for (let i = 0; i < n && start + i < out.length; i++) {
      const t = i / fs;
      if (i % 64 === 0) lp.set(380 + 260 * Math.sin((2 * Math.PI * (ci * chordLen + t)) / 7 + side));
      let s = 0;
      for (const v of voices) {
        v.ph = (v.ph + v.f / fs) % 1;
        s += v.ph * 2 - 1;
      }
      // 慢起慢收的長音
      const amp = Math.min(1, t / 1.2) * Math.min(1, Math.max(0, (chordLen + 2.5 - t) / 2.5));
      out[start + i] += lp.run(s / voices.length) * amp * 0.5;
    }
  });

  // 零星的高音鐘聲：A 小調五聲音階，固定種子所以每次一樣
  const scale = [69, 72, 74, 76, 79, 81];
  for (let k = 0; k < 7; k++) {
    if (r() < 0.35) continue;
    const at = Math.floor((k * 4 + 1 + Math.floor(r() * 3)) * BEAT * fs);
    const f = midi(scale[Math.floor(r() * scale.length)]);
    const n = Math.floor(3 * fs);
    for (let i = 0; i < n && at + i < out.length; i++) {
      const t = i / fs;
      const bell = Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * t) * env(t, 0.3);
      out[at + i] += bell * env(t, 1.1, 0.005) * 0.12 * (side > 0 ? 0.7 : 1);
    }
  }
  return wrap(out, loopLen);
}

function renderTension(r: Rng, fs: number, side: number): Float32Array {
  const loopLen = Math.floor(LOOP_SECONDS * fs);
  const out = new Float32Array(loopLen + Math.floor(1 * fs));
  const totalBeats = CHORDS.length * CHORD_BEATS;
  // 心跳鼓：每拍「咚—咚」
  for (let b = 0; b < totalBeats; b++) {
    for (const [off, gain] of [
      [0, 1],
      [0.22, 0.6],
    ] as const) {
      const at = Math.floor((b * BEAT + off) * fs);
      let ph = 0;
      const n = Math.floor(0.35 * fs);
      for (let i = 0; i < n && at + i < out.length; i++) {
        const t = i / fs;
        ph += (2 * Math.PI * (48 + 70 * Math.exp(-t / 0.03))) / fs;
        out[at + i] += Math.sin(ph) * env(t, 0.09, 0.002) * 0.55 * gain;
      }
    }
  }
  // 八分音符低音脈衝，跟著和弦根音走
  const lp = new Biquad('lp', fs, 400, 2);
  for (let e = 0; e < totalBeats * 2; e++) {
    const root = ROOTS[Math.floor(e / (CHORD_BEATS * 2))];
    const f = midi(root + 12) * (1 + side * 0.003);
    const at = Math.floor(e * (BEAT / 2) * fs);
    const n = Math.floor((BEAT / 2) * fs);
    let ph = r();
    const accent = e % 4 === 0 ? 1 : 0.65;
    for (let i = 0; i < n && at + i < out.length; i++) {
      const t = i / fs;
      ph = (ph + f / fs) % 1;
      if (i % 32 === 0) lp.set(200 + 900 * env(t, 0.05));
      out[at + i] += lp.run(ph * 2 - 1) * env(t, 0.12, 0.003) * 0.35 * accent;
    }
  }
  // 遠處的金屬敲擊（每 2 小節一下，左右聲道錯開）
  for (let bar = 0; bar < totalBeats / 4; bar += 2) {
    const at = Math.floor((bar * 4 + 3.5) * BEAT * fs + side * 0.01 * fs);
    const n = Math.floor(1.2 * fs);
    const partials = [311, 467, 702].map((f) => f * (0.98 + r() * 0.04));
    for (let i = 0; i < n && at + i < out.length; i++) {
      const t = i / fs;
      let s = 0;
      for (const p of partials) s += Math.sin(2 * Math.PI * p * t);
      out[at + i] += s * env(t, 0.35, 0.002) * 0.05;
    }
  }
  return wrap(out, loopLen);
}

/** 夜風：棕色雜訊經過緩慢掃動的低通濾波，忽強忽弱 */
function renderWind(r: Rng, fs: number, side: number): Float32Array {
  const seconds = 14;
  const len = Math.floor(seconds * fs);
  const out = new Float32Array(len + Math.floor(2 * fs));
  const lp = new Biquad('lp', fs, 400, 1.4);
  let brown = 0;
  const gustA = 2 * Math.PI * (1 / seconds) * 2;
  const gustB = 2 * Math.PI * (1 / seconds) * 3;
  for (let i = 0; i < out.length; i++) {
    const t = i / fs;
    brown = (brown + (r() * 2 - 1) * 0.02) * 0.998;
    const gust = 0.55 + 0.3 * Math.sin(gustA * t + side) + 0.15 * Math.sin(gustB * t + side * 2);
    if (i % 64 === 0) lp.set(220 + 500 * gust);
    out[i] = lp.run(brown * 6) * gust;
  }
  // 循環點交叉淡化
  const x = Math.floor(2 * fs);
  for (let i = 0; i < x; i++) {
    const k = i / x;
    out[i] = out[i] * k + out[len + i] * (1 - k);
  }
  return out.slice(0, len);
}

export type LoopName = 'music_calm' | 'music_tension' | 'ambient_wind';

const RENDERERS: Record<LoopName, (r: Rng, fs: number, side: number) => Float32Array> = {
  music_calm: renderPad,
  music_tension: renderTension,
  ambient_wind: renderWind,
};

const PEAK: Record<LoopName, number> = { music_calm: 0.7, music_tension: 0.75, ambient_wind: 0.6 };

export function renderLoop(name: LoopName): Stereo {
  const left = RENDERERS[name](rng(11 + name.length), LOOP_RATE, -1);
  const right = RENDERERS[name](rng(97 + name.length), LOOP_RATE, 1);
  return normalizeStereo({ left, right }, PEAK[name]);
}

/** 蟲鳴：短促的高頻顫音，AudioManager 會隨機時間、隨機左右播放 */
export function renderCricket(seed: number, fs: number): Float32Array {
  const r = rng(seed);
  const f = 4200 + r() * 900;
  const pulses = 3 + Math.floor(r() * 4);
  const len = pulses * 0.055 + 0.1;
  const out = new Float32Array(Math.floor(len * fs));
  for (let p = 0; p < pulses; p++) {
    const at = Math.floor(p * 0.055 * fs);
    const n = Math.floor(0.035 * fs);
    for (let i = 0; i < n && at + i < out.length; i++) {
      const t = i / fs;
      out[at + i] += Math.sin(2 * Math.PI * f * t) * Math.sin((Math.PI * i) / n) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 90 * t));
    }
  }
  return out;
}
