import Phaser from 'phaser';
import { PAD, weaponArt, type PartName, type WeaponArtInfo } from '../art/WeaponArt';
import { getFirearm, getMelee, type FirearmDef } from '../data/weapons';
import { Fx } from '../fx/Fx';

/** 手臂與手的顏色（主角固定；隊員依外觀換色） */
export interface RigColors {
  sleeve: number;
  sleeveHi: number;
  skin: number;
}

export const PLAYER_RIG_COLORS: RigColors = { sleeve: 0x623b27, sleeveHi: 0x6d442d, skin: 0xd1a085 };

export interface RigPose {
  footX: number;
  footY: number;
  /** 1 右、-1 左 */
  facing: number;
  /** 瞄準角度（世界座標，弧度） */
  aim: number;
  /** 走路上下顛簸（像素） */
  bob: number;
  depth: number;
  /** 體型縮放（隊員有高矮胖瘦） */
  scale?: number;
}

/** 近戰揮擊姿勢（MeleeSystem.pose） */
export interface MeleePose {
  id: string;
  /** ready：近戰模式沒在揮，武器舉在身前備戰 */
  phase: 'ready' | 'windup' | 'active' | 'recovery';
  k: number;
  dir: number;
  /** 刀類連段的收尾突刺 */
  thrust?: boolean;
}

type Pt = { lx: number; ly: number } | { wx: number; wy: number };
interface Lerp {
  from: Pt;
  to: Pt;
  t: number;
}

type ReloadKind = 'magazine' | 'single' | 'revolver' | 'break' | 'belt';

interface ReloadAnim {
  kind: ReloadKind;
  t: number;
  dur: number;
  empty: boolean;
  /** 已經做過的事件（掉彈匣、退殼…），避免重複 */
  done: Set<string>;
}

const OUTLINE = 0x140804;
const ease = (k: number) => k * k * (3 - 2 * k);
const seg = (k: number, a: number, b: number) => Phaser.Math.Clamp((k - a) / (b - a), 0, 1);

function reloadKind(d: FirearmDef): ReloadKind {
  if (d.reload === 'magazine') return 'magazine';
  if (d.reload === 'single') return 'single';
  if (d.cls === 'revolver') return 'revolver';
  if (d.cls === 'lmg') return 'belt';
  return 'break';
}

/**
 * 角色手上的武器：身體是擦掉手臂的貼圖，手臂、槍、近戰武器都由這裡即時畫。
 *
 * - 槍以握把為軸跟著瞄準轉動；手槍手伸直、長槍抵肩，護木手扶在護木上
 * - 開槍：槍往後頓＋槍口上揚，滑套／槍機後退再回來；泵動、栓動在上膛時才拉
 * - 換彈：依裝填方式演出（換彈匣、一顆顆塞、左輪甩轉輪、雙管折槍、機槍掀蓋換彈箱），
 *   彈匣與彈殼真的會掉到地上
 * - 近戰：收起槍，手上換成近戰武器揮一圈
 */
export class WeaponRig {
  private parts = new Map<PartName, Phaser.GameObjects.Image>();
  private art?: WeaponArtInfo;
  private def?: FirearmDef;
  private meleeImg?: Phaser.GameObjects.Image;
  private held: Phaser.GameObjects.Image;
  private flashImg: Phaser.GameObjects.Image;
  private back: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;
  weaponId = '';

  private kick = 0;
  private kickRot = 0;
  /** 滑套／槍機後退量 0..1 */
  private actionK = 0;
  private actionAnim: { t: number; delay: number; dur: number; snap: boolean } | null = null;
  private hingeK = 0;
  private reload: ReloadAnim | null = null;
  /** 一顆顆塞：每塞一顆的循環計時 */
  private roundT = 0;
  private perRound = 0.5;
  private clipNext = false;
  private flashLeft = 0;
  private melee: MeleePose | null = null;
  private visible = true;
  /** 最近一次算出來的世界座標（槍口、拋殼口、彈匣） */
  private cache = { muzzleX: 0, muzzleY: 0, ejectX: 0, ejectY: 0, angle: 0, floorY: 0 };

