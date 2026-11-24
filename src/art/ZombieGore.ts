import Phaser from 'phaser';
import { GORE_REGION, goreBase, widenOf, type GoreBase } from './ZombieComposer';
import { registerHeadFrames } from './ProceduralArt';

/**
 * 霧屍斷肢的執行期貼圖：拿合成好的霧屍貼圖（zb_*、zombie_basic、zombie_brute）再切一次。
 * 影格大小、脖子列跟著底圖（一般霧屍 64、巨屍 72，見 ZOMBIE_BASES）。
 *
 * - `${key}~arm`：斷手。站姿各格把伸在身體前面的前臂挖掉，斷口塗成暗紅。影格編號和原圖相同。
 * - `${key}~crawl`：斷腳爬行。拿倒地、撐起上身的兩格（21、22），切掉腿、左右翻轉成頭朝前，
 *   當作「拖著半身往前爬」的暫代影格（之後換成 H3 做的爬行影格，見 docs/ai-art/ZOMBIE_GORE.md）。
 * - `${key}~parts`：飛出去的碎塊：'arm' 前臂、'leg' 一條腿、'h0'..'h5' 頭的碎片。
 *
 * 同一張貼圖只會切一次（以 key 快取）。
 *
 * 效能：切一張要逐像素掃整張貼圖，手機上一張可以吃掉 100–600 ms。
 * 以前是「第一次打斷手／爆頭的那一下」才切，正好卡在打擊瞬間（手機上明顯頓一下）。
 * 現在三種切法都寫成可以分段執行的產生器（generator）：霧屍一出場就排進背景佇列，
 * 每幀只用幾毫秒、或趁瀏覽器空檔慢慢切好；真的來不及時才在當下一次做完（同一個產生器接著跑，不會重做）。
 */

/** 有伸出前臂、可以挖掉的影格：走路、攻擊、中槍後退、受擊、站起最後一格 */
const ARM_FRAMES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 17, 25]);
/** 爬行用的兩格（底圖的落地、撐起上身） */
const CRAWL_SRC = [21, 22];
/** 爬行影格裡，腿從第幾列以下才切（上面是舉起來的手） */
const LEG_ROW = 34;
const STUMP = [0x7a, 0x12, 0x12];
const STUMP_DARK = [0x4e, 0x0a, 0x0a];

/** 爬行影格的資訊：頭的位置（頭飾、標記用）、頭從哪一欄開始（爆頭時切掉）、身體中心 */
export interface CrawlInfo {
  head: { x: number; y: number }[];
  /** 頭的左緣：屍體從這欄以右切掉就是沒有頭 */
  neckX: number;
  /** 身體左右中心（origin x 用） */
  cx: number;
}

const crawlInfo = new Map<string, CrawlInfo>();

export function crawlInfoOf(key: string): CrawlInfo | undefined {
  return crawlInfo.get(key.replace(/~crawl$/, '') + '~crawl');
}

/** 能不能斷肢：只有一般人形霧屍的合成貼圖可以 */
export function canDismember(scene: Phaser.Scene, key: string): boolean {
  return widenOf(key) !== null && !!goreBase(scene, key) && scene.textures.get(key).has('25');
}

// ───────────────────────── 背景預切 ─────────────────────────

type Job = Generator<void, string | null, void>;

/** 正在切（或排隊中）的工作，以輸出 key 為索引；同步呼叫會接著跑同一個工作 */
const running = new Map<string, Job>();
/** 排隊的輸出 key（前面的先做） */
const queue: { out: string; make: () => Job }[] = [];
let pumping = false;

/** 跑完一個工作（同步） */
function finish(out: string, make: () => Job): string | null {
  let job = running.get(out);
  if (!job) {
    job = make();
    running.set(out, job);
  }
  let r = job.next();
  while (!r.done) r = job.next();
  running.delete(out);
  // 同一個工作被兩邊接著跑時，後到的那邊只拿到「已結束」：結果就是做好的那張
  return r.value === undefined ? out : r.value;
}

/** 在另一個工作裡接著跑（共用同一個進行中的工作），跑完回傳結果 */
function* delegate(out: string, make: () => Job): Job {
  let job = running.get(out);
  if (!job) {
    job = make();
    running.set(out, job);
  }
  let r = job.next();
  while (!r.done) {
    yield;
    r = job.next();
  }
  running.delete(out);
  return r.value === undefined ? out : r.value;
}

