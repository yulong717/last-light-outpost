import Phaser from 'phaser';
import { pixelText } from '../utils/text';
import { PAL } from './theme';

/** 彈匣格最多畫幾格，再多就改成直條＋數字 */
const MAX_PIPS = 12;

export interface AimReadoutInput {
  /** 準星位置（世界座標，和 Crosshair 同一點） */
  aimX: number;
  aimY: number;
  /** 拿槍、準星看得到 */
  gun: boolean;
  ammo: number;
  magazine: number;
  /** 備彈（Infinity = 無限） */
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  weaponId: string;
  weaponName: string;
  meleeStance: boolean;
  meleeName: string;
  chain: { idx: number; len: number; streak: number; names?: string[] };
  /** 主角頭頂（近戰連段格、武器名、被抓住畫在這裡） */
  headX: number;
  headY: number;
  /** 被幾隻纏住（0 = 沒有） */
  grabbed?: number;
}

/**
 * 彈藥跟著準星：準星右側一排彈匣格，換彈是準星外的一圈進度，
 * 眼睛不必離開目標。換槍時才在準星上方短暫顯示武器名。
 * 近戰模式沒有準星：連段格與連擊數畫在主角頭上，打完一陣子就消失。
 */
export class AimReadout {
  private g: Phaser.GameObjects.Graphics;
  private count: Phaser.GameObjects.Text;
  private name: Phaser.GameObjects.Text;
  private head: Phaser.GameObjects.Text;
  private lastKey = '';
  private nameT = 0;
  private chainA = 0;
  private touch: boolean;

