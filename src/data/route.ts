import { getZone, type ZoneDef } from './explore';

/**
 * 路線圖：主角帶著隊伍一邊搜刮、一邊找能過夜的地方。
 * 每天白天有一條時間條（08:00～18:00）。沿路線移動、搜刮都要花時間；
 * 走到據點可以選擇在那裡過夜，時間用完就只能退回最後經過的據點防守。
 * 說明見 docs/ROUTE.md。
 */

/** 白天幾點出發、有幾個小時 */
export const DAY_START = 8;
export const DAY_HOURS = 10;

export type RouteNodeKind = 'start' | 'explore' | 'outpost';

export interface RouteNode {
  id: string;
  kind: RouteNodeKind;
  name: string;
  /** 地圖座標（和 ZONES 的 mapX/mapY 同一套：x 0～600、y 90～280） */
  x: number;
  y: number;
  /**
   * 探索區域。explore 節點一定有；outpost 節點有的話代表「據點兼探索點」：
   * 可以在這裡搜刮，也可以在這裡過夜防守。
   */
  zone?: string;
  /** outpost：守夜的戰場地圖（src/data/scenery.ts 的 OUTPOST_MAPS） */
  map?: string;
  blurb?: string;
}

export const ROUTE_NODES: RouteNode[] = [
  { id: 'school_gate', kind: 'start', name: '學校後門', x: 50, y: 160, blurb: '你逃出來的地方。回不去了。' },
  // ── 據點 ──
  { id: 'alley', kind: 'outpost', name: '後巷鐵捲門', x: 150, y: 185, map: 'alley' },
  // 據點兼探索點：鬧區裡的五金行（搜刮鬧區、在五金行過夜）
  { id: 'street', kind: 'outpost', name: '鬧區・五金行', x: 330, y: 265, map: 'street', zone: 'downtown' },
  { id: 'schoolyard', kind: 'outpost', name: '光明國小', x: 235, y: 100, map: 'school' },
  // 據點兼探索點：廢棄加油站（搜刮加油站、在便利商店過夜）
  { id: 'gasstation', kind: 'outpost', name: '廢棄加油站', x: 120, y: 250, map: 'gasstation', zone: 'gas' },
  { id: 'islandshop', kind: 'outpost', name: '孤島小店', x: 368, y: 178, map: 'islandshop', blurb: '路口正中間的便利商店，兩邊都會有霧屍來。' },
  // 多樓層據點：三層樓的爛尾樓，霧屍會爬鷹架上樓
  { id: 'tower', kind: 'outpost', name: '爛尾樓工地', x: 498, y: 172, map: 'tower', blurb: '停工的三層樓骨架。1F、2F 都要守，霧屍還會沿鷹架爬上頂樓。' },
  // 兩層樓透天厝：一樓守鐵門、二樓陽台往下打，守不住就退上二樓
  { id: 'house', kind: 'outpost', name: '巷口透天厝', x: 100, y: 108, map: 'house', blurb: '一樓鐵門、二樓陽台的老透天厝。鐵門被撞開就只能退上二樓。' },
  // ── 探索點（區域） ──
  { id: 'homes', kind: 'explore', name: '', x: 0, y: 0, zone: 'homes' },
  { id: 'market', kind: 'explore', name: '', x: 0, y: 0, zone: 'market' },
  { id: 'nightmarket', kind: 'explore', name: '', x: 0, y: 0, zone: 'nightmarket' },
  { id: 'hospital', kind: 'explore', name: '', x: 0, y: 0, zone: 'hospital' },
  { id: 'police', kind: 'explore', name: '', x: 0, y: 0, zone: 'police' },
  { id: 'checkpoint', kind: 'explore', name: '', x: 0, y: 0, zone: 'checkpoint' },
].map((n) => {
  // 探索點的名稱與位置直接用區域的資料
  if (n.kind !== 'explore') return n as RouteNode;
  const z = getZone(n.zone!)!;
  return { ...n, kind: 'explore', name: z.name, x: z.mapX, y: z.mapY, blurb: z.blurb } as RouteNode;
});

/** 路線：[a, b, 路程時數] */
export const ROUTE_EDGES: [string, string, number][] = [
  ['school_gate', 'alley', 1],
  ['school_gate', 'gasstation', 1],
  ['school_gate', 'homes', 2],
  ['alley', 'gasstation', 1],
  ['alley', 'homes', 1],
  ['alley', 'market', 1],
  ['gasstation', 'street', 2],
  ['market', 'street', 1],
  ['market', 'schoolyard', 1],
  ['homes', 'schoolyard', 1],
  ['schoolyard', 'nightmarket', 1],
  ['nightmarket', 'hospital', 2],
  ['street', 'police', 2],
  ['hospital', 'police', 2],
  ['hospital', 'checkpoint', 2],
  ['market', 'islandshop', 1],
  ['street', 'islandshop', 1],
  ['islandshop', 'hospital', 2],
  ['islandshop', 'police', 2],
  ['police', 'checkpoint', 2],
  ['islandshop', 'tower', 1],
  ['hospital', 'tower', 1],
  ['police', 'tower', 1],
  ['tower', 'checkpoint', 2],
  ['school_gate', 'house', 1],
  ['house', 'homes', 1],
  ['house', 'alley', 2],
];

export function getNode(id: string | undefined): RouteNode | undefined {
  return ROUTE_NODES.find((n) => n.id === id);
}

/** 這裡能不能搜刮（探索點，或兼探索點的據點） */
export function canExplore(n: RouteNode): boolean {
  return !!n.zone && n.kind !== 'start';
}

/** 相鄰的地點與路程 */
export function neighbors(id: string): { node: RouteNode; hours: number }[] {
  const out: { node: RouteNode; hours: number }[] = [];
  for (const [a, b, h] of ROUTE_EDGES) {
    const other = a === id ? b : b === id ? a : null;
    const n = other ? getNode(other) : undefined;
    if (n) out.push({ node: n, hours: h });
  }
  return out;
}

export function travelHours(from: string, to: string): number | null {
  return neighbors(from).find((x) => x.node.id === to)?.hours ?? null;
}

/** 在探索點搜刮要花幾小時：近區 2 小時、遠區 4 小時 */
export function exploreHours(zone: ZoneDef): number {
  return zone.time * 2;
}

/** 現在幾點（字串），hoursLeft 是今天還剩幾小時 */
export function clockText(hoursLeft: number): string {
  const h = DAY_START + DAY_HOURS - Math.max(0, hoursLeft);
  return `${String(Math.floor(h)).padStart(2, '0')}:00`;
}

/** 離這裡最近的據點（照路程時數），時間用完又沒經過據點時用 */
export function nearestOutpost(from: string): RouteNode | undefined {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    queue.sort((a, b) => dist.get(a)! - dist.get(b)!);
    const cur = queue.shift()!;
    for (const { node, hours } of neighbors(cur)) {
      const d = dist.get(cur)! + hours;
      if (d < (dist.get(node.id) ?? Infinity)) {
        dist.set(node.id, d);
        queue.push(node.id);
      }
    }
  }
  return ROUTE_NODES.filter((n) => n.kind === 'outpost' && dist.has(n.id)).sort((a, b) => dist.get(a.id)! - dist.get(b.id)!)[0];
}
