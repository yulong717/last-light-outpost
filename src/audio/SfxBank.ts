import { Biquad, Buf, env, rng, type Rng } from './dsp';

/**
 * 所有音效的程式化配方。每個配方吃一個亂數種子，產生一個變體；
 * AudioManager 會為每種音效預先算好幾個變體，播放時隨機挑一個再加一點音高變化，
 * 連續開槍才不會像機關槍一樣同一聲重複。
 *
 * 想換成真的錄音（例如 Kenney / OpenGameArt 的 CC0 音檔），
 * 在 AudioManager 的 SAMPLE_OVERRIDES 填上檔案路徑即可，同名會優先使用音檔。
 */
export type SfxRecipe = (fs: number, r: Rng) => Buf;

export interface SfxDef {
  recipe: SfxRecipe;
  /** 預先產生幾個變體 */
  variants: number;
  /** 基礎音量（0..1） */
  volume: number;
  /** 播放時隨機音高範圍（±半音） */
  pitch: number;
  /** 同時最多幾個聲音，超過就砍最舊的 */
  maxVoices: number;
  /** 同一種音效兩次播放的最短間隔（毫秒），避免霰彈 6 顆彈丸疊成爆音 */
  minGapMs: number;
}

const noise = (r: Rng) => r() * 2 - 1;

/** 槍聲共用骨架：爆裂瞬態 + 低頻衝擊 + 尾音回響 */
function gunshot(
  fs: number,
  r: Rng,
  o: { len: number; crack: number; body: number; thumpHz: number; thumpLen: number; tone: number; tail: number; verb: number },
): Buf {
  const b = new Buf(fs, o.len);
  const lp = new Biquad('lp', fs, o.tone, 0.9);
  const hp = new Biquad('hp', fs, 1800);
  const tailLp = new Biquad('lp', fs, 900);
  let phase = 0;
  b.add(0, o.len, (t, i) => {
    if (i % 32 === 0) lp.set(o.tone * (0.25 + 0.75 * env(t, o.body * 0.6)));
    const n = noise(r);
    // 高頻「啪」：極短
    const crack = hp.run(n) * env(t, o.crack, 0.0003) * 1.4;
    // 身體：低通雜訊，頻率隨時間往下掉
    const body = lp.run(n) * env(t, o.body, 0.0005);
    // 低頻衝擊：正弦往下滑
    const f = o.thumpHz * (0.45 + 0.55 * Math.exp(-t / 0.03));
    phase += (2 * Math.PI * f) / fs;
    const thump = Math.sin(phase) * env(t, o.thumpLen, 0.001) * 1.2;
    // 尾音：遠處建築反射的低沉轟聲
    const tail = tailLp.run(n) * env(t, o.tail, 0.01) * 0.35;
    return crack + body + thump + tail;
  });
  return b.saturate(2.4).reverb(o.verb, 1.6).normalize(0.95);
}

/** 金屬短擊（換彈、拉槓、空膛） */
function metalClick(b: Buf, at: number, freq: number, r: Rng, gain = 1, decay = 0.012): void {
  const bp = new Biquad('bp', b.fs, freq, 6);
  const partials = [1, 1.47, 2.09, 2.76].map((k) => freq * k * (0.97 + r() * 0.06));
  b.add(at, 0.12, (t) => {
    let s = bp.run(noise(r)) * env(t, decay * 0.6, 0.0002);
    for (let p = 0; p < partials.length; p++) s += Math.sin(2 * Math.PI * partials[p] * t) * env(t, decay * (1.4 - p * 0.25)) * 0.25;
    return s * gain;
  });
}

/** 悶響（彈匣插入、身體被打中） */
function thud(b: Buf, at: number, freq: number, len: number, r: Rng, gain = 1, tone = 600): void {
  const lp = new Biquad('lp', b.fs, tone, 1.2);
  let ph = 0;
  b.add(at, len * 5, (t) => {
    ph += (2 * Math.PI * freq * (0.6 + 0.4 * Math.exp(-t / 0.02))) / b.fs;
    return (Math.sin(ph) * 0.8 + lp.run(noise(r)) * 0.9) * env(t, len, 0.001) * gain;
  });
}

/**
 * 霧屍的聲帶：鋸齒波 + 抖動音高 + 兩個共振峰濾波器，
 * 疊上氣音雜訊，做出喉嚨裡咕嚕的低吼。
 */
