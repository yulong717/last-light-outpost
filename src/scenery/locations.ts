import Phaser from 'phaser';
import { ARRIVAL_SETS, EVENT_SETS, THEMES, floorLaneFor, getOutpostMap, type SetDressing } from '../data/scenery';
import { buildScenery, type SceneryResult } from './SceneryBuilder';

/**
 * 依「在哪裡、發生什麼事」組出場景：探索戰鬥、事件卡背景、守城據點三種用途。
 */

/** 這個區域沒有指定佈置時，預設在室內還是室外 */
const ZONE_DEFAULT: Record<string, 'ext' | 'int'> = {
  gas: 'ext',
  market: 'int',
  homes: 'ext',
  hospital: 'int',
  police: 'int',
  checkpoint: 'ext',
};

export function setFor(zoneId: string, eventId?: string): SetDressing {
  return (eventId && EVENT_SETS[eventId]) || { setting: ZONE_DEFAULT[zoneId] ?? 'ext', pieces: [] };
}

/** 探索裡的潛入／戰鬥小關卡 */
export function fieldScenery(scene: Phaser.Scene, zoneId: string, eventId: string | undefined, worldW: number, keepClear: [number, number][], extras = 4): SceneryResult {
  const theme = THEMES[zoneId] ?? THEMES.gas;
  const set = setFor(zoneId, eventId);
  return buildScenery(scene, {
    theme,
    setting: set.setting,
    facade: set.facade,
    interior: set.interior,
    mood: set.mood,
    worldW,
    seed: `${zoneId}-${eventId ?? 'none'}-${Math.random()}`,
    pieces: set.pieces,
    extras: set.noExtras ? 0 : extras,
    decor: 1,
    keepClear,
  });
}

/** 事件卡左邊的場景插圖（640 寬的靜態畫面，擺件集中在 span 範圍內） */
export function backdropScenery(scene: Phaser.Scene, zoneId: string, eventId: string | null, span: [number, number]): SceneryResult {
  const theme = THEMES[zoneId] ?? THEMES.gas;
  const set = eventId ? setFor(zoneId, eventId) : ARRIVAL_SETS[zoneId] ?? { setting: 'ext', pieces: [] };
  // 戰鬥事件的佈置是照整個關卡寬度擺的；當插圖時只取前幾個主要擺件，擠在可見範圍內
  const pieces = set.pieces
    .filter((p) => p.prop !== 'tubelight' && p.prop !== 'fusebox')
    .slice(0, 5)
    .map((p, i, arr) => ({ ...p, x: arr.length === 1 ? 0.5 : 0.12 + (0.76 * i) / (arr.length - 1) }));
  return buildScenery(scene, {
    theme,
    setting: set.setting,
    facade: set.facade,
    interior: set.interior,
    mood: set.mood,
    worldW: 640,
    seed: `bg-${zoneId}-${eventId ?? 'arrive'}`,
    pieces,
    extras: 1,
    decor: 0.6,
    span,
  });
}

/** 守城據點：選好的地圖 */
export function outpostScenery(scene: Phaser.Scene, mapId: string | undefined, worldW: number, day: number): SceneryResult {
  const map = getOutpostMap(mapId);
  const theme = THEMES[map.theme];
  const res = buildScenery(scene, {
    theme,
    setting: 'ext',
    facade: map.facade,
    mood: 'dim',
    worldW,
    seed: `outpost-${map.id}`,
    pieces: [
      ...map.pieces,
      // 多樓層據點：放在各層的地板上，不然會飄在樓層之間
      ...map.barrels.map((x, i) => ({ prop: 'barrel', x, lane: floorLaneFor(map, i) ?? ((i % 3 === 0 ? 'back' : i % 3 === 1 ? 'mid' : 'front') as 'back' | 'mid' | 'front') })),
      ...map.crates.map((x, i) => ({ prop: 'crate', x, lane: floorLaneFor(map, i + 1) ?? ('back' as const) })),
    ],
    extras: 0,
    decor: map.floors && !map.floors.levels[0].band ? 0 : 1.2,
    // 據點外牆、路障、建築槽位附近不要擺東西
    keepClear: map.keepClear ?? [[0, 430]],
  });
  void day;
  return res;
}
