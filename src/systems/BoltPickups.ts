import Phaser from 'phaser';
import { depthForY } from '../config';
import { AMMO } from '../data/weapons';
import type { Zombie } from '../entities/Zombie';
import { Fx } from '../fx/Fx';
import { AudioManager } from '../audio/AudioManager';
import type { AmmoPool, LandedProjectile, WeaponSystem } from './WeaponSystem';

/** 主角離多近會撿起來（腳底距離，px）；箭插在地上的高度 */
const PICK = { reach: 18, laneY: 0.5 };

interface Bolt {
  ammo: LandedProjectile['ammo'];
  img: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  /** 還插在活著的霧屍身上：跟著走，倒下才掉在屍體旁邊 */
  z?: Zombie;
  /** 插進去的位置（相對霧屍腳底） */
  dx: number;
  dy: number;
}

/**
 * 十字弓的箭：射出去之後留在戰場上，走過去就撿回備彈。
 * - 打中的箭插在霧屍身上，牠倒下時掉在屍體旁
 * - 沒打中的掉在射程盡頭的地上
 * 夜晚防守撐到天亮時 collectAll() 會把地上剩下的收回來；探索戰鬥裡沒撿的就沒了。
 */
export class BoltPickups {
  private bolts: Bolt[] = [];

  constructor(
    private scene: Phaser.Scene,
    weapons: WeaponSystem,
    private pool: AmmoPool,
    /** 箭落地時換算地面 y：槍口高度 → 主角腳底 */
    private footOffset: () => number,
    /** 地面 y 的上下限（戰場的走道範圍） */
    private clampY: (y: number) => number = (y) => y,
  ) {
    weapons.onLanded = (l) => this.add(l);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.bolts.forEach((b) => b.img.destroy()));
  }

  private add(l: LandedProjectile): void {
    const img = this.scene.add.graphics();
    const b: Bolt = { ammo: l.ammo, img, x: l.x, y: l.y, dx: 0, dy: 0 };
    if (l.z && !l.z.dead) {
      b.z = l.z;
      b.dx = Phaser.Math.Clamp(l.x - l.z.footX, -6, 6);
      b.dy = l.y - l.z.footY;
    } else {
      b.y = this.clampY(l.y + this.footOffset());
    }
    this.draw(b, !!b.z);
    this.bolts.push(b);
  }

  /** 插在身上：箭桿斜斜露在外面；掉在地上：斜插在地上，旁邊一點反光提示能撿 */
  private draw(b: Bolt, stuck: boolean): void {
    const g = b.img.clear();
    if (stuck) {
      g.lineStyle(1, 0xc9a43a, 1).lineBetween(0, 0, -6, -2);
      g.fillStyle(0x9b2b22, 1).fillRect(-7, -3, 2, 2);
    } else {
      // 地上一圈淡淡的光，箭斜插在地上（比屍體高一層，不會被壓在屍體下面）
      g.fillStyle(0xffe082, 0.22).fillEllipse(-2, 1, 16, 5);
      g.lineStyle(1, 0xe0c060, 1).lineBetween(0, 0, -7, -9);
      g.fillStyle(0xdfe4ea, 1).fillRect(0, -1, 2, 2);
      g.fillStyle(0xd84a3a, 1).fillRect(-9, -11, 3, 2);
      g.fillStyle(0xfff3c0, 1).fillRect(-4, -6, 1, 1);
    }
  }

  update(px: number, py: number): void {
    const t = this.scene.time.now;
    for (const b of [...this.bolts]) {
      if (b.z) {
        const z = b.z;
        if (z.dead || !z.active) {
          // 霧屍倒下：箭掉在屍體旁的地上
          b.z = undefined;
          b.y = this.clampY(z.footY + 2);
          b.x = z.footX + b.dx;
          this.draw(b, false);
        } else {
          b.x = z.footX + b.dx;
          b.y = z.footY + b.dy;
          b.img.setPosition(b.x, b.y).setDepth(depthForY(z.footY) + 0.01);
          continue;
        }
      }
      b.img.setPosition(b.x, b.y).setDepth(depthForY(b.y) + 0.02);
      // 一閃一閃，看得出是能撿的東西
      b.img.setAlpha(0.75 + 0.25 * Math.sin(t / 180 + b.x));
      if (Math.abs(b.x - px) <= PICK.reach && Math.abs(b.y - py) <= PICK.reach * PICK.laneY + 6) this.pick(b);
    }
  }

  private pick(b: Bolt): void {
    this.bolts = this.bolts.filter((o) => o !== b);
    b.img.destroy();
    if (this.pool[b.ammo] >= AMMO[b.ammo].max) return;
    this.pool[b.ammo]++;
    Fx.of(this.scene)?.popText(b.x, b.y - 14, '+1 箭', '#ffe082');
    AudioManager.ui('tap');
  }

  /** 撐過一夜：地上和屍體上的箭全部收回來 */
  collectAll(): number {
    let n = 0;
    for (const b of this.bolts) {
      b.img.destroy();
      if (this.pool[b.ammo] < AMMO[b.ammo].max) {
        this.pool[b.ammo]++;
        n++;
      }
    }
    this.bolts = [];
    return n;
  }
}
