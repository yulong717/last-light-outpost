import Phaser from 'phaser';

/**
 * 末日像素 UI 的共用外觀：鏽鐵框面板、像素圖示、分格血條。
 * 所有介面（夜晚 HUD、白天布置、探索、劇情對話框）都從這裡畫，風格才會一致。
 * 座標都是邏輯像素（640×360），1 邏輯像素 = 一格像素，畫出來就是硬邊像素風。
 */
export const PAL = {
  ink: 0x0a0a0c,
  /** 面板底色（壓暗的焦油黑） */
  fill: 0x141311,
  /** 鏽鐵框 */
  frame: 0x4a4038,
  frameHi: 0x7a6a58,
  frameLo: 0x26201c,
  rivet: 0xa89478,
  /** 按鈕底 */
  plate: 0x2b2622,
  plateHover: 0x3d352d,
  platePress: 0x56493b,
  plateOff: 0x1a1816,
  /** 強調色：警示黃 */
  amber: 0xf2c14e,
  blood: 0xd8402f,
  hp: 0xe0483e,
  hpLo: 0x7a1d17,
  base: 0x7cbf4f,
  baseLo: 0x2f5a1f,
  wood: 0xc08a52,
  woodLo: 0x5c3b1f,
  stamina: 0x58c4e8,
  staminaLo: 0x1d4a5c,
  brass: 0xd4a347,
} as const;

export type PanelTone = 'default' | 'amber' | 'danger' | 'ok';

const TONE_ACCENT: Record<PanelTone, number> = {
  default: PAL.frameHi,
  amber: PAL.amber,
  danger: PAL.blood,
  ok: PAL.base,
};

export interface PanelOpts {
  fill?: number;
  alpha?: number;
  /** 上緣的油漆標記色（區分面板用途） */
  tone?: PanelTone;
  /** 四角鉚釘（小面板可以關掉） */
  rivets?: boolean;
  /** 左上角黃黑警示條 */
  hazard?: boolean;
}

/**
 * 鏽鐵框面板：外黑線、2 像素斜面鐵框、內黑線、半透明底，四角鉚釘。
 * 框本身佔 4 像素，內容請從 x+5、y+5 開始放。
 */
export function drawPanel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  g.fillStyle(PAL.ink, 1).fillRect(x, y, w, h);
  g.fillStyle(PAL.frame, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle(PAL.frameHi, 1).fillRect(x + 1, y + 1, w - 2, 1).fillRect(x + 1, y + 1, 1, h - 2);
  g.fillStyle(PAL.frameLo, 1).fillRect(x + 1, y + h - 2, w - 2, 1).fillRect(x + w - 2, y + 2, 1, h - 3);
  g.fillStyle(PAL.ink, 1).fillRect(x + 3, y + 3, w - 6, h - 6);
  g.fillStyle(o.fill ?? PAL.fill, o.alpha ?? 0.9).fillRect(x + 4, y + 4, w - 8, h - 8);
  const accent = TONE_ACCENT[o.tone ?? 'default'];
  if (o.tone && o.tone !== 'default') g.fillStyle(accent, 0.9).fillRect(x + 4, y + 4, w - 8, 1);
  if (o.hazard) hazardStripe(g, x + 6, y - 2, Math.min(36, w - 12), 4);
  if (o.rivets ?? (w >= 24 && h >= 20)) {
    for (const [rx, ry] of [
      [x + 1, y + 1],
      [x + w - 3, y + 1],
      [x + 1, y + h - 3],
      [x + w - 3, y + h - 3],
    ]) {
      g.fillStyle(PAL.rivet, 1).fillRect(rx, ry, 2, 2);
      g.fillStyle(PAL.frameLo, 1).fillRect(rx + 1, ry + 1, 1, 1);
    }
  }
}

/** 黃黑斜紋警示條 */
export function hazardStripe(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(PAL.ink, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      g.fillStyle(((i + j) >> 1) % 2 === 0 ? PAL.amber : 0x1a1714, 1).fillRect(x + i, y + j, 1, 1);
    }
  }
}

