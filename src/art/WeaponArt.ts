import Phaser from 'phaser';
import { OUTLINE, PALETTE, WEAPON_MAPS, type PartMap, type WeaponMap } from './weaponMaps';

/**
 * 把 weaponMaps.ts 的像素圖畫成 Phaser 貼圖：
 * - wpn_<id>_<part>：每個部件一張，全部同尺寸、同座標系（方便以握把為原點一起旋轉）
 * - wpn_<id>_icon：全部件合成的圖示（軍械庫、HUD）
 * - 掉落物：wpn_<id>_magdrop（換彈掉出去的彈匣）、殼（shell_pistol / shell_rifle / shell_12ga）
 * - 槍口火光：flash_s / flash_m / flash_l / flash_wide
 * 另外提供 stripArms()：把角色圖（主角／隊員）第 0 格的手臂與槍擦掉，給 WeaponRig 換成可動的手。
 */

export const PAD = 1;
export type PartName = 'body' | 'action' | 'mag' | 'hinge';

export interface WeaponArtInfo {
  map: WeaponMap;
  /** 貼圖寬高（含外框） */
  w: number;
  h: number;
  /** 有哪些部件 */
  parts: PartName[];
}

const info = new Map<string, WeaponArtInfo>();

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** 在畫布上畫一個部件（先外框再填色），座標已含 PAD */
function paint(ctx: CanvasRenderingContext2D, m: string[], ox: number, oy: number): void {
  const pts: [number, number, number][] = [];
  const has = new Set<string>();
  m.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = PALETTE[ch];
      if (c === undefined) return;
      pts.push([x + ox, y + oy, c]);
      has.add(`${x + ox},${y + oy}`);
    }),
  );
  ctx.fillStyle = hex(OUTLINE);
  for (const [x, y] of pts) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (!has.has(`${x + dx},${y + dy}`)) ctx.fillRect(x + dx, y + dy, 1, 1);
  }
  // 立體感：上緣亮一階、下緣暗一階（只有一列厚的細桿保持原色），金屬上緣再點一顆反光
  const metal = new Set([PALETTE.k, PALETTE.g, PALETTE.l, PALETTE.s, PALETTE.m, PALETTE.o, PALETTE.t]);
  for (const [x, y, c] of pts) {
    const up = has.has(`${x},${y - 1}`);
    const down = has.has(`${x},${y + 1}`);
    let col = c;
    if (!up && down) col = shade(c, (x + y) % 5 === 0 && metal.has(c) ? 0.42 : 0.2);
    else if (up && !down) col = shade(c, -0.28);
    ctx.fillStyle = hex(col);
    ctx.fillRect(x, y, 1, 1);
  }
}