/** 背景：每次最多用 budget 毫秒推進佇列裡的工作 */
function pump(budget: number): void {
  const end = performance.now() + budget;
  while (queue.length && performance.now() < end) {
    const { out, make } = queue[0];
    let job = running.get(out);
    if (!job) {
      job = make();
      running.set(out, job);
    }
    let r = job.next();
    while (!r.done && performance.now() < end) r = job.next();
    if (r.done) {
      running.delete(out);
      queue.shift();
    }
  }
}

function schedule(): void {
  if (pumping || !queue.length) return;
  pumping = true;
  const ric = (window as unknown as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const tick = (budget: number) => {
    pumping = false;
    pump(budget);
    schedule();
  };
  // 有空檔就用空檔（最多 6 ms，避免一次吃太多）；沒有 requestIdleCallback 的瀏覽器（Safari）每幀給 3 ms
  if (ric) ric((d) => tick(Math.min(6, Math.max(2, d.timeRemaining()))), { timeout: 120 });
  else setTimeout(() => tick(3), 16);
}

/**
 * 把一張霧屍貼圖的斷肢版本排進背景預切（出場時呼叫）。
 * urgent：場上已經有這個外觀的霧屍，排到最前面。
 */
export function warmGore(scene: Phaser.Scene, key: string, urgent = false): void {
  if (!canDismember(scene, key)) return;
  const jobs: { out: string; make: () => Job }[] = [
    // 爆頭碎塊最常用（每次爆頭擊殺），先切
    { out: `${key}~parts`, make: () => buildParts(scene, key) },
    { out: `${key}~arm`, make: () => buildArmless(scene, key) },
    { out: `${key}~crawl`, make: () => buildCrawl(scene, key, false) },
    { out: `${key}~arm~crawl`, make: () => buildCrawl(scene, key, true) },
  ].filter((j) => !scene.textures.exists(j.out) && !queue.some((q) => q.out === j.out));
  if (!jobs.length) return;
  if (urgent) {
    // 正在切的那個保持在最前面，不打斷
    const head = queue.length && running.has(queue[0].out) ? 1 : 0;
    queue.splice(head, 0, ...jobs);
  } else queue.push(...jobs);
  schedule();
}

/** 讀出整張貼圖的像素 */
function pixels(scene: Phaser.Scene, key: string): ImageData {
  const src = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const cx = cv.getContext('2d')!;
  cx.drawImage(src, 0, 0);
  return cx.getImageData(0, 0, cv.width, cv.height);
}

/** 合成時每格以身體中心水平加寬過；輸出的第 X 欄對回底圖的第幾欄 */
function srcX(base: GoreBase, widen: number, f: number, X: number): number {
  if (Math.abs(widen - 1) < 0.01) return X;
  const F = base.size;
  const cxm = base.center(f);
  const w = Math.round(F * widen);
  const dx = Math.round(cxm - cxm * widen);
  return Math.floor(((X - dx) * F) / w);
}

/** 底圖某格的前臂遮罩（加寬前座標）：軀幹右緣 +5 欄以外、脖子以下、褲子以上的非上衣像素，取 ≥ 8 點的連通塊 */
const armCache = new WeakMap<GoreBase, Map<number, Uint8Array>>();
function armMask(base: GoreBase, f: number): Uint8Array | null {
  if (!ARM_FRAMES.has(f)) return null;
  const F = base.size;
  let cache = armCache.get(base);
  if (!cache) armCache.set(base, (cache = new Map()));
  const hit = cache.get(f);
  if (hit) return hit;
  const m = new Uint8Array(F * F);
  const r = base.torsoRight(f);
  if (r !== null) {
    const pt = base.pantsTop(f);
    const cand = new Uint8Array(F * F);
    for (let y = base.neck + 2; y <= Math.min(F - 1, pt + 1); y++) {
      for (let x = r + 5; x < F; x++) {
        const g = base.region(f, x, y);
        if (g !== GORE_REGION.none && g !== GORE_REGION.shirt) cand[y * F + x] = 1;
      }
    }
    // 8 連通塊，太小的（衣角、雜點）不算
    const seen = new Uint8Array(F * F);
    for (let i = 0; i < F * F; i++) {
      if (!cand[i] || seen[i]) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!;
        comp.push(j);
        const jx = j % F;
        const jy = (j / F) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = jx + dx;
            const ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= F || ny >= F) continue;
            const k = ny * F + nx;
            if (cand[k] && !seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          }
        }
      }
      if (comp.length >= 8) for (const j of comp) m[j] = 1;
    }
    // 手臂抬得比脖子列高時（巨屍駝背），上緣幾列沒一起挖掉會留下一條斷口色的細線：
    // 臉的右邊（頭頂錨點 +8 欄以外）往上補 3 列，其他地方只補外框
    const hx = base.headX(f);
    for (let y = F - 1; y > 0; y--) {
      for (let x = r + 5; x < F; x++) {
        if (!m[y * F + x]) continue;
        const pastFace = hx !== null && x > hx + 8;
        for (let k = 1; k <= 3; k++) {
          const g = base.region(f, x, y - k);
          if (g === GORE_REGION.none || g === GORE_REGION.shirt || (!pastFace && g !== GORE_REGION.outline)) break;
          m[(y - k) * F + x] = 1;
        }
      }
    }
  }
  cache.set(f, m);
  return m;
}

