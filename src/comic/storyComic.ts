import type { HeroId } from '../data/heroes';
import { HEROES } from '../data/heroes';
import type { Beat, ComicScript, PanelBeat, PanelEnter } from './types';

export interface StoryComicSpec {
  id: string;
  title: string;
  lines: string[];
  /** 區域：插圖用那一區的關卡插圖（illus/<zone>） */
  zone?: string;
  /** 小字：這章的目標，放在最後的標題卡 */
  objective?: string;
  /** 角色介紹：第二格是這位主角的登場格 */
  hero?: HeroId;
}

const PAGE = { x: 14, y: 12, w: 612, top: 146, gap: 12, bottomY: 172, bottomH: 176 };
const ENTERS: PanelEnter[] = ['slide-up', 'wipe-right', 'unfold-x', 'slide-right'];
/** 下排每格的鏡頭焦點：從左到右掃過插圖的不同位置 */
const FOCUS = [0.3, 0.62, 0.45, 0.75];

/**
 * 用文字劇情（章節開場、收尾、主角序章）自動排出一頁漫畫演出：
 * 第一格是橫跨上排的大全景（建立場景，鏡頭橫搖）→（有主角時）主角登場格 → 下排每句一格，
 * 每格拿同一張關卡插圖的不同位置放大裁切 → 最後的標題卡打上章名與目標。
 *
 * 專屬插圖還沒有之前，所有劇情都先用這個排版；重要段落再到 src/data/cinematics.ts 手寫分鏡。
 */
export function storyComic(s: StoryComicSpec): ComicScript {
  const art = `illus/${s.zone ?? 'outpost'}`;
  const lines = s.lines.slice(0, 5);
  // 下排最多四格，多出來的句子併進最後一格
  const rest = lines.slice(1);
  const slots = Math.min(rest.length, s.hero ? 3 : 4);
  const groups: string[] = [];
  rest.forEach((l, i) => {
    const k = Math.min(i, slots - 1);
    groups[k] = groups[k] ? `${groups[k]}\n${l}` : l;
  });
  const beats: Beat[] = [
    {
      type: 'panel',
      id: 'est',
      art,
      rect: { x: PAGE.x, y: PAGE.y, w: PAGE.w, h: PAGE.top },
      tilt: -0.6,
      enter: 'slide-left',
      cam: { from: { zoom: 1.15, x: 0.12, y: 0.55 }, to: { zoom: 1.15, x: 0.88, y: 0.55 }, dur: 6000 },
      texts: lines[0] ? [{ text: lines[0], x: 10, y: 8, w: 300 }] : [],
    },
  ];
  // 下排：主角登場格放最右邊，句子格平分剩下的寬度
  const heroW = s.hero ? 150 : 0;
  const rowW = PAGE.w - (s.hero ? heroW + PAGE.gap : 0);
  const n = Math.max(1, groups.length);
  const cellW = Math.floor((rowW - PAGE.gap * (n - 1)) / n);
  if (s.hero) {
    const h = HEROES[s.hero];
    const r = { x: PAGE.x + rowW + PAGE.gap, y: PAGE.bottomY, w: heroW, h: PAGE.bottomH };
    const hero: PanelBeat = {
      type: 'panel',
      id: 'hero',
      art,
      rect: r,
      tilt: 1.5,
      enter: 'zoom',
      shade: 0.55,
      fx: ['speed'],
      cam: { from: { zoom: 2.6, x: 0.5, y: 0.75 } },
      sfx: [
        { text: h.name, x: r.w / 2, y: r.h - 38, size: 20, angle: -6, color: '#f5d76e', delay: 260 },
        { text: h.title, x: r.w / 2, y: r.h - 14, size: 9, angle: 0, color: '#e8e0cc', delay: 400 },
      ],
      pop: { art: `hero/${s.hero}`, x: r.w / 2, y: r.h * 0.42, scale: 3, from: [0, 40], delay: 120 },
      hold: 1600,
    };
    beats.push(hero);
  }
  groups.forEach((text, i) => {
    const r = { x: PAGE.x + i * (cellW + PAGE.gap), y: PAGE.bottomY, w: cellW, h: PAGE.bottomH };
    beats.push({
      type: 'panel',
      id: `l${i}`,
      art,
      rect: r,
      tilt: i % 2 ? 1.2 : -1,
      enter: ENTERS[i % ENTERS.length],
      cam: { from: { zoom: 1.55, x: FOCUS[i % FOCUS.length], y: 0.8 }, to: { zoom: 1.35, x: FOCUS[i % FOCUS.length] + 0.05, y: 0.75 } },
      texts: [{ text, x: 8, y: 8, w: cellW - 20 }],
    });
  });
  beats.push({ type: 'title', text: s.title, sub: s.objective, hold: 'tap' });
  return { id: s.id, beats, skippable: true, endTap: false };
}
