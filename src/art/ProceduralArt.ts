import Phaser from 'phaser';

/**
 * 用程式畫的像素圖（不用任何外部工具）。
 * 規則：整數像素、固定調色盤、1px 深色外框，和 PixelLab 的角色風格對齊。
 */

/** 路障：3 格 28×56（0 完好、1 破損、2 快垮），木板 + 鐵皮 + 釘子 */
export const BARRICADE_FRAMES = 3;

const WOOD = [0x4a3324, 0x6d4c33, 0x8d6e4a, 0xa9875f];
const METAL = [0x2f343c, 0x4b525c, 0x6c7480];
const OUTLINE = 0x120d0a;

export function createBarricadeTexture(scene: Phaser.Scene, key = 'barricade'): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const W = 28;
  const H = 56;
  const t = scene.textures.createCanvas(key, W * BARRICADE_FRAMES, H)!;
  const ctx = t.getContext();
  const rnd = new Phaser.Math.RandomDataGenerator(['barricade']);
  const px = (x: number, y: number, c: number, w = 1, h = 1): void => {
    ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
    ctx.fillRect(x, y, w, h);
  };

  for (let f = 0; f < BARRICADE_FRAMES; f++) {
    const ox = f * W;
    // 直立的兩根樁
    for (const sx of [3, W - 7]) {
      px(ox + sx - 1, 4, OUTLINE, 6, H - 4);
      px(ox + sx, 5, WOOD[1], 4, H - 6);
      px(ox + sx, 5, WOOD[2], 1, H - 6);
    }
    // 橫木板，破損程度越高掉越多塊
    const planks = [8, 17, 26, 35, 44];
    planks.forEach((py, i) => {
      if (f >= 1 && i === 1) return;
      if (f >= 2 && (i === 3 || i === 0)) return;
      const tilt = (i % 2 === 0 ? 1 : -1) * (f === 2 ? 2 : 0);
      for (let x = 0; x < W; x++) {
        const y = py + Math.round((tilt * (x - W / 2)) / W);
        px(ox + x, y - 1, OUTLINE);
        px(ox + x, y, WOOD[2 + (x % 7 === 0 ? 1 : 0)]);
        px(ox + x, y + 1, WOOD[1]);
        px(ox + x, y + 2, WOOD[1]);
        px(ox + x, y + 3, WOOD[0]);
        px(ox + x, y + 4, OUTLINE);
      }
      // 木紋
      for (let k = 0; k < 3; k++) px(ox + rnd.between(1, W - 4), py + rnd.between(1, 2), WOOD[0], rnd.between(2, 4), 1);
      // 釘子
      px(ox + 4, py + 1, METAL[2]);
      px(ox + W - 5, py + 1, METAL[2]);
    });
    // 中間一片鐵皮（完好時）
    if (f === 0) {
      px(ox + 9, 20, OUTLINE, 11, 13);
      px(ox + 10, 21, METAL[1], 9, 11);
      px(ox + 10, 21, METAL[2], 9, 1);
      px(ox + 10, 31, METAL[0], 9, 1);
      px(ox + 12, 24, 0x7a3b22, 3, 2); // 鏽
    }
    // 裂縫與缺口
    if (f >= 1) {
      for (let k = 0; k < 4 + f * 4; k++) px(ox + rnd.between(2, W - 3), rnd.between(6, H - 6), OUTLINE, 1, rnd.between(1, 3));
    }
    t.add(f, 0, ox, 0, W, H);
  }
  t.refresh();
}

/**
 * 從角色精靈圖每一格切出「頭」當成新影格 head_0、head_1…，
 * 爆頭時讓頭飛出去用。回傳脖子所在列（影格內 y）。
 */
export function registerHeadFrames(scene: Phaser.Scene, key: string, neckRow: number, frameSize = 64): void {
  const tex = scene.textures.get(key);
  const total = tex.frameTotal - 1; // 扣掉 __BASE
  for (let i = 0; i < total; i++) {
    const fr = tex.get(i);
    if (tex.has(`head_${i}`)) continue;
    tex.add(`head_${i}`, fr.sourceIndex, fr.cutX, fr.cutY, frameSize, neckRow);
  }
}
