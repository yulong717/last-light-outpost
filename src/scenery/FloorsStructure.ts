import Phaser from 'phaser';
import { GAME_HEIGHT } from '../config';
import type { FloorsDef } from '../data/scenery';
import { pixelText } from '../utils/text';

/**
 * 鏡頭可以往左多捲這麼多：據點在戰場最左邊，頂樓又在畫面最上面，
 * 不多捲一點的話頂樓的人會被左上角的 HUD 擋住。多出來的地方畫成隔壁的高樓。
 */
export const FLOORS_PAD = 180;

/**
 * 多樓層據點（爛尾樓工地）的前景結構：剖面看進去的三層水泥骨架、樓梯、鷹架走道與爬梯。
 * 背景（後排大樓、塔吊）是 SceneryBuilder 的 facadeSite，這裡整片蓋在它上面，只留最上面的天空。
 *
 * 深度都在 0.4～0.8：在地上的血跡（1）、地形（1.6）、道具與角色（依腳底 y，10 以上）的後面。
 * 樓板只露出一點點頂面，角色站在頂面上；下一層的人頭頂碰不到上一層的樓板。
 */
export function drawFloorsStructure(scene: Phaser.Scene, def: FloorsDef, baseX: number, worldW: number): void {
  const lv = def.levels;
  const ys = lv.map((l) => l.y);
  const yF1 = ys[0];
  // 頂樓（有 x1 的那層）只蓋到一半，大樓的右緣就在那裡
  const bx = lv.find((l) => l.x1)?.x1 ?? worldW;
  const top = Math.min(...ys);
  const back = scene.add.graphics().setDepth(0.4);
  const mid = scene.add.graphics().setDepth(0.6);
  const front = scene.add.graphics().setDepth(0.8);
  const rnd = new Phaser.Math.RandomDataGenerator(['tower-structure']);

  // ── 右邊：隔壁兩層樓的店面，前面整排鷹架 ──
  const nTop = top - 12;
  back.fillStyle(0x4a4440, 1).fillRect(bx, nTop, worldW - bx, yF1 - nTop);
  back.fillStyle(0x6a625a, 1).fillRect(bx, nTop - 4, worldW - bx, 5);
  for (let x = bx + 30; x < worldW - 40; x += rnd.between(80, 110)) {
    // 二樓窗（有的裝鐵窗）
    const wy = nTop + 26;
    back.fillStyle(0x14171c, 1).fillRect(x, wy, 34, 40);
    back.fillStyle(0x6a6e74, 1).fillRect(x - 2, wy - 2, 38, 2).fillRect(x - 2, wy + 40, 38, 3);
    if (rnd.frac() < 0.4) for (let k = 4; k < 34; k += 6) back.fillStyle(0x3a3e44, 1).fillRect(x + k, wy, 1, 40);
    if (rnd.frac() < 0.08) back.fillStyle(0xf0d890, 0.35).fillRect(x + 2, wy + 2, 30, 36);
  }
  // 一樓：拉下來的鐵捲門
  const sTop = ys[1] + 16;
  for (let x = bx + 16; x < worldW - 70; x += rnd.between(110, 150)) {
    const h = yF1 - 6 - sTop;
    back.fillStyle(0x2a2e34, 1).fillRect(x - 3, sTop - 6, 70, 6);
    const open = rnd.frac() < 0.3 ? rnd.between(10, 22) : 0;
    for (let y = sTop; y < sTop + h - open; y += 4) back.fillStyle(y % 8 === 0 ? 0x7a8088 : 0x6a7078, 1).fillRect(x, y, 64, 3);
    if (open) back.fillStyle(0x07080a, 1).fillRect(x, sTop + h - open, 64, open);
  }
  // 安全網：一段一段垂在鷹架外
  for (let x = bx + rnd.between(40, 90); x < worldW; x += rnd.between(160, 260)) {
    const w = rnd.between(50, 90);
    back.fillStyle(0x2a6a3a, 0.7).fillRect(x, nTop - 30, w, ys[1] - nTop + 20);
    for (let y = nTop - 28; y < ys[1] - 12; y += 4) back.fillStyle(0x1e4e2a, 0.6).fillRect(x, y, w, 1);
  }

  // ── 左邊：爛尾樓的剖面 ──
  // 每一層的牆（樓板之間）
  for (let i = 0; i < lv.length; i++) {
    const floorY = ys[i];
    const above = ys[i + 1];
    if (above === undefined) continue;
    const y0 = above + 13;
    const y1 = floorY - 4;
    const w = lv[i + 1].x1 ? Math.min(lv[i + 1].x1!, bx) : bx;
    back.fillStyle(i === 0 ? 0x3a3c3f : 0x45474a, 1).fillRect(0, y0, w, y1 - y0);
    // 沒砌完的牆：一格一格的空洞，看出去是夜空
    for (let x = baseX + 70; x < w - 50; x += 92) {
      if (i === 0 && rnd.frac() < 0.5) {
        // 一樓：用夾板釘起來
        back.fillStyle(0x6a5030, 1).fillRect(x, y0 + 14, 50, y1 - y0 - 24);
        for (let k = 0; k < 3; k++) back.fillStyle(0x4a3820, 1).fillRect(x, y0 + 22 + k * 14, 50, 1);
        continue;
      }
      back.fillStyle(0x161a24, 1).fillRect(x, y0 + 10, 56, y1 - y0 - 18);
      back.fillStyle(0x7a5a44, 1).fillRect(x + 8, y0 + 10, 1, 8).fillRect(x + 30, y0 + 10, 1, 6);
    }
    // 牆上的柱子
    for (const cx of [baseX + 4, 260, w - 14]) back.fillStyle(0x5a5c60, 1).fillRect(cx, y0, 12, y1 - y0);
    // 樓層標示（噴漆）
    const t = pixelText(scene, baseX + 62, y0 + 12, lv[i].name, 8, '#d8c060').setOrigin(0, 0).setDepth(0.7).setAlpha(0.8);
    t.setStroke('#000000', 2);
  }
  // 頂樓：後面一道矮牆、水塔、柱頭冒出來的鋼筋
  const roof = lv[lv.length - 1];
  const rw = roof.x1 ?? bx;
  mid.fillStyle(0x5a5c60, 1).fillRect(0, roof.y - 18, rw, 14);
  mid.fillStyle(0x7a7c80, 1).fillRect(0, roof.y - 18, rw, 2);
  mid.fillStyle(0x8a8c90, 1).fillRect(330, roof.y - 58, 40, 36);
  mid.fillStyle(0x6a6c70, 1).fillRect(330, roof.y - 26, 40, 4).fillRect(334, roof.y - 22, 3, 4).fillRect(363, roof.y - 22, 3, 4);
  mid.fillStyle(0x4a7aa8, 1).fillRect(330, roof.y - 50, 40, 3);
  for (const cx of [baseX + 4, 260, rw - 14]) for (let k = 1; k < 12; k += 3) mid.fillStyle(0x7a5a44, 1).fillRect(cx + k, roof.y - 30 - (k % 4) * 2, 1, 14);
  pixelText(scene, baseX + 62, roof.y - 40, roof.name, 8, '#d8c060').setOrigin(0, 0).setDepth(0.7).setAlpha(0.8).setStroke('#000000', 2);

  // 樓板：頂面亮、正面暗；大樓右緣是斷掉的樓板，鋼筋外露
  for (let i = 1; i < lv.length; i++) {
    const y = ys[i];
    const w = lv[i].x1 ? Math.min(lv[i].x1!, bx) : bx;
    front.fillStyle(0x8a8a86, 1).fillRect(0, y - 4, w, 9);
    front.fillStyle(0xa8a8a2, 1).fillRect(0, y - 4, w, 1);
    front.fillStyle(0x6a6a68, 1).fillRect(0, y + 5, w, 8);
    front.fillStyle(0x3a3a3a, 1).fillRect(0, y + 12, w, 1);
    for (let k = 0; k < 5; k++) front.fillStyle(0x7a5a44, 1).fillRect(w, y + 1 + k * 2, rnd.between(4, 10), 1);
  }
  // 一樓地面：室內水泥地接到外面的柏油路
  front.fillStyle(0x56565a, 1).fillRect(0, yF1 - 4, bx, GAME_HEIGHT - yF1 + 4);
  front.fillStyle(0x2e2f34, 1).fillRect(bx, yF1 - 4, worldW - bx, GAME_HEIGHT - yF1 + 4);
  front.fillStyle(0x6a6a6e, 1).fillRect(0, yF1 - 5, worldW, 1);
  front.fillStyle(0x1e1f22, 1).fillRect(0, yF1 + 8, worldW, GAME_HEIGHT - yF1 - 8);
  for (let x = bx + 20; x < worldW; x += 40) front.fillStyle(0xd8c860, 0.4).fillRect(x, yF1 + 12, 20, 2);

  // 鷹架走道（2F 延伸到大樓外）
  const deck = ys[1];
  front.fillStyle(0x9a7a4a, 1).fillRect(bx, deck - 4, worldW - bx, 9);
  for (let x = bx; x < worldW; x += 30) front.fillStyle(0x6a5030, 1).fillRect(x, deck - 4, 1, 9);
  front.fillStyle(0x6a5030, 1).fillRect(bx, deck + 5, worldW - bx, 4);
  // 鷹架鋼管：直的一路從一樓立到頂樓高度，橫的是扶手與踢腳
  for (let x = bx + 8; x < worldW; x += 80) mid.fillStyle(0x9aa0a6, 1).fillRect(x, top - 40, 2, yF1 - top + 40);
  for (const y of [deck - 26, deck - 14, top - 36, deck + 30]) mid.fillStyle(0x8a9096, 1).fillRect(bx, y, worldW - bx, 2);
  for (let x = bx + 8; x < worldW - 80; x += 160) {
    // 斜撐
    for (let k = 0; k < 80; k += 2) mid.fillStyle(0x7a8086, 1).fillRect(x + k, deck + 30 + Math.round((k * (yF1 - deck - 34)) / 80), 2, 2);
  }

  // 樓梯與爬梯
  for (const s of def.stairs) {
    const inside = s.x1 <= bx - 40;
    if (inside) {
      // 室內樓梯：每一層之間一段斜樓梯，左右交錯
      for (let i = 0; i + 1 < lv.length; i++) {
        const yA = ys[i] - 2;
        const yB = ys[i + 1] + 5;
        const steps = 10;
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          const x = i % 2 === 0 ? s.x0 + (s.x1 - s.x0) * t : s.x1 - (s.x1 - s.x0) * t - 6;
          const y = yA + (yB - yA) * t;
          mid.fillStyle(0x7a7a78, 1).fillRect(Math.round(x), Math.round(y) - 3, 8, 4);
          mid.fillStyle(0x9a9a96, 1).fillRect(Math.round(x), Math.round(y) - 3, 8, 1);
        }
        // 扶手
        for (let k = 0; k < 20; k++) {
          const t = k / 20;
          const x = i % 2 === 0 ? s.x0 + (s.x1 - s.x0) * t : s.x1 - (s.x1 - s.x0) * t;
          mid.fillStyle(0x3a3e44, 1).fillRect(Math.round(x), Math.round(yA + (yB - yA) * t) - 22, 2, 1);
        }
      }
    } else {
      // 鷹架爬梯：兩根直管＋橫檔，從一樓爬到頂樓
      front.fillStyle(0xc8ccd0, 1).fillRect(s.x0 + 4, top - 30, 2, yF1 - top + 30).fillRect(s.x1 - 6, top - 30, 2, yF1 - top + 30);
      for (let y = top - 26; y < yF1 - 2; y += 8) front.fillStyle(0xa8acb0, 1).fillRect(s.x0 + 4, y, s.x1 - s.x0 - 8, 1);
    }
    // 提示：▲▼
    for (let i = 0; i < lv.length; i++) {
      if ((lv[i].x1 ?? worldW) < s.x1) continue;
      const up = i + 1 < lv.length && (lv[i + 1].x1 ?? worldW) >= s.x1;
      const t = pixelText(scene, (s.x0 + s.x1) / 2, ys[i] - 64, up && i > 0 ? '▲▼' : up ? '▲' : '▼', 7, '#fff59d').setOrigin(0.5).setDepth(0.75).setAlpha(0.7);
      t.setStroke('#000000', 2);
    }
  }

  // 鏡頭多捲出來的左邊：隔壁的老公寓（整面牆，鐵窗、冷氣、排水管）
  back.fillStyle(0x34302e, 1).fillRect(-FLOORS_PAD, 0, FLOORS_PAD, GAME_HEIGHT);
  for (let y = 4; y < GAME_HEIGHT; y += 8) back.fillStyle(0x2a2624, 1).fillRect(-FLOORS_PAD, y, FLOORS_PAD, 1);
  for (let y = 30; y < yF1 - 40; y += 74) {
    for (const x of [-FLOORS_PAD + 26, -FLOORS_PAD + 100]) {
      back.fillStyle(0x15181c, 1).fillRect(x, y, 40, 44);
      for (let k = 4; k < 40; k += 6) back.fillStyle(0x4a4e54, 1).fillRect(x + k, y, 1, 44);
      back.fillStyle(0x6a6e74, 1).fillRect(x - 2, y + 44, 44, 3);
      if (rnd.frac() < 0.5) back.fillStyle(0xb8bcc0, 1).fillRect(x + 8, y + 50, 26, 16);
      if (rnd.frac() < 0.12) back.fillStyle(0xf0d890, 0.3).fillRect(x + 2, y + 2, 36, 40);
    }
  }
  back.fillStyle(0x5a5e64, 1).fillRect(-14, 0, 5, GAME_HEIGHT);
  back.fillStyle(0x1e1f22, 1).fillRect(-FLOORS_PAD, yF1 + 8, FLOORS_PAD, GAME_HEIGHT - yF1 - 8);

  // 據點本體：左邊的樓梯間（水泥牆，一路蓋到頂樓），每層一扇鐵門
  back.fillStyle(0x3d4450, 1).fillRect(0, top - 70, baseX, GAME_HEIGHT - top + 70);
  back.fillStyle(0x6a7280, 1).fillRect(0, top - 70, baseX, 3);
  for (let y = top - 64; y < GAME_HEIGHT; y += 10) back.fillStyle(0x2e333c, 1).fillRect(0, y, baseX, 1);
  for (const y of ys) {
    back.fillStyle(0x5a6270, 1).fillRect(baseX - 26, y - 46, 22, 46);
    back.fillStyle(0x2a2e36, 1).fillRect(baseX - 24, y - 44, 18, 42);
    back.fillStyle(0xc8b070, 1).fillRect(baseX - 10, y - 24, 2, 2);
  }
  front.fillStyle(0x555d6b, 1).fillRect(baseX, top - 70, 6, GAME_HEIGHT - top + 70);
}