  constructor(scene: Phaser.Scene, depth = 97) {
    this.touch = scene.sys.game.device.input.touch;
    this.g = scene.add.graphics().setDepth(depth);
    this.count = pixelText(scene, 0, 0, '', 7, '#f2ece0').setOrigin(0, 0.5).setDepth(depth + 1).setStroke('#000000', 2);
    this.name = pixelText(scene, 0, 0, '', 8, '#f2ece0').setOrigin(0.5, 1).setDepth(depth + 1).setStroke('#000000', 3).setAlpha(0);
    this.head = pixelText(scene, 0, 0, '', 7, '#f2c14e').setOrigin(0.5, 1).setDepth(depth + 1).setStroke('#000000', 3).setAlpha(0);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.g.destroy();
      this.count.destroy();
      this.name.destroy();
      this.head.destroy();
    });
  }

  update(dt: number, s: AimReadoutInput): void {
    const g = this.g.clear();
    const cx = Math.round(s.aimX);
    const cy = Math.round(s.aimY);

    // 換槍／切近戰：武器名浮在準星（近戰時在頭上）上方一秒多
    const key = s.meleeStance ? `m:${s.meleeName}` : `g:${s.weaponId}`;
    if (key !== this.lastKey) {
      if (this.lastKey) this.nameT = 1.4;
      this.lastKey = key;
      this.name.setText(s.meleeStance ? s.meleeName : s.weaponName).setColor(s.meleeStance ? '#f2c14e' : '#f2ece0');
    }
    this.nameT = Math.max(0, this.nameT - dt);
    this.name.setAlpha(Math.min(1, this.nameT * 2.5));
    if (s.meleeStance || !s.gun) this.name.setPosition(Math.round(s.headX), Math.round(s.headY) - 10);
    else this.name.setPosition(cx, cy - 16);

    if (s.gun) this.drawAmmo(g, cx, cy, s);
    else this.count.setText('');

    // 近戰連段：頭上一排小格，揮完淡掉
    const c = s.chain;
    const active = s.meleeStance && (c.idx > 0 || c.streak > 1);
    this.chainA += ((active ? 1 : 0) - this.chainA) * Math.min(1, dt * (active ? 12 : 3));
    const hx = Math.round(s.headX);
    const hy = Math.round(s.headY);
    if (s.meleeStance && this.chainA > 0.02 && c.len > 1) {
      const n = c.len;
      const x0 = hx - Math.round((n * 6 - 1) / 2);
      for (let i = 0; i < n; i++) {
        g.fillStyle(PAL.ink, 0.8 * this.chainA).fillRect(x0 + i * 6, hy - 2, 5, 4);
        g.fillStyle(i < c.idx ? PAL.amber : 0x3a3530, this.chainA).fillRect(x0 + i * 6 + 1, hy - 1, 3, 2);
      }
    }

    // 頭上的字：被抓住最優先，其次連擊數
    if (s.grabbed) {
      this.head.setText(s.grabbed > 1 ? `被${s.grabbed}隻纏住！` : '被抓住！').setColor('#ff6b6b').setAlpha(1);
    } else if (s.meleeStance && c.streak > 1 && this.chainA > 0.02) {
      this.head.setText(`連擊 ${c.streak}`).setColor('#f2c14e').setAlpha(this.chainA);
    } else this.head.setAlpha(0);
    this.head.setPosition(hx, hy - (this.nameT > 0 && (s.meleeStance || !s.gun) ? 22 : 4));
  }

  private drawAmmo(g: Phaser.GameObjects.Graphics, cx: number, cy: number, s: AimReadoutInput): void {
    const x0 = cx + 11;
    if (s.reloading) {
      // 換彈：準星外一圈進度
      const r = 12;
      const end = -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(s.reloadProgress, 0, 1);
      g.lineStyle(3, 0x000000, 0.55).strokeCircle(cx, cy, r);
      g.lineStyle(1, 0x5a5048, 0.9).strokeCircle(cx, cy, r);
      g.lineStyle(2, PAL.amber, 1).beginPath().arc(cx, cy, r, -Math.PI / 2, end, false).strokePath();
      this.count.setText('').setPosition(x0, cy);
      return;
    }
    const mag = Math.max(1, s.magazine);
    const ratio = s.ammo / mag;
    const empty = s.ammo === 0;
    if (mag <= MAX_PIPS) {
      // 一顆顆子彈，由下往上排，打掉的從上面消失
      const ph = mag > 8 ? 2 : 3;
      const step = ph + 1;
      const h = mag * step - 1;
      const top = cy - Math.round(h / 2);
      g.fillStyle(0x000000, 0.55).fillRect(x0 - 1, top - 1, 6, h + 2);
      for (let i = 0; i < mag; i++) {
        const y = top + h - (i + 1) * step + 1;
        const full = i < s.ammo;
        g.fillStyle(full ? PAL.brass : 0x3a342e, full ? 1 : 0.8).fillRect(x0, y, 4, ph);
        if (full) g.fillStyle(0xe0844a, 1).fillRect(x0, y, 4, 1);
      }
      this.count.setText('');
    } else {
      // 大彈匣：直條＋剩幾發
      const h = 22;
      const top = cy - h / 2;
      g.fillStyle(0x000000, 0.6).fillRect(x0 - 1, top - 1, 5, h + 2);
      g.fillStyle(0x3a342e, 0.9).fillRect(x0, top, 3, h);
      const fh = Math.round(h * ratio);
      g.fillStyle(ratio < 0.25 ? PAL.blood : PAL.brass, 1).fillRect(x0, top + h - fh, 3, fh);
      this.count.setText(`${s.ammo}`).setColor(ratio < 0.25 ? '#ff6b6b' : '#f2ece0');
    }
    // 備彈只在快用完時提醒；彈匣空了提示換彈
    const reserveLow = s.reserve !== Infinity && s.reserve <= s.magazine;
    if (empty) this.count.setText(s.reserve === 0 ? '沒子彈' : this.touch ? '換彈' : '換彈 R').setColor('#ff6b6b');
    else if (reserveLow && mag <= MAX_PIPS) this.count.setText(`備${s.reserve}`).setColor(s.reserve === 0 ? '#ff6b6b' : '#b8ab98');
    else if (reserveLow) this.count.setText(`${s.ammo}/${s.reserve}`);
    this.count.setPosition(x0 + 7, cy);
  }
}
