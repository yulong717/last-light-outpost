/**
 * 每把武器的像素圖（純資料，不依賴 Phaser）。槍口朝右、y 往下。
 *
 * 只畫「填色」，1px 深色外框由 WeaponArt 自動加上，改圖時不用管外框。
 * 一把槍拆成好幾個部件，換彈與上膛的動作都是在動部件：
 * - body：不會動的主體
 * - action：滑套、泵動護木、槍栓、拉柄，開槍／上膛時沿 travel 方向後退再回來
 * - mag：彈匣，換彈時掉出去、換新的插回來（左輪是轉輪、M249 是彈箱）
 * - hinge：會轉開的部件（雙管的槍管、M249 的上蓋），繞 pivot 轉 openDeg 度
 *
 * 錨點（以 body 左上為原點、未加外框的座標）：
 * - grip：扳機手握的位置（武器以這點掛在手上、也以這點旋轉）
 * - fore：護木手扶的位置（沒有 = 雙手都握 grip，手槍）
 * - muzzle：槍口（火光、曳光彈起點）
 * - eject：拋殼口
 */

export const PALETTE: Record<string, number> = {
  k: 0x24262c, // 黑色聚合物／烤藍
  g: 0x474c56, // 槍鋼
  l: 0x6f7682, // 淺金屬
  s: 0xa9b0bc, // 銀色亮面
  e: 0xdfe4ea, // 刀刃反光
  w: 0x7b4a28, // 木頭
  W: 0x563219, // 深木頭
  b: 0xa0703f, // 淺木頭
  o: 0x55603d, // 橄欖綠
  t: 0x9a8a62, // 沙色
  r: 0x9b2b22, // 紅
  y: 0xc9a43a, // 黃銅
  h: 0x3a3328, // 握把膠布
  m: 0x8d9097, // 鋁
};
export const OUTLINE = 0x121318;

export interface PartMap {
  map: string[];
  /** 在 body 座標系的左上角位置 */
  x: number;
  y: number;
}

export interface HingeMap extends PartMap {
  /** 旋轉軸（body 座標） */
  pivot: [number, number];
  /** 打開時轉幾度（正 = 順時針，往下折） */
  openDeg: number;
}

export interface WeaponMap {
  body: string[];
  action?: PartMap & { travel: [number, number] };
  mag?: PartMap;
  hinge?: HingeMap;
  grip: [number, number];
  fore?: [number, number];
  muzzle: [number, number];
  eject: [number, number];
  /** 握把離肩膀多遠（像素）：手槍手伸直、長槍抵肩 */
  reach: number;
  /** 槍托抵肩時，槍身往下壓幾像素 */
  drop: number;
}