  constructor(
    private scene: Phaser.Scene,
    private colors: RigColors = PLAYER_RIG_COLORS,
  ) {
    this.back = scene.add.graphics();
    this.front = scene.add.graphics();
    this.held = scene.add.image(0, 0, 'round_small').setVisible(false);
    this.flashImg = scene.add.image(0, 0, 'flash_s').setOrigin(0, 0.5).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
  }

  get muzzle(): { x: number; y: number; angle: number } {
    return { x: this.cache.muzzleX, y: this.cache.muzzleY, angle: this.cache.angle };
  }

  get eject(): { x: number; y: number } {
    return { x: this.cache.ejectX, y: this.cache.ejectY };
  }

  setWeapon(id: string): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.parts.forEach((p) => p.destroy());
    this.parts.clear();
    this.art = weaponArt(id);
    this.def = getFirearm(id);
    this.reload = null;
    this.actionAnim = null;
    this.actionK = 0;
    this.hingeK = 0;
    if (!this.art) return;
    // 繪製順序：轉開的部件、彈匣在主體後面，滑套／槍機在最上面
    for (const name of ['hinge', 'mag', 'body', 'action'] as PartName[]) {
      if (!this.art.parts.includes(name)) continue;
      this.parts.set(name, this.scene.add.image(0, 0, `wpn_${id}_${name}`));
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  // ── 事件 ─────────────────────────────────────────────

  /** 開了一槍：後座＋滑套後退（泵動、栓動不動，等上膛） */
  fire(): void {
    const d = this.def;
    if (!d) return;
    const heavy = d.cls === 'shotgun' || d.cls === 'sniper' || d.cls === 'revolver';
    this.kick = heavy ? 4 : d.cls === 'pistol' ? 2.5 : 1.6;
    this.kickRot = d.climbPerShot * (heavy ? 3 : 2) + 4;
    if (!d.cycleSound) this.actionAnim = { t: 0, delay: 0, dur: Math.max(0.05, Math.min(0.12, 0.6 / d.fireRate)), snap: true };
    this.flashLeft = 0.05;
    const tex = d.pellets > 1 ? 'flash_wide' : d.cls === 'sniper' || d.cls === 'revolver' ? 'flash_l' : d.cls === 'rifle' || d.cls === 'lmg' ? 'flash_m' : 'flash_s';
    this.flashImg.setTexture(tex);
  }

  /** 泵動／栓動上膛（delay 秒後拉） */
  cycle(delay: number): void {
    this.actionAnim = { t: 0, delay, dur: 0.32, snap: false };
  }

  rack(): void {
    this.actionAnim = { t: 0, delay: 0, dur: 0.3, snap: false };
  }

  /** auto：沒有逐顆事件（夥伴），一顆顆塞的手部動作自己循環 */
  private autoRounds = false;

  startReload(duration: number, empty: boolean, auto = false): void {
    this.autoRounds = auto;
    const d = this.def;
    if (!d) return;
    this.reload = { kind: reloadKind(d), t: 0, dur: Math.max(0.2, duration), empty, done: new Set() };
    this.perRound = d.perRound ?? 0.5;
    this.roundT = -(d.reloadTime ?? 0.2);
    this.clipNext = !!d.clip && empty;
  }

  /** 一顆顆塞：塞進一顆（重新開始一次「拿子彈 → 塞進去」的手部循環） */
  roundIn(clip: boolean): void {
    this.roundT = 0;
    this.clipNext = false;
    if (clip) this.held.setTexture('round_small');
  }

  endReload(): void {
    this.reload = null;
    this.hingeK = 0;
    this.parts.get('mag')?.setVisible(true);
    this.held.setVisible(false);
  }

  setMelee(p: MeleePose | null): void {
    this.melee = p;
  }

  /** 角色影格自己畫了手與武器（AI 揮擊影格）時，WeaponRig 整個不畫 */
  bodyDrawsArms = false;

  // ── 每幀 ─────────────────────────────────────────────

  update(dt: number, pose: RigPose): void {
    const s = pose.scale ?? 1;
    const flip = pose.facing < 0 ? -1 : 1;
    this.kick = Math.max(0, this.kick - dt * 30);
    this.kickRot = Math.max(0, this.kickRot - dt * 70);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.tickAction(dt);
    if (this.reload) this.reload.t += dt;
    this.roundT += dt;
    if (this.autoRounds && this.roundT > this.perRound) this.roundT -= this.perRound;

    const b = this.back;
    const f = this.front;
    b.clear().setDepth(pose.depth + 0.001);
    f.clear().setDepth(pose.depth + 0.006);

    // 肩膀：前肩（扳機手）、後肩（護木手）
    const sx = pose.footX + 3 * flip * s;
    const sy = pose.footY - 35 * s - pose.bob;
    const s2x = pose.footX - 1 * flip * s;
    const s2y = pose.footY - 34 * s - pose.bob;

    if (this.bodyDrawsArms) {
      this.meleeImg?.setVisible(false);
      this.parts.forEach((p) => p.setVisible(false));
      return;
    }
    if (this.melee) {
      this.drawMelee(pose, sx, sy, s2x, s2y, s, flip);
      return;
    }
    this.meleeImg?.setVisible(false);
    const art = this.art;
    if (!art || !this.visible) {
      this.parts.forEach((p) => p.setVisible(false));
      return;
    }
    const map = art.map;

    // 換彈姿勢：槍口上抬多少、護木手要去哪
    const rl = this.reload;
    let tilt = 0;
    let support: Pt | Lerp | null = null;
    let heldTex: string | null = null;
    let magOut = 0;
    let magHidden = false;
    let hinge = 0;
    const belt = { wx: pose.footX - 3 * flip * s, wy: pose.footY - 22 * s };
    if (rl) {
      const k = rl.t / rl.dur;
      const tin = ease(seg(k, 0, 0.15));
      const tout = ease(seg(k, 0.88, 1));
      const magL = map.mag ? { lx: map.mag.x + 1 - map.grip[0], ly: map.mag.y + map.mag.map.length - map.grip[1] } : { lx: 2, ly: 3 };
      const ejectL = { lx: map.eject[0] - map.grip[0], ly: map.eject[1] - map.grip[1] + 1 };
      const actL = map.action ? { lx: map.action.x - map.grip[0], ly: map.action.y - map.grip[1] } : ejectL;
      switch (rl.kind) {
        case 'magazine': {
          tilt = 22 * (tin - tout);
          if (k >= 0.15) {
            this.once(rl, 'drop', () => this.dropMag(pose));
            magHidden = k < 0.7;
          }
          if (k < 0.15) support = null;
          else if (k < 0.45) support = this.lerpTo(magL, belt, ease(seg(k, 0.15, 0.45)));
          else if (k < 0.7) {
            support = this.lerpTo(belt, magL, ease(seg(k, 0.45, 0.7)));
            heldTex = this.weaponId && this.scene.textures.exists(`wpn_${this.weaponId}_magdrop`) ? `wpn_${this.weaponId}_magdrop` : null;
          } else if (rl.empty && k < 0.88) {
            support = actL;
            if (k > 0.78) this.actionK = k < 0.84 ? 1 : 0;
          }
          magOut = k >= 0.7 && k < 0.74 ? 1 : 0;
          break;
        }
        case 'single': {
          tilt = 12 * (1 - tout);
          const per = this.perRound;
          const c = Phaser.Math.Clamp(this.roundT / per, 0, 1);
          // 從腰間拿一顆 → 送進裝填口；clip（橋夾）送到槍機上方
          const port = this.clipNext ? actL : ejectL;
          support = c < 0.5 ? this.lerpTo(port, belt, ease(c * 2)) : this.lerpTo(belt, port, ease((c - 0.5) * 2));
          if (c >= 0.5 && c < 1) heldTex = this.clipNext ? 'speedloader' : this.def?.ammo === '12ga' ? 'shell_12ga' : 'round_small';
          if (this.def?.cycleSound === 'bolt') this.actionK = Math.max(this.actionK, 1 - tout);
          break;
        }
        case 'revolver': {
          tilt = 55 * (tin - tout);
          magOut = k > 0.1 && k < 0.82 ? 1 : 0;
          if (k > 0.2) this.once(rl, 'casings', () => this.dropCasings(pose, 6, 'shell_pistol'));
          if (k > 0.25 && k < 0.5) support = this.lerpTo(magL, belt, ease(seg(k, 0.25, 0.5)));
          else if (k >= 0.5 && k < 0.78) {
            support = this.lerpTo(belt, magL, ease(seg(k, 0.5, 0.78)));
            heldTex = 'speedloader';
          }
          break;
        }
        case 'break': {
          hinge = ease(seg(k, 0.05, 0.18)) * (1 - ease(seg(k, 0.8, 0.88)));
          tilt = -10 * (tin - tout);
          if (k > 0.2) this.once(rl, 'casings', () => this.dropCasings(pose, 2, 'shell_12ga', true));
          if (k > 0.25 && k < 0.5) support = this.lerpTo(ejectL, belt, ease(seg(k, 0.25, 0.5)));
          else if (k >= 0.5 && k < 0.78) {
            support = this.lerpTo(belt, ejectL, ease(seg(k, 0.5, 0.78)));
            heldTex = 'shell_12ga';
          }
          break;
        }
        case 'belt': {
          tilt = 10 * (tin - tout);
          hinge = ease(seg(k, 0.04, 0.12)) * (1 - ease(seg(k, 0.78, 0.84)));
          if (k > 0.16) {
            this.once(rl, 'drop', () => this.dropMag(pose));
            magHidden = k < 0.72;
          }
          if (k > 0.2 && k < 0.45) support = this.lerpTo(magL, belt, ease(seg(k, 0.2, 0.45)));
          else if (k >= 0.45 && k < 0.72) {
            support = this.lerpTo(belt, magL, ease(seg(k, 0.45, 0.72)));
            heldTex = `wpn_${this.weaponId}_magdrop`;
          } else if (k >= 0.86 && k < 0.95) {
            support = actL;
            this.actionK = k < 0.91 ? 1 : 0;
          }
          break;
        }
      }
    }
    this.hingeK += (hinge - this.hingeK) * Math.min(1, dt * 30);

    // 槍的角度：瞄準 + 後座上揚 + 換彈上抬（畫面上往上 = 角度往 -flip）
    const a = pose.aim - flip * Phaser.Math.DegToRad(this.kickRot + tilt);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // 局部（槍身座標，x 沿槍管、y 往槍的下方）→ 世界
    const reach = (map.reach - this.kick) * s;
    const gx = sx + Math.cos(pose.aim) * reach - Math.sin(pose.aim) * map.drop * flip * s;
    const gy = sy + Math.sin(pose.aim) * reach + Math.cos(pose.aim) * map.drop * flip * s;
    const toW = (lx: number, ly: number) => ({ x: gx + (lx * cos - ly * flip * sin) * s, y: gy + (lx * sin + ly * flip * cos) * s });

    // 部件
    const ox = map.grip[0] + PAD + 0.5;
    const oy = map.grip[1] + PAD + 0.5;
    for (const [name, img] of this.parts) {
      img.setVisible(true).setScale(s).setFlipY(flip < 0).setDepth(pose.depth + (name === 'action' ? 0.005 : name === 'body' ? 0.004 : 0.003));
      let lx = 0;
      let ly = 0;
      let rot = a;
      if (name === 'action' && map.action) {
        lx = map.action.travel[0] * this.actionK;
        ly = map.action.travel[1] * this.actionK;
      }
      if (name === 'mag') {
        img.setVisible(!magHidden);
        ly = magOut * (this.def?.cls === 'revolver' ? 3 : 2);
      }
      if (name === 'hinge' && map.hinge) {
        // 轉開的部件以自己的軸旋轉
        const [px, py] = map.hinge.pivot;
        img.setOrigin((px + PAD + 0.5) / art.w, flip < 0 ? 1 - (py + PAD + 0.5) / art.h : (py + PAD + 0.5) / art.h);
        const p = toW(px - map.grip[0], py - map.grip[1]);
        rot = a + flip * Phaser.Math.DegToRad(map.hinge.openDeg * this.hingeK);
        img.setPosition(p.x, p.y).setRotation(rot);
        continue;
      }
      img.setOrigin(ox / art.w, flip < 0 ? 1 - oy / art.h : oy / art.h);
      const p = toW(lx, ly);
      img.setPosition(p.x, p.y).setRotation(rot);
    }

    // 錨點
    const mz = toW(map.muzzle[0] - map.grip[0] + 1, map.muzzle[1] - map.grip[1]);
    const ej = toW(map.eject[0] - map.grip[0], map.eject[1] - map.grip[1]);
    this.cache = { muzzleX: mz.x, muzzleY: mz.y, ejectX: ej.x, ejectY: ej.y, angle: a, floorY: pose.footY };
    if (this.flashLeft > 0) {
      this.flashImg.setVisible(true).setPosition(mz.x, mz.y).setRotation(a).setScale(s).setDepth(pose.depth + 0.008);
    } else this.flashImg.setVisible(false);

    // 手：扳機手在握把；護木手在護木（泵動護木會跟著動），換彈時去拿東西
    const grip = { x: gx, y: gy };
    let hand2: { x: number; y: number };
    const resolve = (p: Pt) => ('wx' in p ? { x: p.wx, y: p.wy } : toW(p.lx, p.ly));
    if (support && 'from' in support) {
      const p1 = resolve(support.from);
      const p2 = resolve(support.to);
      hand2 = { x: p1.x + (p2.x - p1.x) * support.t, y: p1.y + (p2.y - p1.y) * support.t };
    } else if (support) hand2 = resolve(support);
    else if (map.fore) {
      let fx = map.fore[0] - map.grip[0];
      const fy = map.fore[1] - map.grip[1];
      if (map.action && this.def?.cycleSound === 'pump') fx += map.action.travel[0] * this.actionK;
      hand2 = toW(fx, fy);
    } else hand2 = toW(1, 1);

    this.arm(b, s2x, s2y, hand2.x, hand2.y);
    this.arm(f, sx, sy, grip.x, grip.y);
    this.hand(f, grip.x, grip.y);
    this.hand(f, hand2.x, hand2.y);

    if (heldTex && this.scene.textures.exists(heldTex)) {
      this.held.setTexture(heldTex).setVisible(true).setPosition(hand2.x, hand2.y + 1).setRotation(a).setFlipY(flip < 0).setScale(s).setDepth(pose.depth + 0.007);
    } else this.held.setVisible(false);
  }

  private lerpTo(from: Pt, to: Pt, t: number): Lerp {
    return { from, to, t };
  }

  private once(rl: ReloadAnim, key: string, fn: () => void): void {
    if (rl.done.has(key)) return;
    rl.done.add(key);
    fn();
  }

  private tickAction(dt: number): void {
    const an = this.actionAnim;
    if (!an) return;
    an.t += dt;
    const k = (an.t - an.delay) / an.dur;
    if (k < 0) return;
    if (k >= 1) {
      this.actionK = 0;
      this.actionAnim = null;
      return;
    }
    // 後座：瞬間退到底再彈回；手動上膛：拉到底停一下再推回
    this.actionK = an.snap ? 1 - k : k < 0.45 ? ease(k / 0.45) : k < 0.55 ? 1 : 1 - ease((k - 0.55) / 0.45);
  }

  private dropMag(pose: RigPose): void {
    const key = `wpn_${this.weaponId}_magdrop`;
    const fx = Fx.of(this.scene);
    if (!fx || !this.scene.textures.exists(key) || !this.art?.map.mag) return;
    const m = this.parts.get('mag');
    fx.drop(key, m?.x ?? pose.footX, (m?.y ?? pose.footY - 30) + 4, {
      vx: -pose.facing * 10,
      vy: 20,
      floorY: pose.footY + 2,
      spin: 200 * pose.facing,
      life: 6,
      flipX: pose.facing < 0,
    });
  }

  private dropCasings(pose: RigPose, n: number, key: string, fling = false): void {
    const fx = Fx.of(this.scene);
    if (!fx) return;
    const e = this.eject;
    for (let i = 0; i < n; i++) {
      fx.drop(key, e.x, e.y, {
        vx: -pose.facing * (fling ? Phaser.Math.Between(50, 80) : Phaser.Math.Between(-10, 15)),
        vy: fling ? -Phaser.Math.Between(80, 120) : Phaser.Math.Between(0, 30),
        floorY: pose.footY + Phaser.Math.Between(-2, 3),
        spin: Phaser.Math.Between(-700, 700),
        life: 4,
      });
    }
  }

  /** 像素風手臂：深色外框 + 袖子顏色，逐點畫，不會糊 */
  private arm(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))));
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push([Math.round(x1 + ((x2 - x1) * i) / n), Math.round(y1 + ((y2 - y1) * i) / n)]);
    g.fillStyle(OUTLINE, 1);
    for (const [x, y] of pts) g.fillRect(x - 2, y - 2, 5, 5);
    g.fillStyle(this.colors.sleeve, 1);
    for (const [x, y] of pts) g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle(this.colors.sleeveHi, 1);
    for (const [x, y] of pts) g.fillRect(x - 1, y - 1, 3, 1);
  }

  private hand(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const hx = Math.round(x);
    const hy = Math.round(y);
    g.fillStyle(OUTLINE, 1).fillRect(hx - 2, hy - 2, 5, 5);
    g.fillStyle(this.colors.skin, 1).fillRect(hx - 1, hy - 1, 3, 3);
  }

  /** 近戰：槍收起來，手上換成近戰武器，依揮擊階段畫角度 */
  private drawMelee(pose: RigPose, sx: number, sy: number, s2x: number, s2y: number, s: number, flip: number): void {
    const m = this.melee!;
    this.parts.forEach((p) => p.setVisible(false));
    this.held.setVisible(false);
    this.flashImg.setVisible(false);
    const def = getMelee(m.id);
    const art = weaponArt(m.id);
    if (!def || !art) return;
    if (!this.meleeImg || this.meleeImg.texture.key !== `wpn_${m.id}_body`) {
      this.meleeImg?.destroy();
      this.meleeImg = this.scene.add.image(0, 0, `wpn_${m.id}_body`);
    }
    const img = this.meleeImg.setVisible(true);
    const heavy = def.swing === 'heavy';
    const stab = def.id === 'knife' || !!m.thrust;
    // 角度（度，往上為正）：起手舉起 → 判定時劈下 → 收招回到前方
    const raise = heavy ? 115 : 80;
    const low = heavy ? -55 : -40;
    let up: number;
    let reach = 0;
    if (m.phase === 'ready') {
      // 備戰：刀舉在身前、鈍器扛在肩上，隨呼吸微微晃
      const sway = Math.sin(this.scene.time.now / 260) * 3;
      up = (heavy ? 60 : def.id === 'knife' ? 12 : 30) + sway;
    } else if (stab) {
      up = 0;
      reach = m.phase === 'windup' ? -5 * ease(m.k) : m.phase === 'active' ? -5 + 13 * ease(m.k) : 8 * (1 - ease(m.k));
    } else if (m.dir < 0 && !heavy) {
      // 反手：由下往上掃
      up = m.phase === 'windup' ? low * ease(m.k) : m.phase === 'active' ? low + (raise - low) * ease(m.k) : raise * (1 - ease(m.k));
    } else {
      up = m.phase === 'windup' ? raise * ease(m.k) : m.phase === 'active' ? raise + (low - raise) * ease(m.k) : low * (1 - ease(m.k));
    }
    const base = flip > 0 ? 0 : Math.PI;
    const a = base - flip * Phaser.Math.DegToRad(up);
    const r = (art.map.reach + reach) * s * 0.7;
    const gx = sx + Math.cos(a) * r * 0.6;
    const gy = sy + Math.sin(a) * r * 0.6 + 2 * s;
    const ox = art.map.grip[0] + PAD + 0.5;
    const oy = art.map.grip[1] + PAD + 0.5;
    img
      .setOrigin(ox / art.w, flip < 0 ? 1 - oy / art.h : oy / art.h)
      .setPosition(gx, gy)
      .setRotation(a)
      .setFlipY(flip < 0)
      .setScale(s)
      .setDepth(pose.depth + 0.004);
    this.arm(this.front, sx, sy, gx, gy);
    // 雙手武器：後手握在握柄後段
    if (heavy) {
      const hx = gx - Math.cos(a) * 3 * s;
      const hy = gy - Math.sin(a) * 3 * s;
      this.arm(this.back, s2x, s2y, hx, hy);
      this.hand(this.front, hx, hy);
    }
    this.hand(this.front, gx, gy);
  }

  destroy(): void {
    this.parts.forEach((p) => p.destroy());
    this.meleeImg?.destroy();
    this.held.destroy();
    this.flashImg.destroy();
    this.back.destroy();
    this.front.destroy();
  }
}