function voice(
  b: Buf,
  at: number,
  len: number,
  r: Rng,
  o: { f0: number; f1: number; formants: [number, number]; rough: number; breath: number; attack?: number; gain?: number },
): void {
  const fA = new Biquad('bp', b.fs, o.formants[0], 5);
  const fB = new Biquad('bp', b.fs, o.formants[1], 7);
  const breathBp = new Biquad('bp', b.fs, 1200, 0.8);
  let ph = 0;
  const vibRate = 5 + r() * 4;
  const wobble = r() * 10;
  b.add(at, len, (t) => {
    const k = t / len;
    const shape = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7 * (t < (o.attack ?? 0.04) ? t / (o.attack ?? 0.04) : 1);
    const f = (o.f0 + (o.f1 - o.f0) * k) * (1 + 0.05 * Math.sin(2 * Math.PI * vibRate * t + wobble) + o.rough * noise(r) * 0.08);
    ph = (ph + f / b.fs) % 1;
    const saw = ph * 2 - 1;
    // 粗糙感：用低頻雜訊調幅，像聲帶在抽搐
    const grit = 1 - o.rough * 0.5 * (1 + Math.sin(2 * Math.PI * (f * 0.5) * t));
    const src = saw * grit;
    const v = fA.run(src) * 1.1 + fB.run(src) * 0.7 + breathBp.run(noise(r)) * o.breath;
    return v * shape * (o.gain ?? 1);
  });
}

type ShotParams = Parameters<typeof gunshot>[2];

/** 一把槍的槍聲定義：同一個骨架，靠參數做出不同口徑的個性 */
function shot(o: ShotParams, opt: { volume?: number; variants?: number; voices?: number; gap?: number; pitch?: number } = {}): SfxDef {
  return {
    variants: opt.variants ?? 4,
    volume: opt.volume ?? 0.55,
    pitch: opt.pitch ?? 1,
    maxVoices: opt.voices ?? 4,
    minGapMs: opt.gap ?? 30,
    recipe: (fs, r) => gunshot(fs, r, o),
  };
}

/** 揮空的風切聲：帶通雜訊由低掃到高再落下 */
function whoosh(fs: number, r: Rng, len: number, f0: number, f1: number, gain = 1): Buf {
  const b = new Buf(fs, len + 0.05);
  const bp = new Biquad('bp', fs, f0, 1.4);
  b.add(0, len, (t, i) => {
    const k = t / len;
    if (i % 16 === 0) bp.set(f0 + (f1 - f0) * Math.sin(Math.PI * k));
    return bp.run(noise(r)) * Math.sin(Math.PI * k) ** 1.5 * gain;
  });
  return b;
}

/** 摩擦聲（拉槍栓、彈鏈） */
function scrape(b: Buf, at: number, len: number, freq: number, r: Rng, gain = 0.5): void {
  const bp = new Biquad('bp', b.fs, freq, 1.6);
  b.add(at, len, (t) => bp.run(noise(r)) * Math.sin((Math.PI * t) / len) * gain);
}

