/**
 * 可重現的亂數（mulberry32）。同一個種子永遠產生同一串數字，
 * 隊員外觀、特質都用它生成，存檔只要記結果，除錯時也能用種子重現。
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** 0 ≤ x < 1 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min ≤ n ≤ max 的整數 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  /** 依權重挑一個；權重 ≤ 0 的不會被挑到。全部是 0 時回傳 undefined */
  weighted<T>(list: readonly T[], weight: (item: T) => number): T | undefined {
    let total = 0;
    for (const it of list) total += Math.max(0, weight(it));
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of list) {
      const w = Math.max(0, weight(it));
      if (r < w) return it;
      r -= w;
    }
    return list[list.length - 1];
  }
}

/** 新的隨機種子 */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

/** 把字串雜湊成種子（舊存檔沒有種子時，用隊員 id 換一個固定的） */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
