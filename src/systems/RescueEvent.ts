import Phaser from 'phaser';
import { GAME_WIDTH, LANE_BOTTOM, LANE_TOP, WORLD_WIDTH, clampLaneY, depthForY } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { crewArmColors, ensureCrewTexture } from '../art/CrewArt';
import { stripArms } from '../art/WeaponArt';
import { COMPANION_ROLES, makeCrewMember, type CompanionRole, type CrewMember } from '../data/companions';
import { RESCUE, RESCUE_PACK, TURN_INTO } from '../data/rescue';
import type { Zombie, ZombieTarget } from '../entities/Zombie';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';
import { enemyIds, prewarmLooks, spawnEnemy } from './ZombieFactory';
import { pixelText } from '../utils/text';
import { randomSeed } from '../utils/rng';

/**
 * 夜晚防守的「拯救倖存者」隨機事件。數值在 src/data/rescue.ts。
 *
 * 倖存者從戰場東緣出現、往據點跑，後面追著一小群霧屍；霧屍會優先撲向倖存者。
 * 主角和夥伴要替倖存者清出一條路：
 * - 翻進路障 → GameState.recruit 加入隊伍，隊伍有空位就當晚直接參戰（host.onJoin）
 * - 血歸零 → 倒地抽搐，幾秒後屍變成霧屍（依出身變成對應職業）加入敵方（host.addZombie）
 */
export interface RescueHost {
  /** 擋路線 x（路障前緣；路障被拆就是外牆） */
  blockX: () => number;
  /** 翻過路障後站的位置 */
  safeX: () => number;
  zombies: () => Zombie[];
  addZombie: (z: Zombie) => void;
  /** 救成功：新隊員（已寫進 GameState.crew） */
  onJoin: (m: CrewMember, x: number, y: number) => void;
  /** 出怪還沒結束才觸發 */
  canStart: () => boolean;
}

type State = 'idle' | 'run' | 'climb' | 'down' | 'done';

function weightedRole(): CompanionRole {
  const entries = Object.entries(RESCUE.roles) as [CompanionRole, number][];
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'shooter';
}

export class RescueEvent {
  private state: State = 'idle';
  /** 還剩幾秒觸發；undefined = 今晚不會發生 */
  private timer?: number;
  private member?: CrewMember;
  private seed = 0;
  private hp = RESCUE.hp;
  private x = 0;
  private y = 0;
  private facing = -1;
  private walk = 0;
  private hurtFlash = 0;
  private dodgeDir = 0;
  private turnT = 0;
  private sprite?: Phaser.GameObjects.Sprite;
  private arms?: Phaser.GameObjects.Graphics;
  private nameTag?: Phaser.GameObjects.Text;
  private hpBack?: Phaser.GameObjects.Rectangle;
  private hpBar?: Phaser.GameObjects.Rectangle;
  private arrow?: Phaser.GameObjects.Container;
  private armColor = { sleeve: 0x5a6a7a, skin: 0xd8a888 };
  private target: ZombieTarget = {
    x: 0,
    y: 0,
    alive: false,
    lure: RESCUE.lure,
    hit: (d: number, fromX: number) => this.hit(d, fromX),
  };

  constructor(private scene: Phaser.Scene, private host: RescueHost) {
    const st = GameState.data;
    if (st.day >= RESCUE.minDay && st.crew.length < RESCUE.maxCrew && Math.random() < RESCUE.chance) {
      this.timer = Phaser.Math.FloatBetween(...RESCUE.delay);
    }
  }

  /** 測試用：馬上觸發 */
  forceSoon(sec = 1): void {
    if (this.state === 'idle') this.timer = sec;
  }

  /** 事件進行中（勝負判定要等它結束） */
  get busy(): boolean {
    return this.state === 'run' || this.state === 'climb' || this.state === 'down';
  }

  /** 給霧屍的目標 */
  targets(): ZombieTarget[] {
    return this.state === 'run' ? [this.target] : [];
  }

