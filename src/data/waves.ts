import { PROFESSIONS } from './zombies';
export interface SpawnGroup {
  enemy: string;
  count: number;
  /** 同組兩隻之間的間隔（秒） */
  interval: number;
  /** 這波開始後過幾秒才出第一隻（菁英晚一點登場） */
  startDelay?: number;
}

export interface WaveDef {
  groups: SpawnGroup[];
  /** 這一波開始前的休息秒數 */
  delayBefore: number;
}

/**
 * 第一個夜晚的波次。之後會改由「天數 + 灰霧濃度」動態生成，
 * 目前先寫死，方便調整手感。
 */
export const NIGHT_ONE: WaveDef[] = [
  { delayBefore: 2, groups: [{ enemy: 'basic', count: 8, interval: 1.4 }] },
  {
    delayBefore: 5,
    groups: [
      { enemy: 'basic', count: 10, interval: 1.0 },
      { enemy: 'runner', count: 4, interval: 2.2 },
    ],
  },
  {
    delayBefore: 5,
    groups: [
      { enemy: 'basic', count: 12, interval: 0.8 },
      { enemy: 'runner', count: 6, interval: 1.6 },
      { enemy: 'brute', count: 2, interval: 8 },
    ],
  },
];

/**
 * 依天數產生一整夜的波次。第一夜沿用上面手調的 NIGHT_ONE；
 * 之後用「威脅點數預算」挑職業：天數越大預算越多、波數越多，
 * 新解鎖的職業在解鎖當天和隔天權重加倍，讓玩家先認識牠。
 * 每一波的第一組永遠是平民霧屍，最後一波保證有一組菁英（威脅 ≥ 5）。
 */
export function buildNight(day: number, rand: () => number = Math.random): WaveDef[] {
  if (day <= 1) return NIGHT_ONE;
  const waves = Math.min(6, 3 + Math.floor((day - 1) / 2));
  const base = 10 + 5 * day;
  const out: WaveDef[] = [];
  const unlocked = Object.values(PROFESSIONS).filter((p) => p.unlockDay <= day);
  for (let w = 0; w < waves; w++) {
    let budget = base * (0.6 + 0.4 * w);
    const counts: Record<string, number> = {};
    const add = (id: string) => {
      counts[id] = (counts[id] ?? 0) + 1;
      budget -= PROFESSIONS[id].threat;
    };
    // 平民墊底：約三分之一預算
    const civ = Math.max(4, Math.round((budget * 0.35) / PROFESSIONS.basic.threat));
    for (let i = 0; i < civ; i++) add('basic');
    if (w === waves - 1) {
      const elites = unlocked.filter((p) => p.threat >= 5);
      if (elites.length) add(elites[Math.floor(rand() * elites.length)].id);
    }
    // 第一波不出重型
    const pool = unlocked.filter((p) => p.id !== 'basic' && (w > 0 || p.threat <= 3));
    let guard = 200;
    while (budget > 0.5 && guard-- > 0 && pool.length) {
      const weights = pool.map((p) => p.weight * (day - p.unlockDay <= 1 ? 2 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rand() * total;
      let chosen = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          chosen = pool[i];
          break;
        }
      }
      if (chosen.threat > budget + 1) {
        // 預算快用完時改補便宜的
        add('basic');
        continue;
      }
      // 屍犬、屍鴉成群出現
      for (let k = 0; k < (chosen.pack ?? 1); k++) add(chosen.id);
    }
    const speedUp = 1 + day * 0.05;
    const groups: SpawnGroup[] = [];
    for (const [enemy, count] of Object.entries(counts)) {
      const def = PROFESSIONS[enemy];
      if (def.pack) {
        // 成群的動物：一群一組，群與群之間隔幾秒
        for (let k = 0, left = count; left > 0; k++, left -= def.pack) {
          groups.push({ enemy, count: Math.min(def.pack, left), interval: 0.35, startDelay: 3 + k * 6 });
        }
        continue;
      }
      groups.push({
        enemy,
        count,
        interval: +(Math.max(0.5, def.threat * 0.9) / speedUp + (enemy === 'basic' ? 0.4 : 0.8)).toFixed(2),
        startDelay: def.threat >= 5 ? 4 : def.threat >= 3 ? 2 : 0,
      });
    }
    // 平民先出、菁英最後
    groups.sort((a, b) => PROFESSIONS[a.enemy].threat - PROFESSIONS[b.enemy].threat);
    out.push({ delayBefore: w === 0 ? 2 : 5, groups });
  }
  return out;
}