function registerAnims(scene: Phaser.Scene, key: string, crawl: boolean): void {
  const fr = (list: number[]) => list.map((frame) => ({ key, frame }));
  if (scene.anims.exists(`${key}_walk`)) return;
  if (crawl) {
    scene.anims.create({ key: `${key}_walk`, frames: fr([0, 1]), frameRate: 3, repeat: -1 });
    scene.anims.create({ key: `${key}_attack`, frames: fr([1, 0, 1]), frameRate: 10 });
    return;
  }
  scene.anims.create({ key: `${key}_walk`, frames: fr([0, 1, 2, 3]), frameRate: 6, repeat: -1 });
  scene.anims.create({ key: `${key}_attack`, frames: fr([4, 4, 5, 5, 0]), frameRate: 14 });
  scene.anims.create({ key: `${key}_death`, frames: fr([6, 7, 8, 9, 10, 11, 12, 13, 14]), frameRate: 16 });
}

/** 挖掉的像素旁邊還在的像素塗成斷口的暗紅 */
function paintStump(d: Uint8ClampedArray, W: number, F: number, removed: Uint8Array, x0: number, x1: number): void {
  for (let y = 0; y < F; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (removed[i] || d[i * 4 + 3] === 0) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < x0 || nx >= x1 || ny < 0 || ny >= F) continue;
          if (removed[ny * W + nx]) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      const c = (x + y) % 3 === 0 ? STUMP_DARK : STUMP;
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
    }
  }
}

/** 斷手版本的貼圖 key；不能斷肢的回傳 null */
export function armlessTexture(scene: Phaser.Scene, key: string): string | null {
  const out = `${key}~arm`;
  if (scene.textures.exists(out)) return out;
  return finish(out, () => buildArmless(scene, key));
}

function* buildArmless(scene: Phaser.Scene, key: string): Job {
  const out = `${key}~arm`;
  if (scene.textures.exists(out)) return out;
  const base = goreBase(scene, key);
  const widen = widenOf(key);
  if (!base || widen === null) return null;
  const F = base.size;
  const img = pixels(scene, key);
  const W = img.width;
  const frames = Math.floor(W / F);
  const d = img.data;
  const removed = new Uint8Array(W * F);
  yield;
  for (let f = 0; f < frames; f++) {
    // 每格的前臂遮罩第一次要算連通塊（之後所有外觀共用快取），前後各讓一次
    if (ARM_FRAMES.has(f)) yield;
    const m = armMask(base, f);
    if (!m) continue;
    yield;
    for (let y = 0; y < F; y++) {
      for (let X = 0; X < F; X++) {
        const sx = srcX(base, widen, f, X);
        if (sx < 0 || sx >= F || !m[y * F + sx]) continue;
        const i = y * W + f * F + X;
        if (d[i * 4 + 3] === 0) continue;
        d[i * 4 + 3] = 0;
        removed[i] = 1;
      }
    }
    paintStump(d, W, F, removed, f * F, f * F + F);
  }
  yield;
  // 分段執行期間可能已被別人做好（理論上不會，保險）
  if (scene.textures.exists(out)) return out;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = F;
  cv.getContext('2d')!.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(out, cv)!;
  for (let f = 0; f < frames; f++) tex.add(f, 0, f * F, 0, F, F);
  registerAnims(scene, out, false);
  registerHeadFrames(scene, out, base.neck, F);
  return out;
}