export interface PlateOpts {
  fill?: number;
  /** 0 一般、1 滑過、2 按下 */
  state?: 0 | 1 | 2;
  enabled?: boolean;
  /** 邊框強調（選中、可用） */
  accent?: number;
  /** 切角（觸控按鈕用八角形） */
  chamfer?: number;
}

/** 按鈕底板：鐵片斜面，按下時往下沉 1 像素 */
export function drawPlate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, o: PlateOpts = {}): void {
  x = Math.round(x);
  y = Math.round(y);
  const enabled = o.enabled ?? true;
  const st = enabled ? o.state ?? 0 : 0;
  const base = !enabled ? PAL.plateOff : st === 2 ? PAL.platePress : st === 1 ? lighten(o.fill ?? PAL.plate, 0.12) : o.fill ?? PAL.plate;
  const c = o.chamfer ?? 1;
  const sink = st === 2 ? 1 : 0;
  // 外框（切角）
  chamferRect(g, x, y, w, h, c, PAL.ink, 1);
  // 底部厚度（按下時消失）
  if (!sink) chamferRect(g, x + 1, y + 1, w - 2, h - 2, c, darken(base, 0.45), 1);
  chamferRect(g, x + 1, y + 1 + sink, w - 2, h - 3, c, base, enabled ? 0.96 : 0.85);
  // 頂部高光
  if (enabled) g.fillStyle(lighten(base, 0.28), 1).fillRect(x + 1 + c, y + 1 + sink, w - 2 - 2 * c, 1);
  if (o.accent !== undefined && enabled) {
    g.lineStyle(1, o.accent, 0.95);
    g.strokeRect(x + 1.5, y + 1.5 + sink, w - 3, h - 4);
  }
}

function chamferRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, c: number, color: number, alpha: number): void {
  g.fillStyle(color, alpha);
  if (c <= 0) {
    g.fillRect(x, y, w, h);
    return;
  }
  g.fillRect(x + c, y, w - 2 * c, h);
  for (let i = 0; i < c; i++) {
    const inset = c - i;
    g.fillRect(x + i, y + inset, 1, h - 2 * inset);
    g.fillRect(x + w - 1 - i, y + inset, 1, h - 2 * inset);
  }
}

export function lighten(c: number, k: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (Math.round(r + (255 - r) * k) << 16) | (Math.round(g + (255 - g) * k) << 8) | Math.round(b + (255 - b) * k);
}

export function darken(c: number, k: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return (Math.round(r * (1 - k)) << 16) | (Math.round(g * (1 - k)) << 8) | Math.round(b * (1 - k));
}

// ───────────────────────── 像素圖示 ─────────────────────────

const ICON_COLORS: Record<string, number> = {
  k: PAL.ink,
  w: 0xf2ece0,
  r: PAL.hp,
  R: PAL.hpLo,
  y: PAL.amber,
  o: PAL.brass,
  O: 0x8a6a2a,
  g: PAL.base,
  G: PAL.baseLo,
  b: PAL.wood,
  B: PAL.woodLo,
  c: PAL.stamina,
  C: PAL.staminaLo,
  s: 0x8f969e,
  S: 0xc9ced4,
  d: 0x4b5058,
  m: 0x6e7a3a,
  M: 0x3f4a1e,
  p: 0xe8b796,
  P: 0xa8735a,
};

