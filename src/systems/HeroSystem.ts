import Phaser from 'phaser';
import { DODGE, GRAB, LUCK, SPRINT, TAKEDOWN, type HeroDef } from '../data/heroes';
import type { Player } from '../entities/Player';
import type { Zombie } from '../entities/Zombie';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';
import { pixelText } from '../utils/text';
import { GameEvents } from './GameEvents';
import type { MeleeSystem } from './MeleeSystem';

/** 觸控按鈕：奔跑切換、主動技能（UIScene 設定，HeroSystem 讀） */
export const heroTouch = { sprint: false, skill: false };

export interface HeroHud {
  heroId: string;
  sprinting: boolean;
  grabbed: number;
  /** 主動技能名稱與按鍵（沒有就 undefined） */
  skill?: string;
  skillReady: boolean;
  /** 大難不死還在不在 */
  lastStand?: boolean;
}

/**
 * 主角技能與「被霧屍抓住」的狀態。夜晚防守、探索戰鬥共用。
 *
 * - 糾纏：霧屍打到主角就抓住不放，牠死掉、被打退（離開 breakDist）或被打出硬直才鬆手。
 *   抓住期間移動大幅變慢、不能奔跑。
 * - 阿凱：Shift 奔跑（耗體力、近戰加成）；閃身步自動閃過一次攻擊與抓取。
 * - 馬克：C 戰術擊倒，秒殺正前方一隻（菁英改成重創＋長硬直）。
 * - 好運姐：幸運一擊（WeaponSystem 的 critChance）、大難不死、抓你的霧屍會滑倒。
 *
 * 用法：把 hitPlayer 交給 ZombieContext，每幀先呼叫 update() 拿移動倍率。
 */
export class HeroSystem {
  readonly hero: HeroDef;
  private grabbers = new Set<Zombie>();
  private sprinting = false;
  private dodgeCd = 0;
  private skillCd = 0;
  private slipTimer = 0;
  private lastStandUsed = false;
  private label: Phaser.GameObjects.Text;
  private keys?: { shift: Phaser.Input.Keyboard.Key; skill: Phaser.Input.Keyboard.Key };
  /** 戰術擊倒殺掉霧屍時通知場景（計擊殺數） */
  onKill?: (z: Zombie) => void;