/** 斷腳爬行版本的貼圖 key（2 格）；armless 為 true 時從斷手版本切 */
export function crawlTexture(scene: Phaser.Scene, key: string, armless = false): string | null {
  const out = `${key}${armless ? '~arm' : ''}~crawl`;
  if (scene.textures.exists(out)) return out;
  return finish(out, () => buildCrawl(scene, key, armless));
}

function* buildCrawl(scene: Phaser.Scene, key: string, armless: boolean): Job {
  let srcKey: string | null = key;
  if (armless) {
    // 先要有斷手版本（背景佇列裡斷手排在前面，通常已經好了）
    const armOut = `${key}~arm`;
    srcKey = scene.textures.exists(armOut) ? armOut : yield* delegate(armOut, () => buildArmless(scene, key));
  }
  if (!srcKey) return null;
  const out = `${srcKey}~crawl`;
  if (scene.textures.exists(out)) return out;
  const base = goreBase(scene, key);
  const widen = widenOf(key);
  if (!base || widen === null) return null;
  const F = base.size;
  const img = pixels(scene, srcKey);
  const W = img.width;
  const d = img.data;
  const cv = document.createElement('canvas');
  cv.width = F * CRAWL_SRC.length;
  cv.height = F;
  const cx = cv.getContext('2d')!;
  const dst = cx.createImageData(cv.width, F);
  const o = dst.data;
  const info: CrawlInfo = { head: [], neckX: F, cx: F / 2 };
  let minX = F;
  let maxX = 0;
  for (let n = 0; n < CRAWL_SRC.length; n++) {
    const f = CRAWL_SRC[n];
    yield;
    // 切點：腿那幾列裡上衣最右邊的那欄（再往右就是褲子、鞋子）
    let cut = 0;
    for (let y = LEG_ROW + 2; y < F; y++) {
      for (let X = 0; X < F; X++) {
        const sx = srcX(base, widen, f, X);
        if (base.region(f, sx, y) === GORE_REGION.shirt) cut = Math.max(cut, X);
      }
    }
    const removed = new Uint8Array(F * F);
    const keep = new Uint8Array(F * F);
    // 頭：躺著的原圖頭在左邊，上衣最左欄以左、腿那幾列以上的就是頭
    let shirtL = F;
    for (let y = 0; y < F; y++) {
      for (let X = 0; X < F; X++) {
        if (base.region(f, srcX(base, widen, f, X), y) === GORE_REGION.shirt) shirtL = Math.min(shirtL, X);
      }
    }
    let headL = F;
    let headR = 0;
    let headT = F;
    for (let y = 0; y < F; y++) {
      for (let X = 0; X < F; X++) {
        const i = y * W + f * F + X;
        if (d[i * 4 + 3] === 0) continue;
        if (X > cut + 1 && y >= LEG_ROW) {
          removed[y * F + X] = 1;
          continue;
        }
        keep[y * F + X] = 1;
        if (X < shirtL) {
          headL = Math.min(headL, X);
          headR = Math.max(headR, X);
          headT = Math.min(headT, y);
        }
      }
    }
    // 複製（左右翻轉：原圖頭在左，翻成頭朝前＝朝右，和走路圖同方向）
    for (let y = 0; y < F; y++) {
      for (let X = 0; X < F; X++) {
        if (!keep[y * F + X]) continue;
        const i = (y * W + f * F + X) * 4;
        const MX = F - 1 - X;
        const j = (y * cv.width + n * F + MX) * 4;
        let near = false;
        if (y >= LEG_ROW) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (removed[(y + dy) * F + X + dx]) near = true;
        const c = near ? ((X + y) % 3 === 0 ? STUMP_DARK : STUMP) : [d[i], d[i + 1], d[i + 2]];
        o[j] = c[0];
        o[j + 1] = c[1];
        o[j + 2] = c[2];
        o[j + 3] = 255;
        minX = Math.min(minX, MX);
        maxX = Math.max(maxX, MX);
      }
    }
    info.head.push({ x: F - 1 - (headL + headR) / 2, y: headT });
    // 翻轉後頭在右邊：頭的左緣＝原圖頭的右緣
    info.neckX = Math.min(info.neckX, F - 1 - headR);
  }
  yield;
  if (scene.textures.exists(out)) return out;
  cx.putImageData(dst, 0, 0);
  info.cx = (minX + maxX + 1) / 2;
  const tex = scene.textures.addCanvas(out, cv)!;
  CRAWL_SRC.forEach((_, n) => tex.add(n, 0, n * F, 0, F, F));
  crawlInfo.set(out, info);
  registerAnims(scene, out, true);
  return out;
}

