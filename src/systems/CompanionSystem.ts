import Phaser from 'phaser';
import { LANE_BOTTOM, LANE_TOP } from '../config';
import { COMPANION_ROLES, MAX_DEPLOYED, deployedCrew, type CrewMember } from '../data/companions';
import { TRAIT_TUNING, traitNames } from '../data/crewTraits';
import type { Barricade } from '../entities/Barricade';
import { Companion, type CompanionShot } from '../entities/Companion';
import type { ZombieTarget, Zombie } from '../entities/Zombie';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';
import { GameEvents } from './GameEvents';

/** 全隊指令：固守據點（待在路障內側）或跟隨主角（可一起出擊） */
export type CompanionOrder = 'hold' | 'follow';

export interface CompanionHud {
  name: string;
  title: string;
  /** 特質名稱（「神槍手、近視」） */
  traits: string;
  color: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  status: string;
}

/** 主角的狀態：給醫護補血、跟隨用 */
export interface CompanionPlayerLink {
  footX: number;
  footY: number;
  facing: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  /** 補血；回傳實際補了多少 */
  heal: (amount: number) => number;
}

export interface CompanionLayout {
  /** 據點外牆內側 x（夥伴最左只能到這裡） */
  minX: number;
  /** 戰場右緣 */
  maxX: number;
  /** 路障 x：固守時站在它內側 */
  barricadeX: number;
}

type Patient = { x: number; y: number; ratio: number; heal: (a: number) => number };

/** 固守時各自站的 y，錯開避免疊在一起（主角預設在中間） */
const HOLD_Y = [LANE_TOP + 22, LANE_BOTTOM - 18, LANE_TOP + 52];
/** 跟隨時相對主角的位置（在主角左後方，靠據點那側） */
const FOLLOW_OFFSET = [
  { x: -26, y: -18 },
  { x: -28, y: 18 },
  { x: -50, y: 0 },
];

/**
 * NPC 夥伴總管：依存檔的隊伍生成夥伴，決定每個人每幀要去哪、要做什麼。
 *
 * - 射手：專心開槍。
 * - 醫護：替範圍內受傷最重的人（主角或夥伴）補血，空檔才開槍。
 * - 工兵：路障受損就到路障後面修理（修理時不開槍），沒事才開槍。
 *
 * 夥伴血歸零就永久陣亡，立刻從 GameState.crew 移除。
 * 指令：鍵盤 F 或 HUD 按鈕切換「固守／跟隨」；UI 透過場景事件 'companion-order' 送過來。
 */
export class CompanionSystem {
  readonly companions: Companion[] = [];
  order: CompanionOrder = 'hold';
  /** 入夜才接受指令（白天只是站在據點裡） */
  active = false;
  private healTimers = new Map<Companion, number>();
  /** 修理量累積，每 0.5 秒發一次 barricade:repair 事件 */
  private repairAcc = 0;
  private repairTick = 0;