  constructor(
    private scene: Phaser.Scene,
    private player: Player,
    private melee: MeleeSystem,
    private zombies: () => Zombie[],
  ) {
    this.hero = GameState.hero;
    heroTouch.sprint = false;
    heroTouch.skill = false;
    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = {
        shift: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
        skill: kb.addKey(Phaser.Input.Keyboard.KeyCodes.C),
      };
    }
    this.label = pixelText(scene, 0, 0, '', 8, '#ff6b6b').setOrigin(0.5, 1).setVisible(false);
  }

  get grabbed(): number {
    return this.grabbers.size;
  }

  hud(): HeroHud {
    const skill = this.hero.skills.find((s) => s.key && s.key !== 'Shift');
    return {
      heroId: this.hero.id,
      sprinting: this.sprinting,
      grabbed: this.grabbers.size,
      skill: skill ? skill.name : undefined,
      skillReady: this.skillCd <= 0 && this.melee.stamina >= TAKEDOWN.cost,
      lastStand: this.hero.id === 'lucky' ? !this.lastStandUsed : undefined,
    };
  }

  /**
   * 霧屍打到主角（交給 ZombieContext.hitPlayer）。
   * 依主角決定：閃開、硬吃、大難不死；吃到了就被抓住。
   */
  hitPlayer(damage: number, fromX: number, fromY: number, src?: Zombie): void {
    const p = this.player;
    if (!p.alive || p.invulnerable) return;
    const fx = Fx.of(this.scene);

    // 阿凱：閃身步
    if (this.hero.id === 'student' && this.dodgeCd <= 0 && this.melee.spend(DODGE.cost)) {
      this.dodgeCd = DODGE.cooldown;
      const away = Math.sign(p.footX - fromX) || -p.facing;
      p.push(away * DODGE.dash, (p.footY >= fromY ? 1 : -1) * DODGE.dash * 0.25);
      p.grantIframes(DODGE.iframes);
      fx?.popText(p.footX, p.footY - 62, '閃身！', '#80d8ff');
      this.flash(0x80d8ff);
      GameEvents.of(this.scene).emit('player:dodge', { x: p.footX, y: p.footY });
      return;
    }

    // 好運姐：大難不死（每晚／每場一次）
    if (this.hero.id === 'lucky' && !this.lastStandUsed && damage >= p.hp) {
      this.lastStandUsed = true;
      damage = Math.max(0, p.hp - 1);
      if (damage > 0) p.takeDamage(damage, fromX, fromY);
      p.grantIframes(LUCK.lastStandIframes);
      this.shockwave();
      fx?.popText(p.footX, p.footY - 70, '大難不死！', '#ffd54f');
      return;
    }

    const hurt = p.takeDamage(damage, fromX, fromY);
    if (hurt && src && p.alive && !src.dead && !GRAB.noGrab.includes(src.spec.body) && !this.grabbers.has(src)) {
      this.grabbers.add(src);
      this.sprinting = false;
      // 被抓住就不會被打退：牠拉著你
      p.clearPush();
      fx?.popText(p.footX, p.footY - 62, this.grabbers.size > 1 ? '被纏住了！' : '被抓住！', '#ff6b6b');
      GameEvents.of(this.scene).emit('player:grabbed', { count: this.grabbers.size });
    }
  }

  /**
   * 每幀呼叫（在 player.update 之前）。回傳主角的移動倍率（奔跑、糾纏）。
   * moving：這一幀有沒有在按移動。
   */
  update(dt: number, moving: boolean): number {
    const p = this.player;
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.skillCd = Math.max(0, this.skillCd - dt);
    this.updateGrab(dt);

    // 奔跑（阿凱）
    const wantSprint = this.hero.id === 'student' && moving && p.alive && (this.keys?.shift.isDown || heroTouch.sprint);
    if (wantSprint && this.grabbers.size === 0 && (this.sprinting ? this.melee.stamina > 0 : this.melee.stamina >= SPRINT.minStart)) {
      this.sprinting = true;
      this.melee.spend(SPRINT.drain * dt, true);
    } else {
      this.sprinting = false;
    }
    this.melee.bonus = this.sprinting
      ? { damageMul: SPRINT.meleeDamageMul, knockback: SPRINT.meleeKnockback, stagger: SPRINT.meleeStagger }
      : { damageMul: 1, knockback: 0, stagger: 0 };
    if (this.sprinting && Math.random() < dt * 10) Fx.of(this.scene)?.footDust(p.footX, p.footY, -p.facing);

    // 主動技能（馬克）
    const skillPressed = (this.keys && Phaser.Input.Keyboard.JustDown(this.keys.skill)) || heroTouch.skill;
    heroTouch.skill = false;
    if (skillPressed && this.hero.id === 'soldier') this.takedown();

    // 糾纏的提示字跟著主角
    this.label.setVisible(this.grabbers.size > 0 && p.alive);
    if (this.label.visible) {
      this.label.setPosition(p.footX, p.footY - 58).setDepth(p.sprite.depth + 1);
      this.label.setText(this.grabbers.size > 1 ? `被 ${this.grabbers.size} 隻纏住` : '被抓住');
      this.label.setAlpha(0.6 + 0.4 * Math.abs(Math.sin(this.scene.time.now / 160)));
    }

    if (this.grabbers.size > 0) return this.grabbers.size > 1 ? GRAB.slowMulti : GRAB.slow;
    return this.sprinting ? SPRINT.speedMul : 1;
  }

  /** 抓人的霧屍：死了、被打遠、被打出硬直就鬆手；好運姐的霧屍會滑倒 */
  private updateGrab(dt: number): void {
    const p = this.player;
    if (!p.alive) {
      this.grabbers.clear();
      return;
    }
    let released = 0;
    for (const z of this.grabbers) {
      const far = Math.abs(z.footX - p.footX) > GRAB.breakDist || Math.abs(z.footY - p.footY) > GRAB.breakDist * 0.6;
      if (z.dead || far || z.stunTimer >= GRAB.breakStagger) {
        this.grabbers.delete(z);
        if (!z.dead) released++;
      }
    }
    if (released > 0 && this.grabbers.size === 0) Fx.of(this.scene)?.popText(p.footX, p.footY - 62, '掙脫！', '#9ad17a');

    if (this.hero.id === 'lucky' && this.grabbers.size > 0) {
      this.slipTimer += dt;
      if (this.slipTimer >= 1) {
        this.slipTimer -= 1;
        if (Math.random() < LUCK.slipChancePerSec) {
          const z = [...this.grabbers][0];
          z.stagger(1);
          z.footX += 10 * (Math.sign(z.footX - p.footX) || 1);
          this.grabbers.delete(z);
          Fx.of(this.scene)?.popText(z.footX, z.footY - 50, '滑倒了！', '#ffd54f');
        }
      }
    } else {
      this.slipTimer = 0;
    }
  }

  /** 馬克：戰術擊倒身邊最近的一隻（優先抓住你的那隻、再來是面向的那邊） */
  private takedown(): void {
    const p = this.player;
    const fx = Fx.of(this.scene);
    if (!p.alive || this.skillCd > 0 || this.melee.busy) return;
    let target: Zombie | null = null;
    let best = Infinity;
    for (const z of this.zombies()) {
      if (z.dead) continue;
      // 前後都可以（被抓住時常常是背後那隻），面向的那邊優先
      const fwd = (z.footX - p.footX) * p.facing;
      const side = Math.abs(z.footY - p.footY);
      const grabbing = this.grabbers.has(z);
      if (!grabbing && (Math.abs(fwd) > TAKEDOWN.reach + 8 * (z.def.scale ?? 1) || side > 14)) continue;
      const d = (grabbing ? -100 : 0) + Math.abs(fwd) + side + (fwd < 0 ? 12 : 0);
      if (d < best) {
        best = d;
        target = z;
      }
    }
    if (!target) {
      fx?.popText(p.footX, p.footY - 62, '太遠了', '#b0bec5');
      return;
    }
    if (!this.melee.spend(TAKEDOWN.cost)) {
      fx?.popText(p.footX, p.footY - 62, '體力不足', '#ff8a80');
      return;
    }
    this.skillCd = TAKEDOWN.cooldown;
    const dir = Math.sign(target.footX - p.footX) || p.facing;
    p.facing = dir;
    p.push(dir * 120);
    const elite = target.spec.profession.threat >= TAKEDOWN.eliteThreat || target.spec.body === 'bear';
    const hx = target.footX;
    const hy = target.footY - 30 * (target.def.scale ?? 1);
    fx?.blood(hx, hy, dir, target.footY, 9, 1.2);
    fx?.freeze(elite ? 70 : 90);
    let killed: boolean;
    if (elite) {
      target.stagger(TAKEDOWN.eliteStagger);
      killed = target.takeDamage(TAKEDOWN.eliteDamage, 14, { dirX: dir, type: 'slash', penetration: 1 });
      fx?.popText(hx, hy - 20, killed ? '擊倒！' : '重創！', '#ffb74d');
    } else {
      killed = target.takeDamage(99999, 10, { dirX: dir, type: 'slash', penetration: 1 });
      fx?.popText(hx, hy - 20, '擊倒！', '#ffb74d');
    }
    this.grabbers.delete(target);
    GameEvents.of(this.scene).emit('enemy:hit', { enemyId: target.def.id, x: hx, y: hy, damage: 999, headshot: false, killed });
    GameEvents.of(this.scene).emit('player:melee-hit', { weaponId: 'knife', x: hx, y: hy, type: 'slash', killed, execute: true });
    if (killed) this.onKill?.(target);
  }

  /** 大難不死：把周圍的霧屍震開 */
  private shockwave(): void {
    const p = this.player;
    for (const z of this.zombies()) {
      if (z.dead) continue;
      const d = Math.hypot(z.footX - p.footX, (z.footY - p.footY) * 1.6);
      if (d > LUCK.lastStandRadius) continue;
      z.stagger(1.2);
      z.takeDamage(1, LUCK.lastStandKnockback, { dirX: Math.sign(z.footX - p.footX) || 1, type: 'blast' });
    }
    this.grabbers.clear();
    this.flash(0xffd54f);
    Fx.of(this.scene)?.freeze(120);
  }

  private flash(color: number): void {
    const s = this.player.sprite;
    s.setTint(color);
    this.scene.time.delayedCall(140, () => s.active && s.clearTint());
  }

  destroy(): void {
    this.label.destroy();
    this.grabbers.clear();
  }
}