export const WEAPON_MAPS: Record<string, WeaponMap> = {
  // ── 手槍 ─────────────────────────────────────────────
  m1911: {
    body: [
      '             ',
      '             ',
      'kkkkkkkkkkkk ',
      ' Wwwk  k     ',
      ' wwwkkk      ',
      ' wwwk        ',
      ' www         ',
    ],
    action: { map: ['slllllllllll', 'ggggggggggggg'], x: 0, y: 0, travel: [-3, 0] },
    mag: { map: ['gg'], x: 1, y: 7 },
    grip: [2, 4],
    muzzle: [13, 1],
    eject: [7, 0],
    reach: 13,
    drop: 0,
  },
  python: {
    body: [
      '    kkkkkkkkkkk ',
      '  lggggggggggggg',
      '  g     gggggggg',
      '  gk  k         ',
      ' Wwwk k         ',
      ' wwww           ',
      'wwww            ',
      'www             ',
    ],
    mag: { map: ['lsll', 'gggg', 'llgl'], x: 3, y: 2 },
    grip: [2, 5],
    muzzle: [16, 1],
    eject: [4, 2],
    reach: 13,
    drop: 0,
  },
  // ── 衝鋒槍、步槍 ─────────────────────────────────────
  mp5: {
    body: [
      '         k           k     ',
      'kkkkk   kgggggggggggggkkkkk',
      'k   kkkkkggggggggggggggkkkk',
      'kkkkkkk  kkk kkkkkkkkk     ',
      '       kkk  kkk            ',
      '       kkk                 ',
      '       kk                  ',
    ],
    action: { map: ['l'], x: 19, y: 0, travel: [-4, 0] },
    mag: { map: ['kk', 'kk', 'kkk', ' kk', ' kk', '  kk'], x: 13, y: 4 },
    grip: [8, 4],
    fore: [17, 3],
    muzzle: [27, 1],
    eject: [14, 1],
    reach: 7,
    drop: 1,
  },
  m4a1: {
    body: [
      '            kkkkk        k      ',
      'kkkkk     kkggggkkkkkkkkkk      ',
      'kgggkkkkkkgggggggggggggggkkkkkkk',
      'kkkkk   kkkkggkkkkkkkkkkkk      ',
      '        kkk  k  kk  kk          ',
      '        kkk                     ',
      '         kk                     ',
    ],
    action: { map: ['ll'], x: 9, y: 1, travel: [-3, 0] },
    mag: { map: ['ggg', 'ggg', 'ggg', 'ggg', ' ggg', ' ggg'], x: 13, y: 4 },
    grip: [9, 4],
    fore: [19, 3],
    muzzle: [32, 2],
    eject: [14, 2],
    reach: 6,
    drop: 1,
  },
  ak47: {
    body: [
      '                       k       ',
      'WWw        gggggggggg wwwwkkkkk',
      'wwwwwwgggggggggggggggggwwwwgggg',
      ' Wwwwwwgggg kkk kggggwwww      ',
      '      wwkk   k               ',
      '       www                    ',
      '        ww                    ',
    ],
    action: { map: ['ll'], x: 16, y: 2, travel: [-5, 0] },
    mag: { map: ['ggg', 'ggg', ' ggg', ' ggg', '  ggg', '   gg'], x: 12, y: 4 },
    grip: [8, 4],
    fore: [21, 3],
    muzzle: [31, 2],
    eject: [15, 1],
    reach: 6,
    drop: 1,
  },
  // ── 霰彈槍 ───────────────────────────────────────────
  coach: {
    body: [
      '            ',
      'WWw         ',
      'wwwwwwwssss ',
      ' Wwwwwwwss  ',
      '       ww k ',
      '        ww  ',
    ],
    hinge: {
      map: ['gggggggggggggggggg', 'llllllllllllllllll', 'wwwwwwwwww        '],
      x: 11,
      y: 1,
      pivot: [11, 3],
      openDeg: 35,
    },
    grip: [8, 4],
    fore: [16, 4],
    muzzle: [29, 2],
    eject: [12, 2],
    reach: 6,
    drop: 1,
  },
  m1014: {
    body: [
      '            k     k          ',
      'kkkkk   kkggggggggkkkkkkkkkkk',
      'kgggkkkkkkgggggggggggggggggggk',
      'kkkkk   kkkkggggkkkkkkkkkkkkk',
      '        kkk  k               ',
      '        kkk                  ',
      '         kk                  ',
    ],
    action: { map: ['ll'], x: 13, y: 2, travel: [-3, 0] },
    grip: [9, 4],
    fore: [20, 3],
    muzzle: [30, 2],
    eject: [14, 2],
    reach: 6,
    drop: 1,
  },
  // ── 狙擊、機槍 ───────────────────────────────────────
  // 巴雷特：粗槍管、大型制退器、上方長狙擊鏡、前面兩腳架
  barrett: {
    body: [
      '            kkkkkkkkkk                    ',
      '           kggllllllggk                   ',
      'kkkk        kkkkkkkkkk                    ',
      'kgggkk    kkkkkkkkkkkkkkkkkkkkkkkkkkk  kkk',
      'kggggkkkkkkggggggggggggggggggggggggggggggk',
      'kkkkk   kkkkkkggggggggkkkkkkkkkkkkkkkgkkkk',
      '        kkk  k              k k           ',
      '        kkk                k   k          ',
      '         kk               k     k         ',
    ],
    action: { map: ['ll'], x: 12, y: 4, travel: [-5, 0] },
    mag: { map: ['ggggg', 'ggggg', 'ggggg'], x: 14, y: 6 },
    grip: [9, 6],
    fore: [22, 5],
    muzzle: [42, 4],
    eject: [16, 3],
    reach: 6,
    drop: 2,
  },
  m249: {
    body: [
      '                                    ',
      'kkkk      kgggggggggk          k    ',
      'kgggkkkkkkggggggggggkkkkkkkkkkkkkkkk',
      'kkkkk   kkkkggggggggkkkk  l         ',
      '        kkk  k          l  l        ',
      '        kkk            l    l       ',
      '         kk                         ',
    ],
    hinge: { map: ['kkkkkkkkkk', 'gggggggggg'], x: 10, y: 0, pivot: [10, 1], openDeg: -40 },
    action: { map: ['l'], x: 21, y: 2, travel: [-4, 0] },
    mag: { map: ['oooo', 'oooo', 'otto', 'oooo'], x: 13, y: 4 },
    grip: [9, 4],
    fore: [20, 3],
    muzzle: [36, 2],
    eject: [16, 3],
    reach: 6,
    drop: 2,
  },
  // ── 十字弓（弓臂在前端上下張開，弦拉到扳機上方） ─────────
  crossbow: {
    body: [
      '                   kk  ',
      '                  kgk  ',
      '                 kgk   ',
      'WWw     kkkkkkkkkgkkkk ',
      'wwwwwwwwwwwwwwwwwgwwwwe',
      ' Wwwwwwwkkkkkkkkkgkkkk ',
      '       ww k      kgk   ',
      '        ww        kgk  ',
      '                   kk  ',
    ],
    action: { map: ['ttttttttt'], x: 8, y: 3, travel: [3, 0] },
    grip: [9, 6],
    fore: [15, 5],
    muzzle: [22, 4],
    eject: [12, 3],
    reach: 6,
    drop: 1,
  },
  // ── 近戰（握柄底端在左，刃朝右） ─────────────────────
  knife: {
    body: ['hhhh lseeeeee', 'hhhhkggggggg ', '     g       '],
    grip: [1, 1],
    muzzle: [12, 0],
    eject: [0, 0],
    reach: 11,
    drop: 0,
  },
  machete: {
    body: ['hhhhkk lseeeeeeeeeee ', 'hhhhkkggggggggggggggge', '      gggggggggggggg  '],
    grip: [1, 1],
    muzzle: [20, 1],
    eject: [0, 0],
    reach: 11,
    drop: 0,
  },
  bat: {
    body: ['                  mmmm ', 'hhhhhkmmmmmmmmmmmmmmmmm', 'hhhhhkmmmmmmmmmmmmmmmmm', '                  ssss '],
    grip: [1, 1],
    muzzle: [22, 1],
    eject: [0, 0],
    reach: 10,
    drop: 0,
  },
  axe: {
    body: [
      '                    rrrr ',
      '                    rrrrre',
      'wwwwwwwwwwwwwwwwwwwwrrrre',
      'WWWWWWWWWWWWWWWWWWWWrrrre',
      '                    rrrrre',
      '                    kk   ',
    ],
    grip: [1, 2],
    muzzle: [24, 2],
    eject: [0, 0],
    reach: 10,
    drop: 0,
  },
  // 武士刀：纏繩刀柄、金色刀鐔、微彎的長刀身
  katana: {
    body: [
      '        y                      ',
      'rhrhrhrhyysssssssssssssssssseee ',
      'hrhrhrhryyggggggggggggggggggggee',
      '        y                       ',
    ],
    grip: [3, 1],
    muzzle: [31, 2],
    eject: [0, 0],
    reach: 10,
    drop: 0,
  },
};