  constructor(private scene: Phaser.Scene, private layout: CompanionLayout) {
    // 名冊裡選了出戰的隊員（負傷休養、設成待命的不上場）
    const crew = deployedCrew(GameState.data.crew);
    crew.forEach((member, i) => {
      const def = COMPANION_ROLES[member.role];
      if (!def) return;
      const home = this.holdSpot(member.role, i);
      const c = new Companion(scene, member, def, home.x, home.y);
      this.companions.push(c);
      this.healTimers.set(c, 0);
    });

    // 用 keydown 事件而不是每幀輪詢，快速點一下也不會漏掉
    scene.input.keyboard?.on('keydown-F', this.toggleOrder, this);
    scene.events.on('companion-order', this.toggleOrder, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.input.keyboard?.off('keydown-F', this.toggleOrder, this);
      scene.events.off('companion-order', this.toggleOrder, this);
    });
  }

  /**
   * 夜裡救到的倖存者：出戰人數還沒滿就從翻進來的位置直接加入戰鬥。回傳是否參戰。
   */
  join(member: CrewMember, x: number, y: number): boolean {
    if (this.companions.filter((c) => c.alive).length >= MAX_DEPLOYED) return false;
    const def = COMPANION_ROLES[member.role];
    if (!def) return false;
    const c = new Companion(this.scene, member, def, x, y);
    this.companions.push(c);
    this.healTimers.set(c, 0);
    return true;
  }

  toggleOrder(): void {
    if (!this.active || this.companions.every((c) => !c.alive)) return;
    this.order = this.order === 'hold' ? 'follow' : 'hold';
    GameEvents.of(this.scene).emit('ally:order', { order: this.order });
    const lead = this.companions.find((c) => c.alive);
    if (lead) Fx.of(this.scene)?.popText(lead.footX, lead.footY - 66, this.order === 'hold' ? '固守據點！' : '跟我來！', '#fff59d');
  }

  /** 給霧屍的可攻擊目標 */
  targets(): ZombieTarget[] {
    return this.companions
      .filter((c) => c.alive)
      .map((c) => ({ x: c.footX, y: c.footY, alive: true, hit: (d: number) => this.hit(c, d) }));
  }

  update(dt: number, player: CompanionPlayerLink, zombies: Zombie[], barricade: Barricade): CompanionShot {
    const total: CompanionShot = { kills: 0, headshots: 0 };
    this.companions.forEach((c, i) => {
      if (!c.alive) return;
      let { x, y } = this.order === 'follow' && player.alive ? this.followSpot(player, i) : this.holdSpot(c.def.role, i);
      let canShoot = true;
      c.status = c.reloading ? '換彈' : this.order === 'hold' ? '固守' : '跟隨';
      // 近戰型：固守時守在路障邊、對準正在拆路障的霧屍；跟隨時衝向附近的霧屍
      if (c.isMelee) {
        const spot = this.meleeSpot(c, player, zombies);
        x = spot.x;
        y = spot.y;
        if (spot.engaging) c.status = '肉搏';
      }
      // 莽撞：老是站到隊形前面
      if (c.stats.hooks.has('reckless')) x += TRAIT_TUNING.recklessStep;
      // 膽小：被貼身就往後退
      if (c.wantsToRetreat) {
        x = c.footX - 30;
        c.status = '後退';
      }

      // 工兵：路障受損就去修
      if (c.stats.repairPerSec && barricade.alive && barricade.hp < barricade.maxHp) {
        x = this.layout.barricadeX - 14;
        y = c.footY;
        const atSpot = Math.abs(c.footX - x) < 6;
        if (atSpot) {
          this.repairAcc += barricade.repair(c.stats.repairPerSec * dt);
          this.repairTick += dt;
          if (this.repairTick >= 0.5 && this.repairAcc > 0) {
            GameEvents.of(this.scene).emit('barricade:repair', { amount: this.repairAcc, hp: barricade.hp, maxHp: barricade.maxHp });
            this.repairAcc = 0;
            this.repairTick = 0;
          }
          canShoot = false;
          c.status = '修理中';
        } else {
          c.status = '去修路障';
        }
      }

      // 醫護：走到受傷最重的人身邊，計時補血
      if (c.stats.heal) {
        const h = c.stats.heal;
        const patient = this.findPatient(c, player, h.range * 2.5);
        if (patient && Math.hypot(patient.x - c.footX, patient.y - c.footY) > h.range * 0.7) {
          x = patient.x - 16;
          y = patient.y;
          // 固守時不離開路障內側
          if (this.order === 'hold') x = Math.min(x, this.layout.barricadeX - 14);
        }
        const t = (this.healTimers.get(c) ?? 0) - dt;
        this.healTimers.set(c, Math.max(0, t));
        const inRange = patient && Math.hypot(patient.x - c.footX, patient.y - c.footY) <= h.range;
        if (patient && inRange && t <= 0) {
          const healed = patient.heal(h.amount);
          if (healed > 0) {
            Fx.of(this.scene)?.popText(patient.x, patient.y - 58, `+${Math.round(healed)}`, '#a5d6a7');
            GameEvents.of(this.scene).emit('ally:heal', { amount: healed, x: patient.x, y: patient.y });
            this.healTimers.set(c, h.interval);
          }
        }
        if (patient) c.status = '治療';
      }

      const shot = c.update(dt, {
        moveX: x,
        moveY: y,
        minX: this.layout.minX,
        maxX: this.layout.maxX,
        canShoot,
        zombies,
        fireRateMult: this.inspireMult(c),
      });
      if (shot) {
        total.kills += shot.kills;
        total.headshots += shot.headshots;
      }
    });
    return total;
  }

  /** 鼓舞人心：附近有活著的鼓舞者（不是自己）就加射速；獨行俠不吃這套 */
  private inspireMult(c: Companion): number {
    if (c.member.traits?.includes('loner')) return 1;
    const r = TRAIT_TUNING.inspireRange;
    const near = this.companions.some(
      (o) => o !== c && o.alive && o.stats.hooks.has('inspiring') && Math.hypot(o.footX - c.footX, o.footY - c.footY) <= r,
    );
    return near ? TRAIT_TUNING.inspireFireRate : 1;
  }

  /** 撐過一晚時，活著的拾荒好手多帶回的廢料 */
  scavengeBonus(): { name: string; amount: number }[] {
    return this.companions
      .filter((c) => c.alive && c.stats.hooks.has('scavenger'))
      .map((c) => ({ name: c.member.name, amount: TRAIT_TUNING.scavengerScrap }));
  }

  hud(): CompanionHud[] {
    return this.companions.map((c) => ({
      name: c.member.name,
      title: c.def.title,
      traits: traitNames(c.member.traits ?? []),
      color: c.def.markColor,
      hp: c.hp,
      maxHp: c.stats.maxHp,
      alive: c.alive,
      status: c.alive ? c.status : '陣亡',
    }));
  }

  private hit(c: Companion, damage: number): void {
    if (c.takeDamage(damage)) {
      // 永久陣亡：從隊伍除名（下次存檔就不會再出現）
      GameState.removeCrew(c.member.id);
      Fx.of(this.scene)?.popText(c.footX, c.footY - 60, `${c.member.name} 陣亡`, '#ff8a80');
      this.scene.cameras.main.shake(80, 0.004);
      if (this.companions.every((o) => !o.alive)) this.order = 'hold';
    }
  }

  /** 近戰隊員要站的位置 */
  private meleeSpot(c: Companion, player: CompanionPlayerLink, zombies: Zombie[]): { x: number; y: number; engaging: boolean } {
    const reach = c.meleeReach;
    const bx = this.layout.barricadeX;
    const following = this.order === 'follow' && player.alive;
    // 找目標：固守時只管貼在路障前的，跟隨時管主角附近的
    let best: Zombie | null = null;
    let bestD = Infinity;
    for (const z of zombies) {
      if (z.dead) continue;
      const ok = following ? Math.abs(z.footX - player.footX) < 110 : z.footX < bx + 50;
      if (!ok) continue;
      const d = Math.hypot(z.footX - c.footX, (z.footY - c.footY) * 1.5);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (best) {
      // 站在目標靠據點這一側、剛好打得到的距離
      const side = following && best.footX < c.footX ? 1 : -1;
      let x = best.footX + side * Math.max(10, reach * 0.7);
      if (!following) x = Math.min(x, bx + Math.max(0, reach - 16));
      return { x, y: best.footY, engaging: true };
    }
    if (following) {
      const i = this.companions.indexOf(c);
      const o = FOLLOW_OFFSET[i % FOLLOW_OFFSET.length];
      // 近戰的人站在主角前面
      return { x: player.footX + Math.abs(o.x) * 0.8 * player.facing, y: player.footY + o.y, engaging: false };
    }
    return { x: bx - 4, y: c.footY, engaging: false };
  }

  /** 範圍內受傷最重（血量比例最低、且低於 9 成）的人 */
  private findPatient(medic: Companion, player: CompanionPlayerLink, range: number): Patient | null {
    const list: Patient[] = [];
    if (player.alive) list.push({ x: player.footX, y: player.footY, ratio: player.hp / player.maxHp, heal: player.heal });
    for (const c of this.companions) {
      if (c.alive) list.push({ x: c.footX, y: c.footY, ratio: c.hp / c.stats.maxHp, heal: (a) => c.heal(a) });
    }
    let best: Patient | null = null;
    for (const p of list) {
      if (p.ratio >= 0.9) continue;
      if (Math.hypot(p.x - medic.footX, p.y - medic.footY) > range) continue;
      if (!best || p.ratio < best.ratio) best = p;
    }
    return best;
  }

  private holdSpot(role: string, i: number): { x: number; y: number } {
    const bx = this.layout.barricadeX;
    // 射手靠路障、醫護退到牆邊、工兵站中間方便衝去修
    const x = role === 'shooter' ? bx - 18 : role === 'medic' ? this.layout.minX + 8 : bx - 32;
    return { x, y: HOLD_Y[i % HOLD_Y.length] };
  }

  private followSpot(p: CompanionPlayerLink, i: number): { x: number; y: number } {
    const o = FOLLOW_OFFSET[i % FOLLOW_OFFSET.length];
    // 永遠站在主角靠據點那一側（左邊），主角轉身時隊形不會跟著翻來翻去
    return { x: p.footX + o.x, y: p.footY + o.y };
  }
}
