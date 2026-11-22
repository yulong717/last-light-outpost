import Phaser from 'phaser';

/**
 * 據點建築的像素圖，全部用程式畫（規則同 ProceduralArt：整數像素、固定調色盤、1px 深色外框）。
 * 每張圖的原點都設在底部中央（腳底），影格 0 完好、影格 1 破損（有的話）。
 */

const OUTLINE = 0x120d0a;
const BAG = [0x5c5038, 0x7d6c4a, 0x9d8a5e, 0xb8a474];
const WOOD = [0x4a3324, 0x6d4c33, 0x8d6e4a];
const METAL = [0x2f343c, 0x4b525c, 0x6c7480, 0x9aa3ad];

type Px = (x: number, y: number, c: number, w?: number, h?: number) => void;

function sheet(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  frames: number,
  draw: (px: Px, frame: number, rnd: Phaser.Math.RandomDataGenerator) => void,
): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const t = scene.textures.createCanvas(key, w * frames, h)!;
  const ctx = t.getContext();
  for (let f = 0; f < frames; f++) {
    const ox = f * w;
    const rnd = new Phaser.Math.RandomDataGenerator([key]);
    const px: Px = (x, y, c, pw = 1, ph = 1) => {
      ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
      ctx.fillRect(ox + x, y, pw, ph);
    };
    draw(px, f, rnd);
    t.add(f, 0, ox, 0, w, h);
  }
  t.refresh();
}

/** 一個沙包：圓角長方形，上亮下暗，中間一條綁繩 */
function bag(px: Px, x: number, y: number, w: number, h: number, torn: boolean): void {
  px(x + 1, y, OUTLINE, w - 2, 1);
  px(x + 1, y + h - 1, OUTLINE, w - 2, 1);
  px(x, y + 1, OUTLINE, 1, h - 2);
  px(x + w - 1, y + 1, OUTLINE, 1, h - 2);
  px(x + 1, y + 1, BAG[2], w - 2, h - 2);
  px(x + 1, y + 1, BAG[3], w - 2, 1);
  px(x + 1, y + h - 2, BAG[0], w - 2, 1);
  px(x + Math.floor(w / 2), y + 1, BAG[1], 1, h - 2);
  if (torn) {
    px(x + 2, y + 2, BAG[0], 2, 1);
    px(x + w - 4, y + h - 3, 0x3a3226, 2, 1);
  }
}

export function createBuildingTextures(scene: Phaser.Scene): void {
  // 沙包牆 32×22：下排三包、上排兩包；破損時上排少一包、散出沙
  sheet(scene, 'bld_sandbag', 32, 22, 2, (px, f) => {
    bag(px, 0, 12, 11, 9, f === 1);
    bag(px, 10, 13, 12, 8, false);
    bag(px, 21, 12, 11, 9, f === 1);
    bag(px, 4, 4, 12, 9, false);
    if (f === 0) bag(px, 15, 3, 13, 10, false);
    else {
      px(18, 10, BAG[1], 6, 2);
      px(20, 9, BAG[2], 3, 1);
    }
    // 影子
    px(1, 21, 0x000000, 30, 1);
  });

  // 尖刺陷阱 32×12：一片木板上釘滿鐵刺；破損時刺被踩彎
  sheet(scene, 'bld_spikes', 32, 12, 2, (px, f, rnd) => {
    px(0, 8, OUTLINE, 32, 4);
    px(1, 9, WOOD[1], 30, 2);
    px(1, 9, WOOD[2], 30, 1);
    for (let k = 0; k < 4; k++) px(rnd.between(2, 28), 10, WOOD[0], rnd.between(2, 4), 1);
    for (let i = 0; i < 7; i++) {
      const x = 2 + i * 4 + (i % 2);
      const bent = f === 1 && i % 2 === 0;
      if (bent) {
        px(x, 7, METAL[1], 3, 1);
        px(x + 2, 6, METAL[2], 1, 1);
        continue;
      }
      const top = i % 2 === 0 ? 1 : 3;
      px(x, top, METAL[3], 1, 1);
      px(x, top + 1, METAL[2], 1, 8 - top - 1);
      px(x + 1, top + 2, METAL[0], 1, 8 - top - 2);
    }
  });

  // 照明燈 16×46：細桿 + 燈罩 + 亮著的燈泡
  sheet(scene, 'bld_lamp', 16, 46, 1, (px) => {
    // 底座
    px(3, 42, OUTLINE, 10, 4);
    px(4, 43, METAL[1], 8, 2);
    // 桿
    px(7, 8, OUTLINE, 3, 35);
    px(8, 9, METAL[2], 1, 33);
    // 燈罩
    px(2, 3, OUTLINE, 12, 6);
    px(3, 4, METAL[1], 10, 3);
    px(3, 4, METAL[2], 10, 1);
    // 燈泡
    px(4, 7, 0xffd27a, 8, 2);
    px(6, 7, 0xfff3c0, 4, 1);
  });

  // 自動砲塔 30×26：三腳架 + 彈藥箱 + 槍管朝右
  sheet(scene, 'bld_turret', 30, 26, 1, (px) => {
    // 三腳架
    px(6, 16, OUTLINE, 2, 10);
    px(14, 16, OUTLINE, 2, 10);
    px(22, 16, OUTLINE, 2, 10);
    px(7, 17, METAL[2], 1, 8);
    px(15, 17, METAL[2], 1, 8);
    px(23, 17, METAL[1], 1, 8);
    // 機身
    px(5, 7, OUTLINE, 18, 10);
    px(6, 8, METAL[1], 16, 8);
    px(6, 8, METAL[2], 16, 1);
    px(6, 15, METAL[0], 16, 1);
    // 綠色指示燈
    px(8, 10, 0x6fdc6f, 2, 2);
    // 槍管
    px(22, 9, OUTLINE, 8, 4);
    px(22, 10, METAL[2], 7, 1);
    px(22, 11, METAL[0], 7, 1);
    // 彈藥箱
    px(9, 13, OUTLINE, 8, 6);
    px(10, 14, 0x4f5a34, 6, 4);
    px(12, 15, 0xe8c25a, 2, 1);
  });
}