export const SFX: Record<string, SfxDef> = {
  // ── 武器 ──────────────────────────────────────────────
  // 每把槍一個專屬聲音：口徑越大越低沉、尾音越長；衝鋒槍短而脆，栓動步槍的回音最長
  shot_m1911: shot({ len: 0.6, crack: 0.006, body: 0.055, thumpHz: 120, thumpLen: 0.06, tone: 4200, tail: 0.18, verb: 0.3 }),
  shot_python: shot({ len: 0.95, crack: 0.008, body: 0.085, thumpHz: 95, thumpLen: 0.1, tone: 5200, tail: 0.32, verb: 0.42 }, { volume: 0.7, gap: 60 }),
  shot_mp5: shot({ len: 0.36, crack: 0.004, body: 0.03, thumpHz: 175, thumpLen: 0.03, tone: 4400, tail: 0.1, verb: 0.2 }, { volume: 0.42, voices: 6, gap: 18, pitch: 1.4 }),
  shot_m4a1: shot({ len: 0.5, crack: 0.003, body: 0.04, thumpHz: 140, thumpLen: 0.045, tone: 7200, tail: 0.16, verb: 0.26 }, { volume: 0.5, voices: 6, gap: 18 }),
  shot_ak47: shot({ len: 0.66, crack: 0.005, body: 0.062, thumpHz: 105, thumpLen: 0.065, tone: 5000, tail: 0.22, verb: 0.3 }, { volume: 0.58, voices: 6, gap: 22 }),
  shot_r870: shot({ len: 0.95, crack: 0.01, body: 0.11, thumpHz: 95, thumpLen: 0.12, tone: 3600, tail: 0.32, verb: 0.38 }, { volume: 0.7, variants: 3, voices: 3, gap: 60 }),
  shot_coach: shot({ len: 1.05, crack: 0.012, body: 0.13, thumpHz: 82, thumpLen: 0.15, tone: 3200, tail: 0.38, verb: 0.42 }, { volume: 0.78, variants: 3, voices: 3, gap: 50 }),
  shot_m1014: shot({ len: 0.8, crack: 0.01, body: 0.1, thumpHz: 100, thumpLen: 0.1, tone: 3900, tail: 0.28, verb: 0.35 }, { volume: 0.66, variants: 3, voices: 3, gap: 50 }),
  shot_mosin: shot({ len: 1.4, crack: 0.005, body: 0.09, thumpHz: 78, thumpLen: 0.12, tone: 6500, tail: 0.6, verb: 0.55 }, { volume: 0.75, variants: 3, voices: 2, gap: 120, pitch: 0.6 }),
  shot_m249: shot({ len: 0.55, crack: 0.004, body: 0.05, thumpHz: 118, thumpLen: 0.05, tone: 6000, tail: 0.2, verb: 0.28 }, { volume: 0.5, voices: 8, gap: 18 }),
  /** 拉槍栓：上抬、後拉、前推、下壓 */
  bolt: {
    variants: 2,
    volume: 0.6,
    pitch: 0.6,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.55);
      metalClick(b, 0, 1500, r, 0.9, 0.015);
      scrape(b, 0.05, 0.1, 2200, r, 0.5);
      metalClick(b, 0.15, 1900, r, 1, 0.02);
      scrape(b, 0.22, 0.09, 2600, r, 0.5);
      metalClick(b, 0.31, 2300, r, 1, 0.018);
      metalClick(b, 0.38, 1300, r, 0.8, 0.02);
      thud(b, 0.38, 150, 0.025, r, 0.4, 700);
      return b.normalize(0.85);
    },
  },
  /** 橋夾壓彈：一排子彈被拇指壓進彈倉 */
  clip_insert: {
    variants: 2,
    volume: 0.55,
    pitch: 0.8,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.5);
      metalClick(b, 0, 2400, r, 0.9, 0.012);
      scrape(b, 0.03, 0.25, 3200, r, 0.55);
      for (let k = 0; k < 5; k++) metalClick(b, 0.06 + k * 0.045, 2800 + r() * 500, r, 0.35, 0.008);
      metalClick(b, 0.32, 1700, r, 0.8, 0.02);
      return b.normalize(0.8);
    },
  },
  /** 左輪：甩開轉輪、退殼（叮叮噹噹） */
  revolver_out: {
    variants: 2,
    volume: 0.5,
    pitch: 0.8,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.8);
      metalClick(b, 0, 2100, r, 1, 0.02);
      for (let k = 0; k < 6; k++) metalClick(b, 0.18 + r() * 0.25, 4500 + r() * 1500, r, 0.3, 0.03);
      return b.normalize(0.75);
    },
  },
  /** 左輪：快速裝填器塞入、甩回轉輪 */
  revolver_in: {
    variants: 2,
    volume: 0.55,
    pitch: 0.8,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.4);
      scrape(b, 0, 0.06, 3000, r, 0.4);
      metalClick(b, 0.05, 2600, r, 0.7, 0.012);
      metalClick(b, 0.2, 1800, r, 1, 0.025);
      // 轉輪棘輪的嗒嗒聲
      for (let k = 0; k < 3; k++) metalClick(b, 0.24 + k * 0.03, 3600, r, 0.25, 0.006);
      return b.normalize(0.8);
    },
  },
  /** 雙管：折開槍管、彈殼彈出 */
  break_open: {
    variants: 2,
    volume: 0.55,
    pitch: 0.8,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.6);
      metalClick(b, 0, 1200, r, 1, 0.025);
      thud(b, 0.02, 120, 0.04, r, 0.6, 600);
      thud(b, 0.25, 200, 0.02, r, 0.4, 1500);
      thud(b, 0.3, 190, 0.02, r, 0.4, 1500);
      return b.normalize(0.8);
    },
  },
  /** 雙管：合上槍管 */
  break_close: {
    variants: 2,
    volume: 0.6,
    pitch: 0.8,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.3);
      metalClick(b, 0, 1000, r, 1, 0.03);
      thud(b, 0, 100, 0.05, r, 0.9, 500);
      return b.normalize(0.85);
    },
  },
  /** 機槍：掀開上蓋、拉出空彈鏈 */
  belt_open: {
    variants: 1,
    volume: 0.5,
    pitch: 0.5,
    maxVoices: 1,
    minGapMs: 300,
    recipe: (fs, r) => {
      const b = new Buf(fs, 1);
      metalClick(b, 0, 1400, r, 1, 0.02);
      for (let k = 0; k < 10; k++) metalClick(b, 0.2 + k * 0.05, 3500 + r() * 800, r, 0.3, 0.01);
      scrape(b, 0.2, 0.5, 2500, r, 0.3);
      return b.normalize(0.75);
    },
  },
  /** 機槍：放上新彈鏈、拍上蓋、拉機柄 */
  belt_close: {
    variants: 1,
    volume: 0.6,
    pitch: 0.5,
    maxVoices: 1,
    minGapMs: 300,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.8);
      for (let k = 0; k < 6; k++) metalClick(b, k * 0.04, 3000 + r() * 600, r, 0.3, 0.01);
      thud(b, 0.3, 110, 0.05, r, 1, 600);
      metalClick(b, 0.3, 1100, r, 1, 0.03);
      scrape(b, 0.5, 0.08, 2000, r, 0.4);
      metalClick(b, 0.58, 1700, r, 1, 0.02);
      return b.normalize(0.85);
    },
  },
  // ── 近戰 ──────────────────────────────────────────────
  swing_light: {
    variants: 4,
    volume: 0.4,
    pitch: 2,
    maxVoices: 2,
    minGapMs: 60,
    recipe: (fs, r) => whoosh(fs, r, 0.16, 1200, 4200).normalize(0.7),
  },
  swing_heavy: {
    variants: 3,
    volume: 0.5,
    pitch: 1.5,
    maxVoices: 2,
    minGapMs: 100,
    recipe: (fs, r) => whoosh(fs, r, 0.32, 300, 1500).normalize(0.8),
  },
  /** 刀刃砍進肉裡 */
  melee_slash: {
    variants: 4,
    volume: 0.55,
    pitch: 2,
    maxVoices: 3,
    minGapMs: 30,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.3);
      const bp = new Biquad('bp', fs, 2400, 1.2);
      b.add(0, 0.12, (t) => bp.run(noise(r)) * env(t, 0.04, 0.001) * 0.9);
      thud(b, 0.005, 110, 0.04, r, 0.9, 900);
      return b.normalize(0.85);
    },
  },
  /** 鈍器砸下去：低沉的悶擊加一點骨頭碎裂 */
  melee_blunt: {
    variants: 4,
    volume: 0.65,
    pitch: 1.5,
    maxVoices: 3,
    minGapMs: 30,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.4);
      // 低頻再沉一點、拖長一點，打下去比較「實」
      thud(b, 0, 58, 0.1, r, 1.4, 450);
      const hp = new Biquad('hp', fs, 1500);
      b.add(0.01, 0.08, (t) => hp.run(noise(r)) * env(t, 0.012, 0.0005) * 0.8);
      return b.saturate(1.8).normalize(0.9);
    },
  },
  /** 體力見底的喘氣 */
  exhausted: {
    variants: 2,
    volume: 0.35,
    pitch: 1,
    maxVoices: 1,
    minGapMs: 600,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.7);
      const bp = new Biquad('bp', fs, 900, 0.9);
      b.add(0, 0.28, (t) => bp.run(noise(r)) * Math.sin((Math.PI * t) / 0.28) * 0.7);
      b.add(0.36, 0.3, (t) => bp.run(noise(r)) * Math.sin((Math.PI * t) / 0.3) * 0.5);
      return b.normalize(0.7);
    },
  },
  shot_pistol: {
    variants: 4,
    volume: 0.55,
    pitch: 1.2,
    maxVoices: 4,
    minGapMs: 30,
    recipe: (fs, r) => gunshot(fs, r, { len: 0.55, crack: 0.006, body: 0.045, thumpHz: 150, thumpLen: 0.05, tone: 5200, tail: 0.16, verb: 0.3 }),
  },
  shot_shotgun: {
    variants: 3,
    volume: 0.7,
    pitch: 1,
    maxVoices: 3,
    minGapMs: 60,
    recipe: (fs, r) => gunshot(fs, r, { len: 0.95, crack: 0.01, body: 0.11, thumpHz: 95, thumpLen: 0.12, tone: 3600, tail: 0.32, verb: 0.38 }),
  },
  shot_rifle: {
    variants: 4,
    volume: 0.55,
    pitch: 0.8,
    maxVoices: 6,
    minGapMs: 25,
    recipe: (fs, r) => gunshot(fs, r, { len: 0.7, crack: 0.004, body: 0.06, thumpHz: 120, thumpLen: 0.07, tone: 6500, tail: 0.22, verb: 0.32 }),
  },
  dry_fire: {
    variants: 2,
    volume: 0.5,
    pitch: 1,
    maxVoices: 2,
    minGapMs: 80,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.15);
      metalClick(b, 0, 3200, r, 1, 0.008);
      metalClick(b, 0.03, 2100, r, 0.5, 0.01);
      return b.normalize(0.7);
    },
  },
  /** 彈匣退出 */
  reload_out: {
    variants: 2,
    volume: 0.5,
    pitch: 1,
    maxVoices: 2,
    minGapMs: 100,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.35);
      metalClick(b, 0, 2600, r, 1, 0.01);
      // 彈匣滑出的摩擦聲
      const bp = new Biquad('bp', fs, 3000, 1.5);
      b.add(0.02, 0.12, (t) => bp.run(noise(r)) * env(t, 0.05, 0.02) * 0.4);
      thud(b, 0.16, 180, 0.03, r, 0.5, 900);
      return b.normalize(0.75);
    },
  },
  /** 彈匣插入 + 拉滑套 */
  reload_in: {
    variants: 2,
    volume: 0.55,
    pitch: 1,
    maxVoices: 2,
    minGapMs: 100,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.4);
      thud(b, 0, 220, 0.025, r, 0.8, 1400);
      metalClick(b, 0.005, 2400, r, 0.9, 0.012);
      metalClick(b, 0.17, 1800, r, 0.8, 0.02);
      metalClick(b, 0.24, 2900, r, 1, 0.015);
      return b.normalize(0.8);
    },
  },
  /** 霰彈槍：塞子彈 */
  shell_insert: {
    variants: 3,
    volume: 0.45,
    pitch: 1.5,
    maxVoices: 2,
    minGapMs: 60,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.2);
      thud(b, 0, 260, 0.02, r, 0.7, 1800);
      metalClick(b, 0.01, 1700, r, 0.6, 0.01);
      return b.normalize(0.7);
    },
  },
  /** 霰彈槍：泵動上膛 */
  pump: {
    variants: 2,
    volume: 0.6,
    pitch: 0.8,
    maxVoices: 2,
    minGapMs: 100,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.45);
      const bp = new Biquad('bp', fs, 1400, 2);
      b.add(0, 0.1, (t) => bp.run(noise(r)) * env(t, 0.04, 0.01) * 0.6);
      metalClick(b, 0.07, 1300, r, 1, 0.02);
      b.add(0.15, 0.1, (t) => bp.run(noise(r)) * env(t, 0.04, 0.01) * 0.6);
      metalClick(b, 0.21, 1900, r, 1, 0.02);
      thud(b, 0.21, 140, 0.03, r, 0.5, 700);
      return b.normalize(0.85);
    },
  },
  weapon_switch: {
    variants: 2,
    volume: 0.4,
    pitch: 1,
    maxVoices: 1,
    minGapMs: 80,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.3);
      const bp = new Biquad('bp', fs, 900, 0.8);
      b.add(0, 0.15, (t) => bp.run(noise(r)) * env(t, 0.05, 0.02) * 0.5);
      metalClick(b, 0.12, 2200, r, 0.8, 0.015);
      return b.normalize(0.7);
    },
  },
  /** 彈殼落地：兩三下清脆的叮噹 */
  shell_drop: {
    variants: 5,
    volume: 0.22,
    pitch: 2,
    maxVoices: 6,
    minGapMs: 20,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.45);
      const base = 4200 + r() * 1800;
      let at = 0;
      let g = 1;
      for (let k = 0; k < 3; k++) {
        metalClick(b, at, base * (1 - k * 0.04), r, g, 0.03);
        at += 0.07 + r() * 0.06 - k * 0.015;
        g *= 0.45;
      }
      return b.normalize(0.6);
    },
  },

  /** 腳步：踩在碎石地上 */
  footstep: {
    variants: 6,
    volume: 0.16,
    pitch: 1.5,
    maxVoices: 2,
    minGapMs: 90,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.18);
      thud(b, 0, 70 + r() * 30, 0.02, r, 0.6, 400);
      // 碎石沙沙聲：幾顆小顆粒
      const bp = new Biquad('bp', fs, 2500 + r() * 1500, 1.2);
      for (let k = 0; k < 5; k++) {
        const at = 0.005 + r() * 0.06;
        b.add(at, 0.03, (t) => bp.run(noise(r)) * env(t, 0.006, 0.0005) * (0.3 + r() * 0.4));
      }
      return b.normalize(0.7);
    },
  },
  /** 低血量心跳 */
  heartbeat: {
    variants: 1,
    volume: 0.5,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 250,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.5);
      thud(b, 0, 55, 0.05, r, 1, 150);
      thud(b, 0.17, 50, 0.045, r, 0.7, 150);
      return b.normalize(0.85);
    },
  },

  // ── 霧屍 ──────────────────────────────────────────────
  zombie_groan: {
    variants: 6,
    volume: 0.35,
    pitch: 2,
    maxVoices: 4,
    minGapMs: 250,
    recipe: (fs, r) => {
      const len = 0.9 + r() * 0.8;
      const b = new Buf(fs, len + 0.2);
      const f0 = 70 + r() * 40;
      voice(b, 0, len, r, {
        f0,
        f1: f0 * (0.75 + r() * 0.2),
        formants: [450 + r() * 250, 1000 + r() * 500],
        rough: 0.6 + r() * 0.3,
        breath: 0.25,
        attack: 0.15,
      });
      return b.reverb(0.25, 1.2).normalize(0.8);
    },
  },
  /** 狂奔屍蓄力的尖嘯：高、刺耳、往上拉，一聽就知道要衝了 */
  zombie_scream: {
    variants: 3,
    volume: 0.55,
    pitch: 1.5,
    maxVoices: 2,
    minGapMs: 150,
    recipe: (fs, r) => {
      const len = 0.7 + r() * 0.15;
      const b = new Buf(fs, len + 0.3);
      const f0 = 260 + r() * 60;
      voice(b, 0, len, r, { f0, f1: f0 * 1.6, formants: [1100 + r() * 300, 2600 + r() * 500], rough: 0.95, breath: 0.7, attack: 0.03 });
      voice(b, 0.02, len * 0.9, r, { f0: f0 * 0.5, f1: f0 * 0.75, formants: [600, 1400], rough: 0.8, breath: 0.3, attack: 0.05, gain: 0.5 });
      return b.reverb(0.2, 0.8).normalize(0.9);
    },
  },
  zombie_attack: {
    variants: 4,
    volume: 0.4,
    pitch: 1.5,
    maxVoices: 3,
    minGapMs: 120,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.45);
      const f0 = 110 + r() * 50;
      voice(b, 0, 0.32, r, { f0: f0 * 1.3, f1: f0, formants: [700 + r() * 200, 1500 + r() * 400], rough: 0.9, breath: 0.6, attack: 0.01 });
      return b.normalize(0.85);
    },
  },
  /** 子彈打進肉裡 */
  flesh_hit: {
    variants: 5,
    volume: 0.45,
    pitch: 2,
    maxVoices: 5,
    minGapMs: 25,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.22);
      thud(b, 0, 90 + r() * 40, 0.035, r, 1, 700);
      // 濕黏的噗嗤
      const bp = new Biquad('bp', fs, 1600 + r() * 800, 1.5);
      b.add(0.004, 0.1, (t) => bp.run(noise(r)) * env(t, 0.025, 0.002) * 0.7);
      return b.saturate(1.5).normalize(0.85);
    },
  },
  /** 爆頭：清脆的碎裂 + 噴濺 */
  headshot: {
    variants: 3,
    volume: 0.55,
    pitch: 1.5,
    maxVoices: 3,
    minGapMs: 40,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.5);
      const hp = new Biquad('hp', fs, 2500);
      b.add(0, 0.05, (t) => hp.run(noise(r)) * env(t, 0.006, 0.0002) * 1.5);
      thud(b, 0, 130, 0.04, r, 0.9, 900);
      const bp = new Biquad('bp', fs, 1100, 1.2);
      b.add(0.015, 0.35, (t) => bp.run(noise(r)) * env(t, 0.07, 0.005) * (0.6 + 0.4 * Math.sin(t * 180)) * 0.8);
      return b.saturate(1.8).normalize(0.9);
    },
  },
  zombie_death: {
    variants: 4,
    volume: 0.45,
    pitch: 1.5,
    maxVoices: 3,
    minGapMs: 60,
    recipe: (fs, r) => {
      const b = new Buf(fs, 1.1);
      const f0 = 95 + r() * 35;
      voice(b, 0, 0.55, r, { f0, f1: f0 * 0.55, formants: [500 + r() * 200, 1100 + r() * 300], rough: 0.8, breath: 0.4, attack: 0.02 });
      // 倒地的悶響
      thud(b, 0.5 + r() * 0.1, 70, 0.06, r, 0.9, 400);
      return b.reverb(0.2, 1.2).normalize(0.85);
    },
  },

  // ── 據點 ──────────────────────────────────────────────
  barricade_hit: {
    variants: 4,
    volume: 0.45,
    pitch: 2,
    maxVoices: 3,
    minGapMs: 70,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.4);
      // 木頭：幾個不和諧的共振峰 + 帶通雜訊
      const modes = [180, 310, 520, 790].map((f) => f * (0.9 + r() * 0.2));
      const bp = new Biquad('bp', fs, 600, 1.2);
      b.add(0, 0.4, (t) => {
        let s = bp.run(noise(r)) * env(t, 0.02, 0.0005) * 0.9;
        for (let k = 0; k < modes.length; k++) s += Math.sin(2 * Math.PI * modes[k] * t) * env(t, 0.06 / (k + 1)) * 0.5;
        return s;
      });
      // 木頭裂開的嘎吱聲
      if (r() > 0.4) {
        const hp = new Biquad('bp', fs, 2400, 3);
        b.add(0.03, 0.15, (t) => hp.run(noise(r)) * env(t, 0.04, 0.01) * (Math.sin(t * 900) > 0 ? 0.5 : 0.1));
      }
      return b.saturate(1.4).normalize(0.85);
    },
  },
  barricade_break: {
    variants: 1,
    volume: 0.75,
    pitch: 0.5,
    maxVoices: 1,
    minGapMs: 500,
    recipe: (fs, r) => {
      const b = new Buf(fs, 1.6);
      for (let k = 0; k < 9; k++) {
        const at = k * 0.06 + r() * 0.08;
        const modes = [150, 260, 430].map((f) => f * (0.8 + r() * 0.4));
        const bp = new Biquad('bp', fs, 500 + r() * 600, 1);
        b.add(at, 0.5, (t) => {
          let s = bp.run(noise(r)) * env(t, 0.05, 0.001);
          for (const m of modes) s += Math.sin(2 * Math.PI * m * t) * env(t, 0.08) * 0.4;
          return s * (1 - k * 0.07);
        });
      }
      thud(b, 0, 60, 0.15, r, 1.2, 300);
      return b.saturate(2).reverb(0.35, 1.5).normalize(0.95);
    },
  },
  base_hit: {
    variants: 3,
    volume: 0.5,
    pitch: 1.5,
    maxVoices: 2,
    minGapMs: 90,
    recipe: (fs, r) => {
      // 敲在水泥牆／鐵板上：低沉 + 一點金屬
      const b = new Buf(fs, 0.6);
      thud(b, 0, 75, 0.07, r, 1.1, 350);
      metalClick(b, 0.002, 600 + r() * 200, r, 0.6, 0.08);
      return b.reverb(0.3, 1.3).normalize(0.85);
    },
  },

  // ── 主角 ──────────────────────────────────────────────
  player_hurt: {
    variants: 4,
    volume: 0.55,
    pitch: 1,
    maxVoices: 1,
    minGapMs: 200,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.4);
      thud(b, 0, 100, 0.03, r, 0.8, 600);
      const f0 = 150 + r() * 40;
      voice(b, 0.01, 0.2, r, { f0: f0 * 1.2, f1: f0 * 0.85, formants: [650, 1100], rough: 0.25, breath: 0.3, attack: 0.01, gain: 0.9 });
      return b.normalize(0.85);
    },
  },
  player_death: {
    variants: 1,
    volume: 0.65,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 1000,
    recipe: (fs, r) => {
      const b = new Buf(fs, 1.6);
      voice(b, 0, 0.8, r, { f0: 170, f1: 95, formants: [600, 1000], rough: 0.35, breath: 0.4, attack: 0.02 });
      thud(b, 0.75, 60, 0.12, r, 1, 300);
      return b.reverb(0.4, 1.6).normalize(0.85);
    },
  },

  // ── 介面與氣氛提示 ─────────────────────────────────────
  ui_tap: {
    variants: 1,
    volume: 0.35,
    pitch: 0.5,
    maxVoices: 2,
    minGapMs: 40,
    recipe: (fs) => {
      const b = new Buf(fs, 0.08);
      b.add(0, 0.08, (t) => ((Math.floor(t * 1760) & 1) * 2 - 1) * env(t, 0.015) * 0.4);
      return b.normalize(0.6);
    },
  },
  ui_confirm: {
    variants: 1,
    volume: 0.4,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 100,
    recipe: (fs) => {
      const b = new Buf(fs, 0.35);
      [523.25, 783.99].forEach((f, k) =>
        b.add(k * 0.08, 0.25, (t) => ((Math.floor(t * f * 2) & 1) * 2 - 1) * env(t, 0.08) * 0.35),
      );
      return b.normalize(0.6);
    },
  },
  ui_back: {
    variants: 1,
    volume: 0.35,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 100,
    recipe: (fs) => {
      const b = new Buf(fs, 0.3);
      [659.25, 440].forEach((f, k) => b.add(k * 0.07, 0.2, (t) => ((Math.floor(t * f * 2) & 1) * 2 - 1) * env(t, 0.06) * 0.35));
      return b.normalize(0.6);
    },
  },
  /** 波次來襲：低沉的警報號角 */
  /** 汽車防盜警報：兩音交替的方波（一段 1.2 秒，循環播放） */
  car_alarm: {
    variants: 1,
    volume: 0.4,
    pitch: 0,
    maxVoices: 2,
    minGapMs: 300,
    recipe: (fs) => {
      const b = new Buf(fs, 1.2);
      b.add(0, 1.2, (t) => {
        const f = Math.floor(t * 5) % 2 === 0 ? 1180 : 860;
        return ((Math.floor(t * f * 2) & 1) * 2 - 1) * 0.3 * Math.min(1, (1.2 - t) * 40);
      });
      return b.normalize(0.7);
    },
  },
  /** 玻璃碎裂：高頻叮噹＋雜訊 */
  glass_break: {
    variants: 3,
    volume: 0.45,
    pitch: 2,
    maxVoices: 3,
    minGapMs: 60,
    recipe: (fs, r) => {
      const b = new Buf(fs, 0.6);
      const hp = new Biquad('hp', fs, 3500);
      b.add(0, 0.5, (t) => hp.run(noise(r)) * env(t, 0.12, 0.001) * 0.8);
      for (let k = 0; k < 7; k++) {
        const at = r() * 0.3;
        const f = 2500 + r() * 4000;
        b.add(at, 0.15, (t) => Math.sin(2 * Math.PI * f * t) * env(t, 0.05) * 0.3);
      }
      return b.reverb(0.2, 0.8).normalize(0.8);
    },
  },
  /** 油桶爆炸：低頻轟＋長尾 */
  explosion: {
    variants: 2,
    volume: 0.9,
    pitch: 2,
    maxVoices: 3,
    minGapMs: 80,
    recipe: (fs, r) => {
      const b = new Buf(fs, 2);
      const lp = new Biquad('lp', fs, 1400, 0.8);
      let ph = 0;
      b.add(0, 2, (t, i) => {
        if (i % 32 === 0) lp.set(200 + 1800 * Math.exp(-t / 0.15));
        const f = 55 * (0.5 + Math.exp(-t / 0.08));
        ph += (2 * Math.PI * f) / fs;
        return lp.run(noise(r)) * env(t, 0.6, 0.002) + Math.sin(ph) * env(t, 0.35, 0.002) * 1.4;
      });
      return b.saturate(3).reverb(0.5, 2).normalize(0.95);
    },
  },
  wave_horn: {
    variants: 1,
    volume: 0.55,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 1000,
    recipe: (fs, r) => {
      const b = new Buf(fs, 3.2);
      const lp = new Biquad('lp', fs, 900, 1.5);
      b.add(0, 2.6, (t) => {
        const swell = Math.min(1, t / 0.5) * Math.min(1, (2.6 - t) / 0.9);
        const f = 73.4 * (1 + 0.004 * Math.sin(t * 30));
        let s = 0;
        for (const d of [1, 1.005, 0.995, 2.003]) s += (((t * f * d) % 1) * 2 - 1) / (d > 1.5 ? 3 : 1);
        return lp.run(s + noise(r) * 0.05) * swell * 0.4;
      });
      return b.reverb(0.5, 2).normalize(0.8);
    },
  },
  stinger_win: {
    variants: 1,
    volume: 0.5,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 1000,
    recipe: (fs) => {
      const b = new Buf(fs, 3);
      [261.63, 329.63, 392, 523.25].forEach((f, k) =>
        b.add(k * 0.18, 2.4, (t) => (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * env(t, 0.9, 0.02) * 0.3),
      );
      return b.reverb(0.5, 2).normalize(0.75);
    },
  },
  stinger_lose: {
    variants: 1,
    volume: 0.55,
    pitch: 0,
    maxVoices: 1,
    minGapMs: 1000,
    recipe: (fs, r) => {
      const b = new Buf(fs, 3.5);
      [220, 207.65, 174.61, 146.83].forEach((f, k) =>
        b.add(k * 0.35, 2.4, (t) => {
          const ph = (t * f) % 1;
          return (ph * 2 - 1) * env(t, 0.7, 0.03) * 0.25;
        }),
      );
      thud(b, 0, 45, 0.4, r, 0.8, 200);
      const lp = new Biquad('lp', fs, 1200);
      for (let i = 0; i < b.length; i++) b.data[i] = lp.run(b.data[i]);
      return b.reverb(0.6, 2.2).normalize(0.8);
    },
  },
};

export type SfxName = keyof typeof SFX;

/** 以名稱 + 變體編號決定種子，讓聲音每次開遊戲都一樣 */
export function seedFor(name: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h ^ (variant * 0x9e3779b9)) >>> 0;
}

export function renderSfx(name: string, variant: number, fs: number): Float32Array {
  const def = SFX[name];
  return def.recipe(fs, rng(seedFor(name, variant))).data;
}
