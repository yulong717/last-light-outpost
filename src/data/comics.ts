import type { QteGrade } from './explore';

/**
 * 招牌 QTE 事件的漫畫分鏡（美式漫畫：一格一格滑進來）。
 *
 * 流程（src/scenes/QteScene.ts 的漫畫模式，用共用的分格演出引擎 src/comic/ComicSequencer.ts）：
 *   第 1 格、第 2 格依序進場交代狀況 → 動作格揭開，QTE 就在這格裡進行
 *   → 結果格依結果（大成功／成功／失敗）換成不同的結果圖。
 *
 * 每格的圖在 src/art/ComicArt.ts（貼圖 key = comic_<事件>_<格>），同一格在不同區域會換上那一區的配色。
 * 新增招牌事件：這裡加一筆、ComicArt 的 PANELS 加五個畫圖函式，事件的 qte 動作填 comic: '<id>'。
 */

export interface ComicPanel {
  /** 左上角的旁白框 */
  caption: string;
  /** 畫面上的狀聲詞（大字、斜放） */
  sfx?: string;
}

export interface ComicDef {
  id: string;
  /** 前兩格：交代狀況 */
  setup: [ComicPanel, ComicPanel];
  /** 動作格的旁白（QTE 進行中） */
  action: string;
  /** 結果格 */
  result: Record<QteGrade, ComicPanel>;
}

export const GRADE_LABEL: Record<QteGrade, { text: string; color: string }> = {
  great: { text: '大成功！', color: '#ffd24a' },
  ok: { text: '成功', color: '#9ad17a' },
  fail: { text: '失敗……', color: '#ff6b6b' },
};

export const COMICS: Record<string, ComicDef> = {
  floor: {
    id: 'floor',
    setup: [
      { caption: '走廊到這裡就斷了。', sfx: '嘎吱……' },
      { caption: '黑洞底下，有東西在動。', sfx: '吼……' },
    ],
    action: '只剩幾根橫樑，一口氣跳過去！',
    result: {
      great: { caption: '三根橫樑一次跳完。對面還有個背包！', sfx: '咚！' },
      ok: { caption: '腳底一滑，總算抓住了邊緣。', sfx: '呼……' },
      fail: { caption: '橫樑斷了——', sfx: '喀啦！' },
    },
  },
  ambush: {
    id: 'ambush',
    setup: [
      { caption: '衣櫃裡好像有東西在抓門。', sfx: '嘰……' },
      { caption: '門一打開——', sfx: '嘎啊！' },
    ],
    action: '牠壓上來了！照順序甩開牠！',
    result: {
      great: { caption: '一腳把牠踹回衣櫃，一棒了結。', sfx: '砰！' },
      ok: { caption: '你把牠推倒在地，補上一下。', sfx: '咚！' },
      fail: { caption: '牙齒陷進你的手臂。', sfx: '嘶——' },
    },
  },
  door: {
    id: 'door',
    setup: [
      { caption: '鐵捲門卡在半空。', sfx: '嘎……' },
      { caption: '門縫後面，一整排物資箱。', sfx: '' },
    ],
    action: '用盡全力把門抬上去！',
    result: {
      great: { caption: '門一路推到頂，卡榫扣住了！', sfx: '喀鏘！' },
      ok: { caption: '門升到一半，夠鑽進去了。', sfx: '嘎嘎嘎' },
      fail: { caption: '手一軟，鐵捲門整片砸下來。', sfx: '轟隆！' },
    },
  },
  trap: {
    id: 'trap',
    setup: [
      { caption: '腳邊，一條幾乎看不見的細線。', sfx: '' },
      { caption: '線的另一頭，是一顆生鏽的手榴彈。', sfx: '滴……' },
    ],
    action: '穩住手，剪斷引線。',
    result: {
      great: { caption: '引信完整拆下來了。全是好零件。', sfx: '喀。' },
      ok: { caption: '剪斷了。你這才發現自己沒在呼吸。', sfx: '呼——' },
      fail: { caption: '剪錯了。', sfx: '轟！！' },
    },
  },
  chase: {
    id: 'chase',
    setup: [
      { caption: '樓上傳來急促的腳步聲。', sfx: '咚咚咚咚' },
      { caption: '一隻跑者從樓梯上撲了下來！', sfx: '嘎啊啊！' },
    ],
    action: '看準方向，閃開牠！',
    result: {
      great: { caption: '你一側身，牠自己摔下了樓梯。', sfx: '喀嚓！' },
      ok: { caption: '閃過了！回身就是一棒。', sfx: '砰！' },
      fail: { caption: '一人一屍滾下了半層樓。', sfx: '碰碰碰！' },
    },
  },
  dogs: {
    id: 'dogs',
    setup: [
      { caption: '車底下有低吼聲。', sfx: '嗚嚕嚕……' },
      { caption: '牠慢慢爬了出來，盯著你的喉嚨。', sfx: '' },
    ],
    action: '等牠撲過來的那一瞬間！',
    result: {
      great: { caption: '一棒正中鼻樑。', sfx: '鏘！' },
      ok: { caption: '牠夾著尾巴逃回車底。', sfx: '嗚嗚！' },
      fail: { caption: '牠咬住你的小腿不放。', sfx: '嘎嗚！' },
    },
  },
};