  update(dt: number): void {
    if (this.state === 'idle') {
      if (this.timer === undefined) return;
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = undefined;
        if (this.host.canStart()) this.start();
      }
      return;
    }
    if (this.state === 'run') this.updateRun(dt);
    else if (this.state === 'down') this.updateDown(dt);
    this.sync(dt);
  }

  private start(): void {
    const role = weightedRole();
    this.seed = randomSeed();
    const st = GameState.data;
    // 先用同一顆種子預覽長相，救成功時用同一顆種子正式招募（長相、名字一致）
    this.member = makeCrewMember('rescue-preview', role, this.seed, st.crew.map((c) => c.name));
    const turnId = this.turnId();
    const pack = this.packIds();
    prewarmLooks(this.scene, [turnId, ...pack]);

    this.x = WORLD_WIDTH - 24;
    this.y = Phaser.Math.Between(LANE_TOP + 20, LANE_BOTTOM - 20);
    this.hp = RESCUE.hp;
    this.state = 'run';
    this.buildVisual();

    // 追兵：在倖存者身後散開
    pack.forEach((id, i) => {
      const z = spawnEnemy(this.scene, id, this.x + 26 + i * 16 + Phaser.Math.Between(0, 14), clampLaneY(this.y + Phaser.Math.Between(-30, 30)), {
        day: st.day,
      });
      this.host.addZombie(z);
    });

    this.banner(`求救！倖存者 ${this.member.name} 從東邊逃過來`, '掩護倖存者翻進路障，被咬死就會屍變', '#9fe6a0');
    AudioManager.play('ui_confirm', { semitones: -5, volume: 0.7 });
  }

  private packIds(): string[] {
    const day = GameState.data.day;
    const open = new Set(enemyIds(day));
    const n = Math.min(RESCUE.packMax, RESCUE.packBase + Math.floor(day / 2));
    return Array.from({ length: n }, (_, i) => {
      const id = RESCUE_PACK[i % RESCUE_PACK.length];
      return open.has(id) ? id : 'basic';
    });
  }

  private turnId(): string {
    const id = TURN_INTO[this.member?.background ?? ''] ?? 'basic';
    return enemyIds(Infinity).includes(id) ? id : 'basic';
  }

  private buildVisual(): void {
    const m = this.member!;
    const key = ensureCrewTexture(this.scene, m);
    const body = key ? stripArms(this.scene, key) : null;
    const colors = crewArmColors(m);
    if (colors) this.armColor = { sleeve: colors.sleeve, skin: colors.skin };
    this.sprite = this.scene.add.sprite(this.x, this.y, body ?? key ?? 'player', 0).setOrigin(0.5, 63 / 64);
    if (!key) this.sprite.setTint(COMPANION_ROLES[m.role].tint);
    const build = m.look?.build ?? { w: 1, h: 1 };
    this.sprite.setScale(0.94 * build.w, 0.94 * build.h);
    Fx.of(this.scene)?.attachShadow(this.sprite, 20);
    this.arms = this.scene.add.graphics();
    this.nameTag = pixelText(this.scene, this.x, this.y - 70, '救命！', 8, '#9fe6a0').setOrigin(0.5, 1).setStroke('#000000', 3);
    this.hpBack = this.scene.add.rectangle(this.x, 0, 18, 3, 0x000000, 0.7);
    this.hpBar = this.scene.add.rectangle(this.x, 0, 16, 1, 0x9fe6a0).setOrigin(0, 0.5);
    // 倖存者在鏡頭外時，畫面邊緣的提示
    const bg = this.scene.add.rectangle(0, 0, 58, 14, 0x000000, 0.6).setStrokeStyle(1, 0x9fe6a0, 0.8);
    const label = pixelText(this.scene, 0, 0, '倖存者 ▶', 8, '#9fe6a0').setOrigin(0.5);
    this.arrow = this.scene.add.container(0, 0, [bg, label]).setScrollFactor(0).setDepth(190);
  }

  private updateRun(dt: number): void {
    const blockX = this.host.blockX();
    // 前面有霧屍擋路：放慢、往上或往下閃
    let blocker: Zombie | null = null;
    for (const z of this.host.zombies()) {
      if (z.dead || z.spec.body === 'crow') continue;
      const ahead = this.x - z.footX;
      if (ahead > 0 && ahead < 26 && Math.abs(z.footY - this.y) < 12) {
        blocker = z;
        break;
      }
    }
    let speed = RESCUE.speed;
    if (blocker) {
      speed *= RESCUE.blockedMul;
      if (this.dodgeDir === 0) this.dodgeDir = blocker.footY > this.y || this.y > LANE_BOTTOM - 14 ? -1 : 1;
      if (this.y <= LANE_TOP + 2) this.dodgeDir = 1;
      if (this.y >= LANE_BOTTOM - 2) this.dodgeDir = -1;
      this.y = clampLaneY(this.y + this.dodgeDir * RESCUE.speed * 0.8 * dt);
    } else this.dodgeDir = 0;
    this.x -= speed * dt;
    this.facing = -1;
    this.walk += dt * 16;
    if (this.x <= blockX + RESCUE.safeMargin) this.climb();
  }

  private climb(): void {
    this.state = 'climb';
    const toX = this.host.safeX();
    const sp = this.sprite!;
    // 翻過路障：往上跳、往左落地
    this.scene.tweens.add({ targets: this, x: toX, duration: 520, ease: 'Sine.easeInOut' });
    this.scene.tweens.add({
      targets: sp,
      angle: { from: 0, to: -10 },
      duration: 260,
      yoyo: true,
      onComplete: () => this.join(),
    });
  }

  private join(): void {
    if (this.state !== 'climb') return;
    const old = this.member!;
    // 用同一顆種子正式招募：長相、名字和剛剛跑過來的人一樣
    const m = GameState.recruit(old.role, old.name, this.seed);
    this.state = 'done';
    this.cleanup();
    Fx.of(this.scene)?.popText(this.x, this.y - 66, `${m.name}（${COMPANION_ROLES[m.role].title}）加入隊伍！`, '#9fe6a0');
    AudioManager.play('ui_confirm', { semitones: 5, volume: 0.9 });
    this.host.onJoin(m, this.x, this.y);
  }

  private hit(damage: number, fromX: number): void {
    if (this.state !== 'run') return;
    this.hp -= damage;
    this.hurtFlash = 0.15;
    Fx.of(this.scene)?.blood(this.x, this.y - 30, Math.sign(this.x - fromX) || 1, this.y, 4);
    if (this.hp <= 0) this.goDown();
  }

  private goDown(): void {
    this.hp = 0;
    this.state = 'down';
    this.turnT = RESCUE.turnDelay;
    this.target.alive = false;
    const sp = this.sprite!;
    this.arms?.clear();
    this.scene.tweens.add({ targets: sp, angle: 80, duration: 260, ease: 'Quad.easeIn' });
    this.nameTag?.setText(`${this.member!.name} 被咬了…`).setColor('#ff8a80');
    AudioManager.play('player_hurt', { semitones: 2, volume: 0.6 });
  }

  private updateDown(dt: number): void {
    this.turnT -= dt;
    // 抽搐、慢慢變成灰綠色
    const k = 1 - Math.max(0, this.turnT) / RESCUE.turnDelay;
    const sp = this.sprite!;
    sp.x = this.x + (Math.random() - 0.5) * 2 * k;
    const g = Math.round(255 - 90 * k);
    sp.setTint(Phaser.Display.Color.GetColor(g - 30, g, g - 40));
    if (this.turnT > 0) return;
    const id = this.turnId();
    const z = spawnEnemy(this.scene, id, this.x, this.y, { day: GameState.data.day });
    this.host.addZombie(z);
    Fx.of(this.scene)?.popText(this.x, this.y - 66, `${this.member!.name} 屍變了…`, '#ff8a80');
    this.banner('救援失敗', `${this.member!.name} 變成了${z.spec.profession.name}`, '#ff8a80');
    this.state = 'done';
    this.cleanup();
  }

  private sync(dt: number): void {
    const sp = this.sprite;
    if (!sp || !sp.active) return;
    this.target.x = this.x;
    this.target.y = this.y;
    this.target.alive = this.state === 'run';
    const bob = this.state === 'run' ? Math.abs(Math.sin(this.walk)) * 2 : 0;
    if (this.state !== 'down') sp.x = this.x;
    sp.y = this.y - bob;
    sp.setFlipX(this.facing < 0);
    const depth = depthForY(this.y);
    sp.setDepth(depth);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.state !== 'down') {
      if (this.hurtFlash > 0) sp.setTintFill(0xffffff);
      else if (sp.tintFill) sp.clearTint();
    }
    // 舉著雙手揮（喊救命），跑步時前後甩
    const a = this.arms!;
    a.clear();
    if (this.state === 'run' || this.state === 'climb') {
      a.setDepth(depth + 0.05);
      const sx = this.x + 2 * this.facing;
      const sy = this.y - 36 - bob;
      const swing = Math.sin(this.walk * 0.9);
      const arm = (ang: number) => {
        const ex = sx + Math.cos(ang) * 6;
        const ey = sy + Math.sin(ang) * 6;
        const hx = ex + Math.cos(ang - 0.3 * this.facing) * 5;
        const hy = ey + Math.sin(ang - 0.3 * this.facing) * 5;
        a.lineStyle(2, this.armColor.sleeve, 1).lineBetween(sx, sy, ex, ey);
        a.lineStyle(2, this.armColor.skin, 1).lineBetween(ex, ey, hx, hy);
      };
      const up = -Math.PI / 2;
      arm(up + this.facing * (0.5 + swing * 0.5));
      arm(up - this.facing * (0.2 - swing * 0.5));
    }
    const top = this.y - 58 - bob;
    this.nameTag?.setPosition(this.x, top - 4).setDepth(depth + 0.1);
    this.hpBack?.setPosition(this.x, top).setDepth(depth + 0.1);
    if (this.hpBar) {
      this.hpBar.setPosition(this.x - 8, top).setDepth(depth + 0.11);
      const r = Math.max(0, this.hp / RESCUE.hp);
      this.hpBar.width = 16 * r;
      this.hpBar.setFillStyle(r > 0.5 ? 0x9fe6a0 : r > 0.25 ? 0xffd54f : 0xe57373);
    }
    // 鏡頭外：在畫面右（或左）緣顯示提示和距離
    if (this.arrow) {
      const cam = this.scene.cameras.main;
      const off = this.x > cam.scrollX + GAME_WIDTH ? 1 : this.x < cam.scrollX ? -1 : 0;
      this.arrow.setVisible(off !== 0 && this.state === 'run');
      if (off !== 0) {
        const lbl = this.arrow.list[1] as Phaser.GameObjects.Text;
        lbl.setText(off > 0 ? '倖存者 ▶' : '◀ 倖存者');
        this.arrow.setPosition(off > 0 ? GAME_WIDTH - 36 : 36, Phaser.Math.Clamp(this.y - 30, 110, 300));
      }
    }
  }

  private banner(title: string, sub: string, color: string): void {
    const t1 = pixelText(this.scene, GAME_WIDTH / 2, 96, title, 10, color).setOrigin(0.5);
    const t2 = pixelText(this.scene, GAME_WIDTH / 2, 112, sub, 8, '#e0e0e0').setOrigin(0.5);
    for (const t of [t1, t2]) {
      t.setScrollFactor(0).setDepth(200).setStroke('#000000', 3).setAlpha(0);
      this.scene.tweens.add({ targets: t, alpha: 1, duration: 200, hold: 3000, yoyo: true, onComplete: () => t.destroy() });
    }
  }

  private cleanup(): void {
    for (const o of [this.sprite, this.arms, this.nameTag, this.hpBack, this.hpBar, this.arrow]) {
      if (!o) continue;
      this.scene.tweens.killTweensOf(o);
      o.destroy();
    }
    this.sprite = undefined;
    this.arrow = undefined;
  }
}