/** 調亮（amt > 0）或調暗（amt < 0） */
function shade(c: number, amt: number): number {
  const f = (v: number) => Math.round(Math.max(0, Math.min(255, amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255);
}

function size(map: WeaponMap): { w: number; h: number } {
  let w = Math.max(...map.body.map((r) => r.length));
  let h = map.body.length;
  for (const p of [map.action, map.mag, map.hinge] as (PartMap | undefined)[]) {
    if (!p) continue;
    w = Math.max(w, p.x + Math.max(...p.map.map((r) => r.length)));
    h = Math.max(h, p.y + p.map.length);
  }
  return { w: w + PAD * 2, h: h + PAD * 2 };
}

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

/** 產生所有武器貼圖（BootScene 呼叫一次） */
export function createWeaponTextures(scene: Phaser.Scene): void {
  for (const [id, map] of Object.entries(WEAPON_MAPS)) {
    const { w, h } = size(map);
    const parts: PartName[] = ['body'];
    canvasTexture(scene, `wpn_${id}_body`, w, h, (ctx) => paint(ctx, map.body, PAD, PAD));
    for (const name of ['action', 'mag', 'hinge'] as const) {
      const p = map[name];
      if (!p) continue;
      parts.push(name);
      canvasTexture(scene, `wpn_${id}_${name}`, w, h, (ctx) => paint(ctx, p.map, p.x + PAD, p.y + PAD));
    }
    canvasTexture(scene, `wpn_${id}_icon`, w, h, (ctx) => {
      if (map.hinge) paint(ctx, map.hinge.map, map.hinge.x + PAD, map.hinge.y + PAD);
      if (map.mag) paint(ctx, map.mag.map, map.mag.x + PAD, map.mag.y + PAD);
      paint(ctx, map.body, PAD, PAD);
      if (map.action) paint(ctx, map.action.map, map.action.x + PAD, map.action.y + PAD);
    });
    // 換彈掉出去的彈匣：只畫彈匣本身（小貼圖）
    if (map.mag) {
      const mw = Math.max(...map.mag.map.map((r) => r.length)) + 2;
      canvasTexture(scene, `wpn_${id}_magdrop`, mw, map.mag.map.length + 2, (ctx) => paint(ctx, map.mag!.map, 1, 1));
    }
    info.set(id, { map, w, h, parts });
  }

  // 彈殼：手槍短黃銅、步槍長黃銅、霰彈紅殼
  canvasTexture(scene, 'shell_pistol', 3, 2, (ctx) => {
    ctx.fillStyle = hex(0xc9a43a);
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = hex(0x8a6a1e);
    ctx.fillRect(2, 0, 1, 2);
  });
  canvasTexture(scene, 'shell_rifle', 5, 2, (ctx) => {
    ctx.fillStyle = hex(0xd8b44a);
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillStyle = hex(0x8a6a1e);
    ctx.fillRect(4, 0, 1, 2);
  });
  canvasTexture(scene, 'shell_12ga', 5, 3, (ctx) => {
    ctx.fillStyle = hex(0xb02a22);
    ctx.fillRect(0, 0, 4, 3);
    ctx.fillStyle = hex(0xc9a43a);
    ctx.fillRect(4, 0, 1, 3);
  });
  // 一般彈頭（塞子彈時手上拿的）
  canvasTexture(scene, 'round_small', 4, 2, (ctx) => {
    ctx.fillStyle = hex(0xc9a43a);
    ctx.fillRect(0, 0, 3, 2);
    ctx.fillStyle = hex(0x8a5a2a);
    ctx.fillRect(3, 0, 1, 2);
  });
  // 左輪快速裝填器
  canvasTexture(scene, 'speedloader', 4, 4, (ctx) => {
    ctx.fillStyle = hex(0x24262c);
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = hex(0xc9a43a);
    ctx.fillRect(1, 0, 2, 2);
  });

  // 槍口火光：小（手槍、衝鋒槍）、中（步槍）、大（狙擊、左輪）、寬（霰彈）
  const flash = (key: string, len: number, half: number, spikes: number) =>
    canvasTexture(scene, key, len + 2, half * 2 + 3, (ctx) => {
      const cy = half + 1;
      const core = Math.max(2, Math.round(len * 0.35));
      for (let x = 0; x < len; x++) {
        const k = 1 - x / len;
        const hh = Math.round(half * Math.sin(Math.PI * Math.min(1, (x + 1) / (len * 0.7))) * (0.6 + 0.4 * k));
        ctx.fillStyle = x < core ? '#fff7d6' : x < core * 2 ? '#ffd35a' : '#ff8a2a';
        ctx.fillRect(x, cy - hh, 1, hh * 2 + 1);
      }
      // 尖刺
      ctx.fillStyle = '#ffd35a';
      for (let i = 0; i < spikes; i++) {
        const a = ((i + 0.5) / spikes) * Math.PI - Math.PI / 2;
        for (let r = 0; r < half + 1; r++) ctx.fillRect(Math.round(core + Math.cos(a) * r * 0.6), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, cy - 1, core, 3);
    });
  flash('flash_s', 6, 2, 2);
  flash('flash_m', 9, 3, 2);
  flash('flash_l', 13, 4, 3);
  flash('flash_wide', 10, 6, 5);
}

export function weaponArt(id: string): WeaponArtInfo | undefined {
  return info.get(id);
}

/**
 * 擦掉角色圖第 0 格的手臂與槍，另存成 <key>_body（單格 64×64）。
 * 手臂範圍依主角射擊圖量出來（tools/art/make_player_regions.py 的部位圖可對照）：
 * 胸口以前、肩膀以下的那一塊。切口補上深色外框，看起來像肩膀收在身側。
 */
export function stripArms(scene: Phaser.Scene, srcKey: string, frame: string | number = 0): string | null {
  const key = `${srcKey}_body`;
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists(srcKey)) return null;
  const src = scene.textures.getFrame(srcKey, frame);
  if (!src || src.width < 64) return null;
  const tex = scene.textures.createCanvas(key, 64, 64);
  if (!tex) return null;
  const ctx = tex.getContext();
  ctx.drawImage(src.source.image as CanvasImageSource, src.cutX, src.cutY, 64, 64, 0, 0, 64, 64);
  const img = ctx.getImageData(0, 0, 64, 64);
  const d = img.data;
  const erased = new Uint8Array(64 * 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const arm = (y >= 25 && y <= 37 && x >= 37) || (y >= 17 && y <= 24 && x >= 40);
      if (!arm) continue;
      const i = (y * 64 + x) * 4;
      if (d[i + 3] === 0) continue;
      d[i + 3] = 0;
      erased[y * 64 + x] = 1;
    }
  }
  // 切口補外框
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 63; x++) {
      if (!erased[y * 64 + x + 1]) continue;
      const i = (y * 64 + x) * 4;
      if (d[i + 3] === 0) continue;
      d[i] = 20;
      d[i + 1] = 8;
      d[i + 2] = 4;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}