/**
 * 透天厝：兩層樓的老透天，一樓是車庫＋騎樓（鐵門在車庫口），二樓陽台一路伸到騎樓上方。
 * 一樓院子是一般的 2.5D 地面帶（SceneryBuilder 畫的街道），這裡只畫房子本體與樓梯。
 */
export function drawHouseStructure(scene: Phaser.Scene, def: FloorsDef, baseX: number): void {
  const up = def.levels.find((l) => !l.band)!;
  const y2 = up.y;
  const bx = up.x1 ?? 300;
  const gateX = def.levels[0].barricadeX ?? 160;
  const back = scene.add.graphics().setDepth(0.4);
  const mid = scene.add.graphics().setDepth(0.6);
  const front = scene.add.graphics().setDepth(0.8);
  const rnd = new Phaser.Math.RandomDataGenerator(['house-structure']);
  const G = 206;

  // 左邊多捲出來的地方：隔壁的透天
  back.fillStyle(0x4a4038, 1).fillRect(-FLOORS_PAD, 0, FLOORS_PAD, GAME_HEIGHT);
  for (let y = 4; y < G; y += 8) back.fillStyle(0x3e352e, 1).fillRect(-FLOORS_PAD, y, FLOORS_PAD, 1);
  for (const [x, y] of [[-150, 40], [-80, 40], [-150, 130], [-80, 130]]) {
    back.fillStyle(0x15181c, 1).fillRect(x, y, 44, 48);
    for (let k = 4; k < 44; k += 6) back.fillStyle(0x7a3a2a, 1).fillRect(x + k, y, 1, 48);
    back.fillStyle(0x6a6e74, 1).fillRect(x - 2, y + 48, 48, 3);
  }
  back.fillStyle(0x3a3e44, 1).fillRect(-FLOORS_PAD, G, FLOORS_PAD, GAME_HEIGHT - G);

  // ── 房子本體 ──
  const roofY = y2 - 86;
  // 屋頂：鐵皮加蓋＋水塔
  back.fillStyle(0x6a6e74, 1).fillRect(-6, roofY - 14, bx + 12, 6);
  for (let x = -6; x < bx + 6; x += 6) back.fillStyle(0x52565c, 1).fillRect(x, roofY - 14, 1, 6);
  back.fillStyle(0x8a8c90, 1).fillRect(40, roofY - 40, 30, 26);
  back.fillStyle(0x4a7aa8, 1).fillRect(40, roofY - 34, 30, 3);
  // 二樓：磁磚外牆、紅色鐵窗、晾衣竿
  back.fillStyle(0xc8bca0, 1).fillRect(0, roofY - 8, bx, y2 - roofY + 4);
  for (let y = roofY - 6; y < y2; y += 6) back.fillStyle(0xb0a488, 1).fillRect(0, y, bx, 1);
  for (let x = 0; x < bx; x += 12) back.fillStyle(0xb8ac90, 1).fillRect(x, roofY - 8, 1, y2 - roofY + 4);
  for (const wx of [130, 210]) {
    back.fillStyle(0x1a1e24, 1).fillRect(wx, roofY + 6, 46, 44);
    for (let k = 3; k < 46; k += 5) back.fillStyle(0xa83a2a, 1).fillRect(wx + k, roofY + 6, 1, 44);
    back.fillStyle(0xa83a2a, 1).fillRect(wx, roofY + 6, 46, 2).fillRect(wx, roofY + 48, 46, 2);
    if (rnd.frac() < 0.5) back.fillStyle(0xf0d890, 0.3).fillRect(wx + 2, roofY + 8, 42, 40);
  }
  // 陽台門（樓梯上來的那扇）
  back.fillStyle(0x5a4030, 1).fillRect(baseX + 8, y2 - 52, 30, 50);
  back.fillStyle(0x3a2a1e, 1).fillRect(baseX + 10, y2 - 50, 26, 48);
  // 晾衣竿與衣服
  mid.fillStyle(0x9aa0a6, 1).fillRect(110, y2 - 58, bx - 120, 1);
  for (let x = 130; x < bx - 20; x += rnd.between(22, 34)) mid.fillStyle(rnd.pick([0x3a6ac8, 0xe0e0d8, 0xc83a2a, 0x5a8a4a]), 1).fillRect(x, y2 - 57, rnd.between(8, 14), rnd.between(10, 16));
  // 陽台後側的欄杆（前側不畫，免得擋住人）
  for (let x = 100; x < bx; x += 6) mid.fillStyle(0x6a6e74, 1).fillRect(x, y2 - 20, 1, 16);
  mid.fillStyle(0x8a9096, 1).fillRect(100, y2 - 21, bx - 100, 2);
  // 陽台盡頭的矮牆
  front.fillStyle(0xb0a488, 1).fillRect(bx - 4, y2 - 26, 8, 30);
  front.fillStyle(0xd8ccb0, 1).fillRect(bx - 4, y2 - 26, 8, 2);
  // 二樓樓板（伸出去的陽台）：頂面＋正面
  front.fillStyle(0x8a8a86, 1).fillRect(0, y2 - 4, bx + 4, 9);
  front.fillStyle(0xa8a8a2, 1).fillRect(0, y2 - 4, bx + 4, 1);
  front.fillStyle(0x6a6a68, 1).fillRect(0, y2 + 5, bx + 4, 9);
  front.fillStyle(0x3a3a3a, 1).fillRect(0, y2 + 13, bx + 4, 1);

  // 一樓：車庫（鐵門內）與騎樓（陽台下方）
  const f1 = y2 + 14;
  back.fillStyle(0x4a4440, 1).fillRect(0, f1, gateX, G - f1 + 2);
  for (let y = f1 + 10; y < G; y += 10) back.fillStyle(0x56504a, 1).fillRect(baseX, y, gateX - baseX, 1);
  // 牆上的神明廳、月曆
  back.fillStyle(0x8a2a24, 1).fillRect(110, f1 + 16, 26, 20);
  back.fillStyle(0xf0c040, 1).fillRect(118, f1 + 20, 10, 2);
  back.fillStyle(0xe8e0d0, 1).fillRect(140, f1 + 26, 12, 16);
  // 騎樓：天花板陰影＋柱子
  back.fillStyle(0x3a3634, 1).fillRect(gateX, f1, bx - gateX + 4, G - f1 + 2);
  back.fillStyle(0x2a2624, 1).fillRect(gateX, f1, bx - gateX + 4, 6);
  back.fillStyle(0xc8bca0, 1).fillRect(bx - 8, f1, 12, G - f1 + 2);
  // 鐵門的門框（捲上去的鐵捲門收在上面）
  back.fillStyle(0x5a6068, 1).fillRect(gateX - 4, f1, 8, G - f1 + 2);
  back.fillStyle(0x7a8088, 1).fillRect(gateX - 20, f1, 40, 8);
  // 車庫地板（地面帶上鋪磁磚）
  front.fillStyle(0x6a6058, 0.55).fillRect(baseX, G, gateX - baseX, GAME_HEIGHT - G);
  for (let y = G + 10; y < GAME_HEIGHT; y += 14) front.fillStyle(0x3a342e, 0.5).fillRect(baseX, y, gateX - baseX, 1);
  for (let x = baseX + 14; x < gateX; x += 18) front.fillStyle(0x3a342e, 0.5).fillRect(x, G, 1, GAME_HEIGHT - G);

  // 樓梯：從車庫最裡面（地面帶上緣）斜斜爬到二樓
  const s = def.stairs[0];
  const yA = (def.levels[0].band?.[0] ?? 226) + 2;
  const yB = y2 + 4;
  const steps = 14;
  for (let k = 0; k < steps; k++) {
    const t = k / steps;
    const x = s.x1 - (s.x1 - s.x0) * t - 6;
    const y = yA + (yB - yA) * t;
    mid.fillStyle(0x8a7a6a, 1).fillRect(Math.round(x), Math.round(y) - 3, 10, 5);
    mid.fillStyle(0xa89a8a, 1).fillRect(Math.round(x), Math.round(y) - 3, 10, 1);
  }
  for (let k = 0; k < 24; k++) {
    const t = k / 24;
    mid.fillStyle(0x3a3e44, 1).fillRect(Math.round(s.x1 - (s.x1 - s.x0) * t), Math.round(yA + (yB - yA) * t) - 24, 2, 1);
  }
  pixelText(scene, (s.x0 + s.x1) / 2, y2 - 64, '▼', 7, '#fff59d').setOrigin(0.5).setDepth(0.75).setAlpha(0.7).setStroke('#000000', 2);
  pixelText(scene, (s.x0 + s.x1) / 2, yA - 66, '▲', 7, '#fff59d').setOrigin(0.5).setDepth(0.75).setAlpha(0.7).setStroke('#000000', 2);
  pixelText(scene, bx - 60, y2 - 40, up.name, 8, '#d8c060').setOrigin(0, 0).setDepth(0.7).setAlpha(0.8).setStroke('#000000', 2);

  // 據點本體：房子左邊的承重牆（樓梯間）
  back.fillStyle(0x3d4450, 1).fillRect(0, roofY - 20, baseX, GAME_HEIGHT - roofY + 20);
  for (let y = roofY - 14; y < GAME_HEIGHT; y += 10) back.fillStyle(0x2e333c, 1).fillRect(0, y, baseX, 1);
  front.fillStyle(0x555d6b, 1).fillRect(baseX, roofY - 20, 6, GAME_HEIGHT - roofY + 20);
}