/** 飛出去的碎塊（前臂、一條腿、頭的碎片），全部取自第 0 格 */
export function goreParts(scene: Phaser.Scene, key: string): string | null {
  const out = `${key}~parts`;
  if (scene.textures.exists(out)) return out;
  return finish(out, () => buildParts(scene, key));
}

function* buildParts(scene: Phaser.Scene, key: string): Job {
  const out = `${key}~parts`;
  if (scene.textures.exists(out)) return out;
  const base = goreBase(scene, key);
  const widen = widenOf(key);
  if (!base || widen === null) return null;
  const F = base.size;
  const img = pixels(scene, key);
  const W = img.width;
  const d = img.data;
  const cv = document.createElement('canvas');
  cv.width = F * 3;
  cv.height = F;
  const cx = cv.getContext('2d')!;
  const dst = cx.createImageData(cv.width, F);
  const o = dst.data;
  const box = [0, 1, 2].map(() => ({ l: F, r: -1, t: F, b: -1 }));
  const put = (slot: number, X: number, y: number) => {
    const i = (y * W + X) * 4;
    const j = (y * cv.width + slot * F + X) * 4;
    for (let k = 0; k < 4; k++) o[j + k] = d[i + k];
    const bx = box[slot];
    bx.l = Math.min(bx.l, X);
    bx.r = Math.max(bx.r, X);
    bx.t = Math.min(bx.t, y);
    bx.b = Math.max(bx.b, y);
  };
  yield;
  const m = armMask(base, 0)!;
  const pt = base.pantsTop(0);
  yield;
  // 以身體中心為軸加寬，中心位置不變
  const mid = Math.round(base.center(0));
  // 頭的碎片只取頭頂錨點左右 11 欄內（巨屍駝背，脖子列以上還有上背和背包）
  const hx = base.headX(0);
  for (let y = 0; y < F; y++) {
    for (let X = 0; X < F; X++) {
      if (d[(y * W + X) * 4 + 3] === 0) continue;
      const sx = srcX(base, widen, 0, X);
      if (sx >= 0 && sx < F && m[y * F + sx]) put(0, X, y);
      else if (y >= pt + 3 && X < mid) put(1, X, y);
      else if (y < base.neck && (hx === null || Math.abs(sx - hx) <= 11)) put(2, X, y);
    }
  }
  yield;
  if (scene.textures.exists(out)) return out;
  cx.putImageData(dst, 0, 0);
  const tex = scene.textures.addCanvas(out, cv)!;
  const add = (name: string, slot: number, l: number, t: number, w: number, h: number) => {
    if (w > 0 && h > 0) tex.add(name, 0, slot * F + l, t, w, h);
  };
  const [a, l, h] = box;
  add('arm', 0, a.l, a.t, a.r - a.l + 1, a.b - a.t + 1);
  add('leg', 1, l.l, l.t, l.r - l.l + 1, l.b - l.t + 1);
  // 頭切成 3×2 塊
  const hw = h.r - h.l + 1;
  const hh = h.b - h.t + 1;
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const x0 = h.l + Math.floor((hw * gx) / 3);
      const x1 = h.l + Math.floor((hw * (gx + 1)) / 3);
      const y0 = h.t + Math.floor((hh * gy) / 2);
      const y1 = h.t + Math.floor((hh * (gy + 1)) / 2);
      add(`h${gy * 3 + gx}`, 2, x0, y0, x1 - x0, y1 - y0);
    }
  }
  return out;
}

