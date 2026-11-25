import type { ComicScript } from '../comic/types';

/**
 * 劇情漫畫演出的劇本（序章開場、過場、角色介紹）。格式見 src/comic/types.ts，寫法見 docs/COMIC_CINEMATICS.md。
 *
 * 版面規則（640×360）：
 * - 不用固定網格：每格位置、大小、角度依劇情張力決定，留 10～16px 的黑色間隔
 * - 先出現的格子放在視線先到的地方（左上），重大事件可以蓋過其他格子
 * - 一格只講一個瞬間：建立場景 → 發現異常 → 異常發生 → 採取行動 → 重大事件 → 收束
 */

export const CINEMATICS: Record<string, ComicScript> = {
  /** 序章開場：放學後，阿凱在頂樓醒來 */
  prologue_intro: {
    id: 'prologue_intro',
    skippable: true,
    mood: 'menu',
    beats: [
      // 1. 建立場景與角色
      {
        type: 'panel',
        id: 'roof',
        art: 'pro_roof',
        rect: { x: 14, y: 12, w: 400, h: 150 },
        tilt: -1,
        enter: 'slide-left',
        cam: { from: { zoom: 1, x: 0.2, y: 0.5 }, to: { zoom: 1.12, x: 0.75, y: 0.6 }, dur: 5200 },
        texts: [{ text: '午休的時候，你躲到頂樓水塔後面打盹。', x: 10, y: 8 }],
        hold: 2600,
      },
      // 2. 角色發現異常
      {
        type: 'panel',
        id: 'wake',
        art: 'pro_wake',
        rect: { x: 428, y: 18, w: 198, h: 180 },
        tilt: 1.5,
        enter: 'slide-right',
        cam: { from: { zoom: 1.15, y: 0.4 }, to: { zoom: 1 } , dur: 1800 },
        texts: [
          { text: '醒來的時候，太陽已經快下山了。', x: 8, y: 8, w: 120 },
          { text: '……幾點了？', kind: 'speech', x: 104, y: 138, tail: [92, 128], delay: 500 },
        ],
      },
      // 3. 異常事件發生
      {
        type: 'panel',
        id: 'yard',
        art: 'pro_yard',
        rect: { x: 26, y: 176, w: 280, h: 170 },
        enter: 'wipe-down',
        sound: 'car_alarm',
        cam: { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.5, x: 0.45, y: 0.55 }, dur: 3600 },
        texts: [{ text: '樓下很安靜。安靜得不像一間學校。', x: 10, y: 10, w: 150 }],
        sfx: [{ text: '嗚——', x: 226, y: 34, size: 14, angle: 6, color: '#ff8a6a', delay: 400 }],
      },
      // 4. 角色採取行動
      {
        type: 'panel',
        id: 'grab',
        art: 'pro_grab',
        rect: { x: 322, y: 214, w: 150, h: 132 },
        tilt: -2,
        enter: 'zoom',
        fx: ['dash'],
        texts: [{ text: '得下去看看。', kind: 'thought', x: 62, y: 96, tail: [40, 80] }],
        sfx: [{ text: '喀', x: 112, y: 30, size: 18, angle: 12 }],
        hold: 1500,
      },
      // 5. 重大事件：大格砸進來，蓋過其他格子；霧屍的手突破格子邊界
      {
        type: 'panel',
        id: 'door',
        art: 'pro_door',
        rect: { x: 158, y: 34, w: 471, h: 300 },
        tilt: 2,
        enter: 'slam',
        sound: 'glass_break',
        fx: ['speed'],
        cam: { from: { zoom: 1.25, x: 0.42, y: 0.32 }, to: { zoom: 1.05, x: 0.42, y: 0.36 }, dur: 900 },
        sfx: [
          { text: '砰！！', x: 330, y: 70, size: 34, angle: -12, color: '#ffef9a' },
          { text: '嘎啊啊', x: 96, y: 250, size: 16, angle: 8, color: '#d8f070', delay: 380 },
        ],
        pop: { art: 'pro_hand', x: 18, y: 236, scale: 3, from: [60, 0], delay: 200 },
        hold: 1300,
      },
      // 定格：這一刻停住，網點蓋上去
      { type: 'freeze', id: 'door', hold: 900, sound: 'zombie_scream' },
      // 6. 收束：大格退回版面的一角，所有格子形成完整的前因後果，接上正式操作
      { type: 'move', id: 'door', rect: { x: 486, y: 214, w: 140, h: 89 }, tilt: 3, dur: 480 },
      { type: 'focus', id: 'door', hold: 500 },
      { type: 'title', text: '序章　放學後', sub: '逃出學校。一層一層往下。', hold: 'tap' },
    ],
    endTap: false,
  },
};