/** 像素圖示：每個字元一格，'.' 透明。名稱 → ui_ic_<name> 貼圖 */
const ICONS: Record<string, string[]> = {
  heart: [
    '.kkk.kkk.',
    'krrrkrwrk',
    'krrrrrrwk',
    'krrrrrrrk',
    '.kRrrrrk.',
    '..kRrrk..',
    '...kRk...',
    '....k....',
  ],
  base: [
    '....k....',
    '...kgk...',
    '..kgggk..',
    '.kgggggk.',
    'kkkkkkkkk',
    '.kbbbbbk.',
    '.kbkkkbk.',
    '.kbkykbk.',
    '.kkkkkkk.',
  ],
  barricade: [
    'kk.....kk',
    'kBkkkkkBk',
    'kbbbbbbbk',
    'kBkkkkkBk',
    'kbbbbbbbk',
    'kBkkkkkBk',
    'kbbbbbbbk',
    'kBkkkkkBk',
    'kk.....kk',
  ],
  bolt: [
    '...kkkk',
    '..kcck.',
    '.kcck..',
    'kcccckk',
    'kkkccck',
    '..kcck.',
    '.kcck..',
    '.kck...',
    '.kk....',
  ],
  skull: [
    '.kkkkkk.',
    'kwwwwwwk',
    'kwwwwwwk',
    'kwkkwkkk',
    'kwkkwkkk',
    'kwwwkwwk',
    '.kwwwwk.',
    '.kwkwkk.',
    '..kkkk..',
  ],
  scrap: [
    '..kkkk..',
    '.kSSSSk.',
    'kSSkkSSk',
    'kSk..kSk',
    'kSk..kSk',
    'kssksssk',
    '.kssssk.',
    '..kkkk..',
  ],
  reload: [
    '..kkkkk...',
    '.kyyyyyk..',
    'kykkkkkyk.',
    'kyk...kykk',
    'kyk..kyyyk',
    'kyk...kyk.',
    'kyk....k..',
    'kykk....k.',
    '.kyykkkyk.',
    '..kyyyyk..',
    '...kkkk...',
  ],
  swap: [
    '.....k....',
    'kkkkkyk...',
    'kyyyyyyk..',
    'kkkkkyk...',
    '.....k....',
    '....k.....',
    '...kykkkkk',
    '..kyyyyyyk',
    '...kykkkkk',
    '....k.....',
  ],
  knife: [
    '.......kk',
    '......kSk',
    '.....kSsk',
    '....kSsk.',
    '...kSsk..',
    '.kkSsk...',
    '.kbkk....',
    'kbBk.....',
    'kkk......',
  ],
  gun: [
    'kkkkkkkkkk',
    'ksssssssSk',
    'kkkkssskkk',
    '..kbbkk...',
    '..kbBk....',
    '..kbbk....',
    '..kkkk....',
  ],
  grenade: [
    '...kkk...',
    '..kSkSk..',
    '...kkkkk.',
    '..kmmmk..',
    '.kmMmMmk.',
    '.kmmmmmk.',
    '.kMmMmMk.',
    '.kmmmmmk.',
    '..kMmMk..',
    '...kkk...',
  ],
  medkit: [
    '...kkk...',
    '..kk.kk..',
    'kkkkkkkkk',
    'kwwwwwwwk',
    'kwwwrwwwk',
    'kwwrrrwwk',
    'kwwwrwwwk',
    'kwwwwwwwk',
    'kkkkkkkkk',
  ],
  fist: [
    '.kkkkkk..',
    'kpkpkpkk.',
    'kpkpkpkpk',
    'kppppkkpk',
    'kpppppppk',
    'kPppppppk',
    '.kPpppPk.',
    '.kPPPPk..',
    '..kkkk...',
  ],
  crew: [
    '..kkk..',
    '.kpppk.',
    '.kpppk.',
    '..kkk..',
    '.kmmmk.',
    'kmmmmmk',
    'kmMmMmk',
    'kkkkkkk',
  ],
  sound: [
    '...k.....',
    '..kk..k..',
    'kkSk...k.',
    'kSSk.k.k.',
    'kSSk.k.k.',
    'kkSk...k.',
    '..kk..k..',
    '...k.....',
  ],
  mute: [
    '...k.....',
    '..kk.....',
    'kkSk.r.r.',
    'kSSk..r..',
    'kSSk.r.r.',
    'kkSk.....',
    '..kk.....',
    '...k.....',
  ],
  shell: ['.kk.', 'kyyk', 'kook', 'kook', 'kook', 'kOOk', 'kkkk'],
  shellEmpty: ['.kk.', 'kddk', 'kddk', 'kddk', 'kddk', 'kddk', 'kkkk'],
  pip: ['kkkk', 'kyyk', 'kOOk', 'kkkk'],
  pipEmpty: ['kkkk', 'kddk', 'kddk', 'kkkk'],
  moon: [
    '..kkkk..',
    '.kSSkk..',
    'kSSk....',
    'kSk.....',
    'kSk.....',
    'kSSk...k',
    '.kSSkkSk',
    '..kkkkk.',
  ],
};

export type IconName = keyof typeof ICONS;

export function iconKey(name: IconName): string {
  return `ui_ic_${name}`;
}

/** 建立所有 UI 圖示貼圖（重複呼叫沒關係，已存在就跳過） */
export function ensureUiTextures(scene: Phaser.Scene): void {
  for (const [name, rows] of Object.entries(ICONS)) {
    const key = `ui_ic_${name}`;
    if (scene.textures.exists(key)) continue;
    const w = Math.max(...rows.map((r) => r.length));
    const h = rows.length;
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) continue;
    const ctx = tex.getContext();
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = ICON_COLORS[row[x]];
        if (c === undefined) continue;
        ctx.fillStyle = `#${c.toString(16).padStart(6, '0')}`;
        ctx.fillRect(x, y, 1, 1);
      }
    });
    tex.refresh();
  }
}

export function icon(scene: Phaser.Scene, x: number, y: number, name: IconName, scale = 1): Phaser.GameObjects.Image {
  ensureUiTextures(scene);
  return scene.add.image(Math.round(x), Math.round(y), iconKey(name)).setOrigin(0).setScale(scale).setDepth(101);
}

// ───────────────────────── 分格血條 ─────────────────────────

export interface BarOpts {
  color: number;
  /** 底槽顏色（深色版） */
  dark?: number;
  /** 每格寬（含 1 像素間隔）；0 = 不分格 */
  seg?: number;
  depth?: number;
}

/**
 * 分格血條：黑框＋暗槽＋亮色格子；掉血時會留一段白色殘影慢慢退，看得出剛剛被打了多少。
 * 低於 25% 會閃。
 */
export class PixelBar {
  readonly g: Phaser.GameObjects.Graphics;
  private ratio = 1;
  private ghost = 1;
  private flash = 0;
  private color: number;
  pulseLow = true;

  constructor(
    private scene: Phaser.Scene,
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    private o: BarOpts,
  ) {
    this.color = o.color;
    this.g = scene.add.graphics().setDepth(o.depth ?? 100);
    this.draw();
  }

  set(r: number, color?: number): void {
    r = Phaser.Math.Clamp(Number.isFinite(r) ? r : 0, 0, 1);
    if (color !== undefined) this.color = color;
    if (r < this.ratio - 0.001) this.flash = 1;
    if (r > this.ghost) this.ghost = r;
    this.ratio = r;
  }

  /** 每幀呼叫：殘影退回、低血量閃爍 */
  update(dt: number): void {
    if (this.ghost > this.ratio) this.ghost = Math.max(this.ratio, this.ghost - dt * 0.5);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.draw();
  }

  private draw(): void {
    const { x, y, w, h } = this;
    const g = this.g.clear();
    const seg = this.o.seg ?? 0;
    const dark = this.o.dark ?? darken(this.color, 0.7);
    g.fillStyle(PAL.ink, 1).fillRect(x, y, w, h);
    g.fillStyle(dark, 1).fillRect(x + 1, y + 1, w - 2, h - 2);
    const inner = w - 2;
    const fw = Math.round(inner * this.ratio);
    const gw = Math.round(inner * this.ghost);
    if (gw > fw) g.fillStyle(0xf2ece0, 0.85).fillRect(x + 1 + fw, y + 1, gw - fw, h - 2);
    let col = this.color;
    if (this.pulseLow && this.ratio > 0 && this.ratio < 0.25 && Math.floor(this.scene.time.now / 180) % 2 === 0) col = lighten(col, 0.35);
    if (this.flash > 0) col = lighten(col, this.flash * 0.6);
    g.fillStyle(col, 1).fillRect(x + 1, y + 1, fw, h - 2);
    // 上緣亮線，讓條看起來有厚度
    if (h >= 5) g.fillStyle(lighten(col, 0.35), 1).fillRect(x + 1, y + 1, fw, 1);
    // 分格
    if (seg > 1) {
      g.fillStyle(PAL.ink, 0.85);
      for (let sx = x + seg; sx < x + w - 1; sx += seg) g.fillRect(sx, y + 1, 1, h - 2);
    }
  }

  setVisible(v: boolean): this {
    this.g.setVisible(v);
    return this;
  }

  destroy(): void {
    this.g.destroy();
  }
}
