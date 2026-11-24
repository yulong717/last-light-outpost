import Phaser from 'phaser';
import { clampLaneY, depthForY } from '../config';
import type { EnemyDef } from '../data/enemies';
import { BURST, CHARGE, CROW, ENRAGE, GORE, HEAL_AURA, POUNCE, SPRINT, type ArmorPiece } from '../data/zombies';
import { ANIMAL_FRAMES } from '../art/AnimalArt';
import { Fx } from '../fx/Fx';
import { GEAR_TEXTURE, HAT_ART, REACT_FRAMES, zombieBaseOf, type ZombieBaseSpec } from '../art/ZombieComposer';
import { armlessTexture, canDismember, crawlInfoOf, crawlTexture, goreParts, warmGore } from '../art/ZombieGore';
import { GameEvents } from '../systems/GameEvents';
import { armorAfter, type DamageInfo } from '../combat/Damage';
import type { ZombieSpec } from '../systems/ZombieFactory';

/** 受擊資訊：給程式化動畫決定怎麼反應 */
export interface HitInfo {
  headshot?: boolean;
  /** 子彈飛行方向的 x 分量（-1..1），決定血往哪噴、往哪倒、往哪退 */
  dirX?: number;
  /**
   * 傷害類型（和武器的 DamageType 對齊）：'blast' 爆炸不分頭身、護甲效果減半；
   * 'blunt' 鈍擊對頭盔也有效（敲飛頭盔用）。不填當作子彈。
   */
  type?: string;
  /** 穿甲 0..1：護甲減傷先扣掉這個值，max(0, armor − penetration) */
  penetration?: number;
  /** 打中的高度（世界 y），決定斷手還是斷腳 */
  hitY?: number;
  /** 重擊：斷肢機率提高、擊殺時可能炸頭 */
  heavy?: boolean;
  /** 斷肢機率倍率 */
  gore?: number;
}

/** 霧屍每幀需要知道的戰場資訊 */
export interface ZombieContext {
  /** 擋路的那條線（路障或據點外牆）的 x；霧屍不能越過 */
  blockX: number;
  /** 撞到擋路線時的攻擊；y 是攻擊者的腳底 y，讓特效出現在對的那一段 */
  hitBlock: (damage: number, y: number) => void;
  player: { x: number; y: number; alive: boolean };
  /** 打到主角；fromX/fromY 是霧屍腳底，用來決定擊退方向；src 是出手的霧屍（糾纏用） */
  hitPlayer: (damage: number, fromX: number, fromY: number, src?: Zombie) => void;
  /**
   * 據點建築的阻擋（沙包牆等）：依霧屍位置回傳比 blockX 更前面的擋路線，沒有就回傳 null。
   */
  blockerFor?: (x: number, y: number) => { blockX: number; hit: (damage: number, y: number) => void } | null;
  /** 地面效果的速度倍率（陷阱、照明燈），1 代表不影響 */
  speedMul?: (x: number, y: number) => number;
  /** 其他可被盯上的目標（NPC 夥伴）；和主角一樣，只有站在擋路線外側才會被追 */
  others?: ZombieTarget[];
  /** 場上所有霧屍（護理師的治療光環用） */
  zombies?: Zombie[];
  /** 多近會盯上主角／夥伴（不填用預設值）；探索戰鬥設很大，霧屍會一路追過來 */
  aggroRange?: number;
}

export interface ZombieTarget {
  x: number;
  y: number;
  alive: boolean;
  /** fromX/fromY 是霧屍腳底；src 是出手的霧屍 */
  hit: (damage: number, fromX: number, fromY: number, src?: Zombie) => void;
  /** 誘餌（響警報的車）：距離乘上這個值，越小越吸引霧屍；預設 1 */
  lure?: number;
}

/** 主角離多近會被盯上（以地面距離計，y 方向加權） */
const AGGRO_RANGE = 200;
/**
 * 攻擊慾望：盯上活人時加速逼近，貼近時再撲一段；
 * 主角躲在路障後面時，走向路障的霧屍會往主角所在的那一排靠（看得到人就往人那邊擠）。
 */
const CHASE = { speedMul: 1.3, closeMul: 1.55, closeDist: 56, laneSense: 280 };
/**
 * 近身攻擊的前搖：身體往後仰、低吼，前搖結束才判定（這時人已經退開就揮空）。
 * 前搖長度 = 攻擊間隔 × ratio，夾在 min～max；第一次貼上來後 first 秒就開始前搖。
 * 前搖中被打出硬直就取消。
 */
const ATTACK = { ratio: 0.3, min: 0.2, max: 0.45, first: 0.12, lean: 14, pull: 4, lift: 2 };
/** 近戰攻擊的觸及範圍 */
const REACH_X = 20;
const REACH_Y = 9;

/** 擊退滑行的衰減率（每秒）：越大停得越快 */
const KNOCK_SLIDE_DECAY = 14;
/** 擊飛：重力、落地彈跳保留的速度、倒地多久才爬起來 */
const LAUNCH = { gravity: 900, bounce: 0.35, airDecay: 2.5, down: 0.8 };
/** 受擊動作、爬起動作的秒數（有 H3 影格時） */
const REACT = { hit: 0.24, getup: 0.5 };
/** 被打飛的霧屍撞到別隻：一次最多撞倒幾隻 */
const BOWL_MAX = 3;

export class Zombie extends Phaser.GameObjects.Sprite {
  readonly def: EnemyDef;
  /** 這隻的職業、外觀、裝備、變異（見 ZombieFactory） */
  readonly spec: ZombieSpec;
  hp: number;
  readonly maxHp: number;
  /** 腳底位置，所有判定都用它（sprite 的 y 會因走路顛簸而偏移） */
  footX: number;
  footY: number;
  private attackTimer = 0;
  private speedJitter: number;
  /** 走路動態用的相位，讓每隻步伐不同步 */
  private walkPhase = Math.random() * Math.PI * 2;
  /** 朝路障前進時想站的 y，讓屍群沿著柵欄散開而不是擠成一點 */
  /** 繞過掩體時 PropSystem 會改這個值，讓牠沿著邊緣走過去而不是一直頂著 */
  laneY: number;
  private walkKey: string;
  private attackKey: string;
  /** 合成的原貼圖（斷肢版本都從它切） */
  private readonly baseKey: string;
  /** 人形霧屍用的底圖規格（影格大小、腳底、脖子、頭頂錨點、判定框） */
  private readonly base: ZombieBaseSpec;
  /** 斷手：攻擊力變弱；斷腳：趴在地上爬 */
  armLost = false;
  legLost = false;
  /** 被打中時往後仰的角度，逐漸回正 */
  private hitLean = 0;
  /** 被鈍器打飛的滑行速度（像素／秒） */
  private knockVX = 0;
  /** 攻擊時往前撲的位移 */
  private lunge = 0;
  /** 攻擊前搖剩幾秒（> 0 代表正在蓄力，這段不移動） */
  private atkWind = 0;
  /** 前搖往後仰的程度 0..1 與方向 */
  private atkPose = 0;
  private atkDir = 1;
  /** 卡肉抖動：到這個時間（真實時間 ms）前原地左右抖，幅度 px */
  private shakeUntil = 0;
  private shakeAmp = 0;
  /** 擊飛：離地高度、垂直速度、還能彈幾次、這次撞倒了誰 */
  private lift = 0;
  private liftVy = 0;
  private airborne = false;
  private bounces = 0;
  private bowled = new Set<Zombie>();
  /** 受擊動作剩餘秒數；倒地中（落地後到爬起來）；目前蓋掉動畫的影格（-1 沒有） */
  private hitT = 0;
  private downed = false;
  private bouncing = false;
  private reactFrame = -1;
  dead = false;
  /**
   * 從哪一側進攻：1 = 從右邊往左走（預設），-1 = 從左邊往右走（雙面據點的左側）。
   * 擋路線、追人、衝刺都依這個方向鏡像；生成時由場景設定，配合同一側的 ZombieContext。
   */
  side: 1 | -1 = 1;
  /** 下次低吼前的秒數（給音效用） */
  private groanIn = 1 + Math.random() * 6;

  // ── 裝備與能力 ──
  /** 頭盔（擋爆頭，耐久歸零就被打飛） */
  helmet: ArmorPiece | null;
  /** 防彈背心（擋身體，耐久歸零就失效） */
  vest: ArmorPiece | null;
  /** 硬直剩餘秒數：期間不能移動、不能攻擊（近戰武器用 stagger() 施加） */
  stunTimer = 0;
  private hat: Phaser.GameObjects.Image | null = null;
  private mark: Phaser.GameObjects.Image | null = null;
  private enraged = false;
  private sinceHit = 99;
  private healTimer = Math.random() * HEAL_AURA.interval;

  // ── 動物 ──
  /** 屍鴉飛行高度（像素，腳底往上） */
  alt = 0;
  private crowState: 'approach' | 'dive' | 'retreat' = 'approach';
  private crowTimer = 0;
  private crowShadow: Phaser.GameObjects.Ellipse | null = null;
  /** 屍犬撲咬：冷卻、剩餘時間、速度、這次撲咬打中沒 */
  private pounceCd = Math.random() * POUNCE.cooldown;
  private pounceT = 0;
  private pounceVx = 0;
  private pounceVy = 0;
  private pounceHit = false;
  /** 屍熊衝撞過了沒（每隻只撞第一下） */
  private charged = false;

  // ── 狂奔屍 ──
  /** stalk 走近 → windup 嘶吼蓄力 → dash 直線衝刺 → recover 喘氣 */
  private dashState: 'stalk' | 'windup' | 'dash' | 'recover' = 'stalk';
  private dashT = 0;
  private dashCd = 0.5 + Math.random();
  private dashDir = -1;
  private dashVx = 0;
  private dashVy = 0;
  /** 這次衝刺鎖定的目標（null = 衝路障） */
  private dashTarget: ZombieTarget | null = null;
  private alertIcon: Phaser.GameObjects.Text | null = null;
  /** 蓄力時地上的衝刺路線（紅色虛線，越接近起跑越亮） */
  private dashLine: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, spec: ZombieSpec) {
    super(scene, x, y, spec.def.texture);
    this.spec = spec;
    this.def = spec.def;
    this.hp = spec.def.hp;
    this.maxHp = spec.def.hp;
    this.helmet = spec.helmet ? { ...spec.helmet } : null;
    this.vest = spec.vest ? { ...spec.vest } : null;
    const def = spec.def;
    this.footX = x;
    this.footY = clampLaneY(y);
    this.laneY = this.footY;
    this.baseKey = def.texture;
    this.base = zombieBaseOf(def.texture);
    // 斷肢／爆頭碎塊的貼圖趁空檔先切好，第一次打斷手、爆頭時才不會卡住（手機上很明顯）
    if (spec.body === 'human') warmGore(scene, this.baseKey, true);
    this.walkKey = `${def.texture}_walk`;
    this.attackKey = `${def.texture}_attack`;
    // 人形的腳底列、影格大小跟著底圖（一般霧屍 64 格第 62 列、巨屍 72 格第 69 列）；動物各自的腳底列見 ANIMAL_FRAMES
    if (spec.body !== 'human') {
      const info = ANIMAL_FRAMES[spec.body];
      this.setOrigin(0.5, spec.body === 'crow' ? 0.5 : info.footRow / info.h);
    } else this.setOrigin(0.5, scene.anims.exists(this.walkKey) ? this.base.foot / this.base.size : 1);
    if (spec.body === 'crow') {
      this.alt = CROW.cruiseAlt + Phaser.Math.Between(-10, 14);
      this.crowShadow = scene.add.ellipse(x, this.footY, 12, 3, 0x000000, 0.3);
    }
    // 美術素材朝右繪製，霧屍預設往左走所以水平翻轉
    this.setFlipX(true);
    // 體型：胖瘦只改橫向寬度（spec.widthMul），高矮改整體大小（def.scale）
    this.setScale((def.scale ?? 1) * (spec.widthMul ?? 1), def.scale ?? 1);
    if (spec.hat !== 'none' && scene.textures.exists(GEAR_TEXTURE)) {
      const art = HAT_ART[spec.hat];
      this.hat = scene.add.image(x, y, GEAR_TEXTURE, spec.hat);
      this.hat.setData('ox', (art.ax + 0.5) / art.rows[0].length).setData('oy', (art.ay + 0.5) / art.rows.length);
    }
    if (spec.mutations.length && scene.textures.exists(GEAR_TEXTURE)) {
      this.mark = scene.add.image(x, y, GEAR_TEXTURE, 'mark').setTint(spec.mutations[0].mark);
    }
    this.restoreTint();
    if (scene.anims.exists(this.walkKey)) {
      this.play({ key: this.walkKey, startFrame: Phaser.Math.Between(0, 3) });
      // 跑得快的步伐也快
      this.anims.timeScale = spec.body === 'human' ? Phaser.Math.Clamp(def.speed / 18, 0.6, 2) : 1;
    }
    // 一點點速度差，讓屍群不會疊成一直線
    this.speedJitter = Phaser.Math.FloatBetween(0.85, 1.15);
    scene.add.existing(this);
    this.sync(0);
    const shadowW = { human: 22, dog: 30, bear: 56, crow: 0 }[spec.body];
    if (shadowW) Fx.of(scene)?.attachShadow(this, shadowW * this.s * (spec.widthMul ?? 1));
    GameEvents.of(scene).emit('enemy:spawn', { enemyId: def.id, x, y: this.footY });
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.hat?.destroy();
      this.mark?.destroy();
      this.crowShadow?.destroy();
      this.alertIcon?.destroy();
      this.dashLine?.destroy();
    });
  }

  /** 目前的移動速度與攻擊間隔（暴走時變快） */
  private get speedNow(): number {
    return this.def.speed * (this.enraged ? ENRAGE.speedMul : 1) * (this.legLost ? GORE.crawl.speedMul : 1);
  }

  private get attackIntervalNow(): number {
    return this.def.attackInterval * (this.enraged ? ENRAGE.attackIntervalMul : 1) * (this.legLost ? GORE.crawl.attackMul : 1);
  }

  /** 攻擊力（斷手變弱） */
  private get damageNow(): number {
    return this.def.damage * (this.armLost ? GORE.armDamageMul : 1);
  }

  /** 施加硬直（近戰武器用）；硬直抵抗高的職業（消防員）只會頓一下 */
  stagger(seconds: number): void {
    this.stunTimer = Math.max(this.stunTimer, seconds * (1 - this.spec.staggerResist));
  }

  private get s(): number {
    return this.def.scale ?? 1;
  }

  private restoreTint(): void {
    const t = this.dashState === 'windup' ? 0xff9a8a : this.enraged ? ENRAGE.tint : (this.spec.tint ?? this.def.tint);
    if (t) this.setTint(t);
    else this.clearTint();
    if (this.hat) {
      if (this.spec.hatTint) this.hat.setTint(this.spec.hatTint);
      else this.hat.clearTint();
    }
  }

  /** 頭頂在世界座標的位置（跟著影格、翻轉、縮放與搖晃）；倒地影格回傳 null */
  private headPoint(): { x: number; y: number } | null {
    if (this.spec.body !== 'human') {
      // 動物：判定框上緣、偏向頭的那一側
      const r = this.getHitRect();
      return { x: r.centerX + (this.flipX ? -1 : 1) * r.width * 0.3, y: r.y };
    }
    const a = this.legLost
      ? (crawlInfoOf(this.texture.key)?.head[Number(this.frame.name)] ?? null)
      : (this.base.anchors[Number(this.frame.name)] ?? (this.anims.isPlaying ? null : this.base.anchors[0]));
    if (!a) return null;
    const ox = this.originX * this.frame.width;
    const oy = this.originY * this.frame.height;
    let lx = (a.x + 0.5 - ox) * this.scaleX;
    if (this.flipX) lx = -lx;
    const ly = (a.y - oy) * this.scaleY;
    const r = this.rotation;
    return { x: this.x + lx * Math.cos(r) - ly * Math.sin(r), y: this.y + lx * Math.sin(r) + ly * Math.cos(r) };
  }

  /** 頭飾、變異標記跟著頭走 */
  private syncGear(): void {
    const hp = this.headPoint();
    if (this.hat) {
      if (hp) {
        const ox = this.hat.getData('ox') as number;
        const oy = this.hat.getData('oy') as number;
        this.hat
          .setVisible(true)
          .setFlipX(this.flipX)
          .setOrigin(this.flipX ? 1 - ox : ox, oy)
          .setPosition(hp.x, hp.y)
          .setScale(this.scaleX, this.scaleY)
          .setRotation(this.rotation)
          .setDepth(this.depth + 0.001);
      } else this.hat.setVisible(false);
    }
    if (this.mark && hp) {
      const bob = Math.sin(this.walkPhase * 0.7) * 1;
      const pulse = this.spec.burst === 'small' ? 1 + 0.25 * Math.abs(Math.sin(this.scene.time.now / 160)) : 1;
      this.mark
        .setPosition(hp.x, hp.y - (this.hat ? 12 : 7) * this.s + bob)
        .setScale(pulse)
        .setDepth(this.depth + 0.002);
    }
  }

  /**
   * 命中判定框：走路圖的影格四周有透明邊，所以不用整張圖的外框，
   * 只取身體所在的中間區域。以腳底為準，不受走路顛簸影響。
   */
  getHitRect(): Phaser.Geom.Rectangle {
    const s = this.s;
    switch (this.spec.body) {
      case 'dog':
        return new Phaser.Geom.Rectangle(this.footX - 17 * s, this.footY - 19 * s, 34 * s, 19 * s);
      case 'bear':
        return new Phaser.Geom.Rectangle(this.footX - 31 * s, this.footY - 44 * s, 62 * s, 44 * s);
      case 'crow': {
        // 飛在空中：判定框跟著高度走，比圖稍大一點，不然太難打
        const cy = this.footY - this.alt;
        return new Phaser.Geom.Rectangle(this.footX - 11 * s, cy - 8 * s, 22 * s, 15 * s);
      }
      default: {
        if (this.legLost) {
          // 趴在地上爬：又寬又矮
          return new Phaser.Geom.Rectangle(this.footX - 18 * s, this.footY - 24 * s, 36 * s, 24 * s);
        }
        const w = this.base.hit.w * s * (this.spec.widthMul ?? 1);
        const h = this.base.hit.h * s;
        return new Phaser.Geom.Rectangle(this.footX - w / 2, this.footY - h, w, h);
      }
    }
  }

  /** 頭部區域：人形是判定框上方 25%；屍犬的頭抬得高，上方 40%；屍鴉不分頭身 */
  isHeadshot(hitY: number): boolean {
    if (this.spec.body === 'crow') return false;
    const r = this.getHitRect();
    return hitY <= r.y + r.height * (this.spec.body === 'dog' || this.legLost ? 0.4 : 0.25);
  }

  update(dt: number, ctx: ZombieContext): void {
    if (this.dead) return;
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.downed && this.stunTimer <= 0) this.downed = false;
    if (this.airborne) this.updateAir(dt);
    if (this.knockVX !== 0) {
      // 被打飛滑行：速度指數衰減，總位移 ≈ knockVX / KNOCK_SLIDE_DECAY；空中幾乎不減速
      this.footX += this.knockVX * dt;
      this.x = this.footX;
      this.knockVX *= Math.exp(-(this.airborne ? LAUNCH.airDecay : KNOCK_SLIDE_DECAY) * dt);
      if (Math.abs(this.knockVX) < 4) {
        this.knockVX = 0;
        if (!this.airborne) this.bowled.clear();
      }
      if (dt > 0 && (this.airborne || Math.abs(this.knockVX) > 140)) this.bowl(ctx);
    }
    this.updateAbilities(dt, ctx);
    if (this.stunTimer > 0) {
      // 硬直：原地晃，不走也不打
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      this.attackTimer = 0;
      this.cancelWindup();
      if (this.dashState === 'windup' || this.dashState === 'dash') this.cancelDash();
      if (this.anims.isPlaying) this.anims.pause();
      this.sync(0, dt);
      return;
    }
    if (this.anims.isPaused) this.anims.resume();
    if (this.spec.body === 'crow') {
      this.updateCrow(dt, ctx);
      return;
    }
    if (this.pounceT > 0) {
      this.updatePounce(dt, ctx);
      return;
    }
    if (this.spec.profession.ability === 'sprint' && !this.legLost && this.updateDash(dt, ctx)) return;
    this.pounceCd -= dt;
    this.groanIn -= dt;
    if (this.groanIn <= 0) {
      this.groanIn = 4 + Math.random() * 8;
      GameEvents.of(this.scene).emit('enemy:groan', { enemyId: this.def.id, x: this.footX, y: this.footY });
    }
    this.hitLean *= Math.max(0, 1 - dt * 12);
    const blk = ctx.blockerFor?.(this.footX, this.footY);
    const blockX = blk ? blk.blockX : ctx.blockX;
    const rawHit = blk ? blk.hit : ctx.hitBlock;
    // 工人的鐵鎚、消防員的斧頭：拆路障、建築特別快
    const hitBlock = (d: number, y: number) => rawHit(d * this.spec.structureMul, y);
    const side = this.side;
    const minX = blockX + side * 18 * this.s;
    // 爬行是一下一下往前拖：撐起來時前進，趴下時幾乎不動
    const pulse = this.legLost ? 0.25 + 1.6 * Math.max(0, Math.sin(this.walkPhase)) : 1;
    const speed = this.speedNow * pulse * this.speedJitter * (ctx.speedMul?.(this.footX, this.footY) ?? 1);
    // 主角或夥伴在擋路線外側、而且夠近 → 改追最近的那個（2D 追擊）
    const p = this.pickTarget(ctx);
    const dx = p ? p.x - this.footX : 0;
    const dy = p ? p.y - this.footY : 0;

    let moved = false;
    // 屍犬：夠近就撲上去
    if (p && this.spec.body === 'dog' && this.pounceCd <= 0) {
      const dist = Math.hypot(dx, dy * 1.6);
      if (dist < POUNCE.range && dist > REACH_X) {
        this.startPounce(dx, dy);
        this.sync(1, dt);
        return;
      }
    }
    if (p) {
      const inReach = () => Math.abs(p.x - this.footX) <= REACH_X + 2 && Math.abs(p.y - this.footY) <= REACH_Y + 2;
      if (this.atkWind > 0 || (Math.abs(dx) <= REACH_X && Math.abs(dy) <= REACH_Y)) {
        // 前搖一旦開始就把這下打完（人退開就揮空），不會邊蓄力邊追
        if (this.atkWind <= 0) this.setFlipX(dx < 0);
        this.attack(dt, () => p.alive && inReach() && p.hit(this.damageNow, this.footX, this.footY, this), this.atkWind > 0 ? this.atkDir : Math.sign(dx) || -1);
      } else {
        // 盯上活人：加速逼近，貼近時再撲一段
        const gap = Math.hypot(dx, dy * 1.6);
        const chase = this.legLost ? 1 : gap < CHASE.closeDist ? CHASE.closeMul : CHASE.speedMul;
        // 站到主角的左邊或右邊，而不是疊在主角身上
        const side = dx >= 0 ? -1 : 1;
        const ex = p.x + side * (REACH_X - 4) - this.footX;
        const d = Math.hypot(ex, dy) || 1;
        // 前後（y）移動比左右慢，和主角一樣做出縱深感
        this.footX += (ex / d) * speed * chase * dt;
        this.footY += (dy / d) * speed * chase * 0.7 * dt;
        this.setFlipX(ex < 0);
        moved = true;
      }
      this.laneY = this.footY;
    } else if ((this.footX - minX) * side > 0) {
      // 主角躲在路障後：往主角那一排擠（聞得到活人），不是隨便找個位置敲路障
      const seen = this.nearestLiving(ctx);
      if (seen) this.laneY = Phaser.Math.Linear(this.laneY, seen.y, Math.min(1, dt * 0.8));
      // 屍熊：接近擋路線時衝撞，撞上的第一下特別重
      const charging = this.spec.body === 'bear' && !this.charged && (this.footX - minX) * side < CHARGE.from;
      const v = charging ? speed * CHARGE.speedMul : speed;
      this.footX = this.clampFront(this.footX - side * v * dt, minX);
      if (charging && (this.footX - minX) * side <= 0) {
        this.charged = true;
        hitBlock(this.damageNow * CHARGE.impactMul, this.footY);
        Fx.of(this.scene)?.popText(this.footX - side * 10, this.footY - 50, '衝撞！', '#ff9a4a');
        GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
      }
      this.footY += Phaser.Math.Clamp(this.laneY - this.footY, -speed * 0.5 * dt, speed * 0.5 * dt);
      this.setFlipX(side > 0);
      moved = true;
    } else {
      this.setFlipX(side > 0);
      // 敲路障時也慢慢往主角那一排挪
      const seen = this.nearestLiving(ctx);
      if (seen && this.atkWind <= 0) this.footY += Phaser.Math.Clamp(seen.y - this.footY, -speed * 0.25 * dt, speed * 0.25 * dt);
      this.attack(dt, () => hitBlock(this.damageNow, this.footY), -side, false);
    }

    // 不能穿過路障
    this.footX = this.clampFront(this.footX, minX);
    this.footY = clampLaneY(this.footY);
    if (moved) {
      this.cancelWindup();
      // 一貼上來很快就出手（first 秒後開始前搖），不是先發呆一整個攻擊間隔
      this.attackTimer = Math.max(0, this.attackIntervalNow - this.windupLen - ATTACK.first);
      if (this.legLost) {
        if (this.anims.isPlaying && this.anims.currentAnim?.key !== this.attackKey) this.anims.stop();
      } else if (this.anims.currentAnim?.key !== this.walkKey && this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      this.walkPhase += dt * (4 + this.speedNow * 0.12);
    } else if (this.anims.currentAnim?.key === this.walkKey) {
      // 停下來攻擊：不再原地踏步，回到站姿
      this.anims.stop();
      this.setFrame(0);
    }
    this.sync(moved ? 1 : 0, dt);
  }

  /** 原地走路（圖鑑用）：只更新動態與頭飾，不移動 */
  idle(dt: number): void {
    if (this.dead) return;
    this.updateAbilities(dt, {} as ZombieContext);
    this.walkPhase += dt * (4 + this.speedNow * 0.12);
    this.sync(1, dt);
  }

  // ───────────────────── 狂奔屍 ─────────────────────

  /**
   * 狂奔屍的衝刺狀態機。回傳 true 代表這一幀由衝刺接管（不再走一般的走路／攻擊）。
   * 預警分三層，讓玩家有明確的反應窗口：尖嘯音效 + 頭上紅色「！」+ 先後仰再蹲低的姿勢與抖動。
   */
  private updateDash(dt: number, ctx: ZombieContext): boolean {
    const blk = ctx.blockerFor?.(this.footX, this.footY);
    const blockX = blk ? blk.blockX : ctx.blockX;
    const side = this.side;
    const minX = blockX + side * 18 * this.s;
    switch (this.dashState) {
      case 'stalk': {
        this.dashCd -= dt;
        if (this.dashCd > 0) return false;
        // 先找擋路線外側、在範圍內的主角／夥伴；沒有就看離路障夠不夠近
        let best: ZombieTarget | null = null;
        let bestD = SPRINT.range;
        for (const t of this.targets(ctx)) {
          if (!t.alive || this.behind(t.x, ctx.blockX)) continue;
          const d = Math.hypot(t.x - this.footX, (t.y - this.footY) * 1.6);
          if (d < bestD && d > SPRINT.minRange) {
            bestD = d;
            best = t;
          }
        }
        const gap = (this.footX - minX) * side;
        if (!best && !(gap < SPRINT.range && gap > SPRINT.minRange)) return false;
        this.startWindup(best);
        return true;
      }
      case 'windup': {
        this.dashT -= dt;
        const tgt = this.dashTarget;
        if (tgt && !tgt.alive) this.dashTarget = null;
        const tx = this.dashTarget ? this.dashTarget.x : minX - side * 40;
        this.dashDir = Math.sign(tx - this.footX) || -side;
        this.setFlipX(this.dashDir < 0);
        const k = 1 - this.dashT / SPRINT.windup;
        this.alertIcon?.setVisible(Math.floor(this.dashT * 10) % 2 === 0 || k > 0.6);
        this.drawDashLine(tx, this.dashTarget ? this.dashTarget.y : this.footY, k);
        if (this.dashT <= 0) this.startDash(minX);
        this.sync(0, dt);
        // 前 40%：仰頭尖嘯；後 60%：壓低身體、越來越抖
        this.angle = k < 0.4 ? -this.dashDir * 10 * (k / 0.4) : this.dashDir * 16;
        this.y = this.footY + (k < 0.4 ? 0 : 2);
        this.x = this.footX + (k >= 0.4 ? (Math.floor(this.scene.game.loop.time / 30) % 2 ? 1 : -1) * (0.5 + k) : 0);
        this.syncAlert();
        return true;
      }
      case 'dash': {
        this.dashT -= dt;
        this.footX += this.dashVx * dt;
        this.footY = clampLaneY(this.footY + this.dashVy * dt);
        if (Math.random() < dt * 20) Fx.of(this.scene)?.footDust(this.footX, this.footY, this.dashDir);
        const t = this.dashTarget;
        let ended = this.dashT <= 0;
        if (t && t.alive && Math.abs(t.x - this.footX) <= REACH_X + 4 && Math.abs(t.y - this.footY) <= REACH_Y + 3) {
          t.hit(this.damageNow * SPRINT.impactMul, this.footX, this.footY, this);
          this.impact();
          ended = true;
        } else if ((this.footX - minX) * side <= 0) {
          // 撞上路障／建築
          this.footX = minX;
          const rawHit = blk ? blk.hit : ctx.hitBlock;
          rawHit(this.damageNow * SPRINT.impactMul * this.spec.structureMul, this.footY);
          this.impact();
          ended = true;
        }
        this.footX = this.clampFront(this.footX, minX);
        if (ended) {
          this.dashState = 'recover';
          this.dashT = SPRINT.recover;
          if (this.anims.isPlaying) this.anims.timeScale = Phaser.Math.Clamp(this.def.speed / 18, 0.6, 2);
        }
        this.walkPhase += dt * 14;
        this.sync(1, dt);
        this.angle = this.dashDir * 14;
        return true;
      }
      case 'recover': {
        // 撞完喘氣：站著不動，是反擊的好時機
        this.dashT -= dt;
        if (this.anims.currentAnim?.key === this.walkKey) {
          this.anims.stop();
          this.setFrame(0);
        }
        this.sync(0, dt);
        if (this.dashT <= 0) {
          this.dashState = 'stalk';
          this.dashCd = SPRINT.cooldown * Phaser.Math.FloatBetween(0.8, 1.2);
        }
        return true;
      }
    }
  }

  private startWindup(target: ZombieTarget | null): void {
    this.dashState = 'windup';
    this.dashT = SPRINT.windup;
    this.dashTarget = target;
    this.attackTimer = 0;
    if (this.anims.isPlaying) this.anims.stop();
    this.setFrame(0);
    this.setTint(0xff9a8a);
    if (!this.alertIcon) {
      this.alertIcon = this.scene.add
        .text(0, 0, '!', { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ff3a2a' })
        .setOrigin(0.5, 1)
        .setStroke('#1a0a08', 4)
        .setResolution(2);
    }
    this.alertIcon.setVisible(true);
    // 尖嘯的聲波圈
    const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
    for (let i = 0; i < 2; i++) {
      const ring = this.scene.add
        .ellipse(hp.x, hp.y, 6, 6)
        .setStrokeStyle(1.5, 0xff4a3a, 0.9)
        .setDepth(this.depth + 0.01);
      this.scene.tweens.add({ targets: ring, width: 46, height: 46, alpha: 0, delay: i * 180, duration: 420, onComplete: () => ring.destroy() });
    }
    GameEvents.of(this.scene).emit('enemy:scream', { enemyId: this.def.id, x: this.footX, y: this.footY });
  }

  private startDash(minX: number): void {
    const t = this.dashTarget;
    // 方向在這一刻鎖定：看到牠起跑時往旁邊閃就能躲掉
    const tx = t ? t.x : minX - this.side * 40;
    const ty = t ? t.y : this.footY;
    const dx = tx - this.footX;
    const dy = ty - this.footY;
    const d = Math.hypot(dx, dy) || 1;
    this.dashVx = (dx / d) * SPRINT.speed;
    this.dashVy = (dy / d) * SPRINT.speed * 0.7;
    this.dashDir = Math.sign(dx) || -this.side;
    this.dashState = 'dash';
    this.dashT = SPRINT.maxTime;
    this.alertIcon?.setVisible(false);
    this.dashLine?.clear();
    this.restoreTint();
    if (this.scene.anims.exists(this.walkKey)) {
      this.play(this.walkKey);
      this.anims.timeScale = 3;
    }
    Fx.of(this.scene)?.dust(this.footX - this.dashDir * 6, this.footY, 6);
    GameEvents.of(this.scene).emit('enemy:sprint', { enemyId: this.def.id, x: this.footX, y: this.footY });
  }

  private impact(): void {
    GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
    Fx.of(this.scene)?.dust(this.footX + this.dashDir * 8, this.footY, 8);
    Fx.of(this.scene)?.popText(this.footX, this.footY - 54 * this.s, '撞！', '#ff7a5a');
    this.scene.cameras.main.shake(120, 0.004);
    if (this.scene.anims.exists(this.attackKey)) this.play(this.attackKey);
  }

  /** 蓄力或衝刺途中被硬直（爆頭、近戰重擊）：打斷 */
  private cancelDash(): void {
    const wasWindup = this.dashState === 'windup';
    this.dashState = 'stalk';
    this.dashCd = SPRINT.cooldown * 0.6;
    this.alertIcon?.setVisible(false);
    this.dashLine?.clear();
    this.restoreTint();
    if (this.anims.isPlaying) this.anims.timeScale = Phaser.Math.Clamp(this.def.speed / 18, 0.6, 2);
    if (wasWindup && !this.dead) Fx.of(this.scene)?.popText(this.footX, this.footY - 58 * this.s, '打斷！', '#ffd84a');
  }

  /** 地上的衝刺路線：從腳底指向目標，長度＝衝刺能跑的距離；k 是蓄力進度 0..1 */
  private drawDashLine(tx: number, ty: number, k: number): void {
    this.dashLine ??= this.scene.add.graphics();
    const g = this.dashLine.clear().setDepth(1.5);
    const dx = tx - this.footX;
    const dy = (ty - this.footY) * 0.7;
    const d = Math.hypot(dx, dy) || 1;
    const len = Math.min(d, SPRINT.speed * SPRINT.maxTime);
    const ux = dx / d;
    const uy = dy / d;
    const a = 0.2 + 0.6 * k;
    for (let s = 8; s < len; s += 10) {
      const x = this.footX + ux * s;
      const y = this.footY + uy * s;
      g.fillStyle(0xff2a1a, a * (1 - (s / len) * 0.5)).fillRect(Math.round(x - 3), Math.round(y - 1), 6, 2);
    }
  }

  private syncAlert(): void {
    if (!this.alertIcon) return;
    const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
    this.alertIcon.setPosition(hp.x, hp.y - (this.hat ? 12 : 6) * this.s).setDepth(this.depth + 0.01);
  }

  // ───────────────────── 動物行為 ─────────────────────

  private startPounce(dx: number, dy: number): void {
    const d = Math.hypot(dx, dy) || 1;
    this.pounceT = POUNCE.time;
    this.pounceVx = (dx / d) * POUNCE.speed;
    this.pounceVy = (dy / d) * POUNCE.speed * 0.7;
    this.pounceHit = false;
    this.pounceCd = POUNCE.cooldown;
    this.anims.stop();
    this.setFrame(5);
    this.setFlipX(dx < 0);
    GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
  }

  /** 撲咬中：沿直線飛撲，途中碰到目標咬一口（傷害加成），落地後回到一般行為 */
  private updatePounce(dt: number, ctx: ZombieContext): void {
    this.pounceT -= dt;
    this.footX += this.pounceVx * dt;
    this.footY = clampLaneY(this.footY + this.pounceVy * dt);
    if (!this.pounceHit) {
      for (const t of this.targets(ctx)) {
        if (!t.alive || this.behind(t.x, ctx.blockX)) continue;
        if (Math.abs(t.x - this.footX) <= REACH_X && Math.abs(t.y - this.footY) <= REACH_Y + 4) {
          t.hit(this.damageNow * POUNCE.damageMul, this.footX, this.footY, this);
          this.pounceHit = true;
          break;
        }
      }
    }
    // 不能撲過路障
    this.footX = this.clampFront(this.footX, ctx.blockX + this.side * 18 * this.s);
    // 撲的時候身體離地一點
    this.lunge = 0;
    this.sync(0, dt);
    this.y -= Math.sin((1 - this.pounceT / POUNCE.time) * Math.PI) * 6;
    if (this.pounceT <= 0) {
      this.pounceT = 0;
      if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
    }
  }

  /**
   * 屍鴉：無視路障，在高空飛向最近的人（主角或夥伴），靠近後俯衝啄一下再拉高飛走，循環。
   * 主角躲在路障後面也會被啄，要抬高槍口打牠。
   */
  private updateCrow(dt: number, ctx: ZombieContext): void {
    const live = this.targets(ctx).filter((t) => t.alive);
    let tgt: ZombieTarget | null = null;
    let bestD = Infinity;
    for (const t of live) {
      const d = Math.hypot(t.x - this.footX, t.y - this.footY);
      if (d < bestD) {
        bestD = d;
        tgt = t;
      }
    }
    const speed = this.speedNow * this.speedJitter;
    const towards = (tx: number, ty: number, v: number) => {
      const dx = tx - this.footX;
      const dy = ty - this.footY;
      const d = Math.hypot(dx, dy) || 1;
      const step = Math.min(d, v * dt);
      this.footX += (dx / d) * step;
      this.footY = clampLaneY(this.footY + (dy / d) * step);
      if (Math.abs(dx) > 1) this.setFlipX(dx < 0);
    };
    const climb = (alt: number, rate: number) => {
      this.alt += Phaser.Math.Clamp(alt - this.alt, -rate * dt, rate * dt);
    };
    this.crowTimer -= dt;
    if (!tgt) {
      // 沒人可啄：在原地盤旋
      climb(CROW.cruiseAlt, 40);
      this.footX += Math.cos(this.walkPhase) * 20 * dt;
    } else if (this.crowState === 'approach') {
      climb(CROW.cruiseAlt, 40);
      towards(tgt.x + (this.footX > tgt.x ? 30 : -30), tgt.y, speed);
      if (Math.abs(tgt.x - this.footX) < 46 && this.crowTimer <= 0) {
        this.crowState = 'dive';
        this.anims.stop();
        this.setFrame(4);
      }
    } else if (this.crowState === 'dive') {
      climb(CROW.strikeAlt, CROW.diveSpeed);
      towards(tgt.x, tgt.y, CROW.diveSpeed);
      if (this.alt <= CROW.strikeAlt + 4 && Math.abs(tgt.x - this.footX) < 12 && Math.abs(tgt.y - this.footY) < 10) {
        tgt.hit(this.damageNow, this.footX, this.footY);
        GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
        this.crowState = 'retreat';
        this.crowTimer = CROW.retreatTime;
        if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      } else if (this.alt <= CROW.strikeAlt + 1 && Math.abs(tgt.x - this.footX) > 40) {
        // 撲空：拉高重來
        this.crowState = 'retreat';
        this.crowTimer = CROW.retreatTime * 0.6;
        if (this.scene.anims.exists(this.walkKey)) this.play(this.walkKey);
      }
    } else {
      climb(CROW.cruiseAlt, 70);
      const away = this.footX < tgt.x ? -1 : 1;
      this.footX = Phaser.Math.Clamp(this.footX + away * speed * dt, 20, 1260);
      this.setFlipX(away < 0);
      if (this.crowTimer <= 0) {
        this.crowState = 'approach';
        this.crowTimer = this.attackIntervalNow;
      }
    }
    this.walkPhase += dt * 6;
    this.sync(1, dt);
  }

  /** 不能越過擋路線：x 夾在 front 的外側（依進攻方向） */
  private clampFront(x: number, front: number): number {
    return this.side > 0 ? Math.max(front, x) : Math.min(front, x);
  }

  /** tx 在擋路線內側（據點那邊）：躲在路障後面的人不會被追 */
  private behind(tx: number, blockX: number): boolean {
    return (tx - blockX) * this.side < 0;
  }

  private targets(ctx: ZombieContext): ZombieTarget[] {
    const pl = ctx.player;
    return [{ x: pl.x, y: pl.y, alive: pl.alive, hit: ctx.hitPlayer }, ...(ctx.others ?? [])];
  }

  /** 擋路線外側、仇恨範圍內最近的目標；沒有就回傳 null */
  private pickTarget(ctx: ZombieContext): ZombieTarget | null {
    const list = this.targets(ctx);
    let best: ZombieTarget | null = null;
    // 探索戰鬥會把 aggroRange 設很大；屍犬本來就看得比較遠
    let bestD = Math.max(ctx.aggroRange ?? 0, this.spec.body === 'dog' ? POUNCE.aggro : AGGRO_RANGE);
    for (const t of list) {
      if (!t.alive || this.behind(t.x, ctx.blockX)) continue;
      const d = Math.hypot(t.x - this.footX, (t.y - this.footY) * 1.6) * (t.lure ?? 1);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** 這隻的攻擊前搖長度（秒） */
  private get windupLen(): number {
    return Phaser.Math.Clamp(this.attackIntervalNow * ATTACK.ratio, ATTACK.min, ATTACK.max);
  }

  /** 最近的活人（不管在不在路障外），給走向路障的霧屍挑排用 */
  private nearestLiving(ctx: ZombieContext): ZombieTarget | null {
    let best: ZombieTarget | null = null;
    let bestD = CHASE.laneSense;
    for (const t of this.targets(ctx)) {
      if (!t.alive) continue;
      const d = Math.abs(t.x - this.footX);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private cancelWindup(): void {
    this.atkWind = 0;
    this.atkPose = 0;
  }

  /**
   * 近身攻擊：計時到了先前搖（往後仰、低吼），前搖結束才真的出手。
   * hit 自己負責檢查人還在不在觸及範圍（退開就揮空）。
   */
  private attack(dt: number, hit: () => void, dir: number, cue = true): void {
    if (this.atkWind > 0) {
      this.atkWind = Math.max(0, this.atkWind - dt);
      const k = 1 - this.atkWind / this.windupLen;
      // 很快仰到底、再停一下：看得出「要咬了」
      this.atkPose = Math.min(1, k * 1.6);
      if (this.atkWind > 0) return;
      this.atkPose = 0;
      this.attackTimer = 0;
      hit();
      GameEvents.of(this.scene).emit('enemy:attack', { enemyId: this.def.id, x: this.footX, y: this.footY });
      if (this.scene.anims.exists(this.attackKey)) this.play(this.attackKey);
      // 攻擊時往前撲一下
      this.lunge = 5 * dir;
      this.scene.time.delayedCall(70, () => (this.lunge = 0));
      return;
    }
    this.attackTimer += dt;
    if (this.attackTimer >= this.attackIntervalNow - this.windupLen) {
      this.atkWind = this.windupLen;
      this.atkDir = dir;
      this.atkPose = 0;
      if (cue) GameEvents.of(this.scene).emit('enemy:windup', { enemyId: this.def.id, x: this.footX, y: this.footY });
    }
  }

  /** 職業能力與變異：再生、護理師光環 */
  private updateAbilities(dt: number, ctx: ZombieContext): void {
    this.sinceHit += dt;
    if (this.spec.regen > 0 && this.sinceHit > 2 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.spec.regen * dt);
      if (Math.random() < dt * 3) Fx.of(this.scene)?.popText(this.footX, this.footY - 50 * this.s, '+', '#4affb0');
    }
    if (this.spec.profession.ability === 'heal_aura' && ctx.zombies) {
      this.healTimer -= dt;
      if (this.healTimer <= 0) {
        this.healTimer = HEAL_AURA.interval;
        let n = 0;
        for (const z of ctx.zombies) {
          if (z === this || z.dead || z.hp >= z.maxHp) continue;
          if (Math.hypot(z.footX - this.footX, (z.footY - this.footY) * 1.6) > HEAL_AURA.radius) continue;
          z.hp = Math.min(z.maxHp, z.hp + HEAL_AURA.amount);
          Fx.of(this.scene)?.popText(z.footX, z.footY - 52 * z.s, '+', '#7aff9a');
          n++;
        }
        if (n > 0) {
          this.healPulse();
          GameEvents.of(this.scene).emit('enemy:heal', { enemyId: this.def.id, x: this.footX, y: this.footY, targets: n });
        }
      }
    }
  }

  private healPulse(): void {
    const ring = this.scene.add
      .ellipse(this.footX, this.footY, 8, 4)
      .setStrokeStyle(1, 0x7aff9a, 0.8)
      .setDepth(this.depth - 0.02);
    this.scene.tweens.add({
      targets: ring,
      width: HEAL_AURA.radius * 2,
      height: HEAL_AURA.radius * 1.25,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * 互相推開：兩隻在地面上太近時沿著彼此的方向各退一半，
   * 屍群會沿著柵欄散成一排、圍住主角時也會散成一圈，而不是疊成一團。
   * 地面距離把 y 放大計算（前後方向較「擠」），由場景每幀對所有霧屍兩兩呼叫。
   */
  static separate(a: Zombie, b: Zombie): void {
    if (a.dead || b.dead) return;
    if (a.airborne || b.airborne) return;
    // 飛在天上的不推擠
    if (a.spec.body === 'crow' || b.spec.body === 'crow') return;
    const Y_WEIGHT = 2;
    const dx = b.footX - a.footX;
    const dy = (b.footY - a.footY) * Y_WEIGHT;
    const minDist = 14 * Math.max(a.s, b.s);
    const dist = Math.hypot(dx, dy);
    if (dist >= minDist) return;
    let nx: number;
    let ny: number;
    if (dist < 0.01) {
      const r = Math.random() * Math.PI * 2;
      nx = Math.cos(r);
      ny = Math.sin(r);
    } else {
      nx = dx / dist;
      ny = dy / dist;
    }
    const push = (minDist - dist) / 2;
    a.footX -= nx * push;
    b.footX += nx * push;
    a.footY = clampLaneY(a.footY - (ny * push) / Y_WEIGHT);
    b.footY = clampLaneY(b.footY + (ny * push) / Y_WEIGHT);
    a.laneY = a.footY;
    b.laneY = b.footY;
  }

  /**
   * 擺位與程式化動態：走路時上下顛簸＋前後搖晃，停下時身體微微起伏，
   * 再疊上被打中的後仰。有影格動畫時只留很小的搖晃，避免和步伐打架。
   */
  private sync(walking: number, dt = 0): void {
    // 攻擊前搖：往後拉一點
    this.x = this.footX + this.lunge - this.atkDir * ATTACK.pull * this.atkPose;
    if (this.spec.body === 'crow') {
      // 飛行：位置在空中，地上留一個隨高度變小的影子；畫在地面角色之上
      this.y = this.footY - this.alt + Math.sin(this.walkPhase * 2) * 1.5;
      this.angle = this.hitLean;
      this.setDepth(depthForY(this.footY) + 25);
      const k = Phaser.Math.Clamp(1 - this.alt / 120, 0.3, 1);
      this.crowShadow?.setPosition(this.footX, this.footY).setScale(k).setDepth(depthForY(this.footY) - 0.5);
      this.syncGear();
      return;
    }
    const now = this.scene.game.loop.time;
    if (now < this.shakeUntil) this.x += (Math.floor(now / 25) % 2 ? 1 : -1) * this.shakeAmp;
    if (this.legLost) {
      // 爬行：沒有走路顛簸；兩格依爬的節奏交替（撐起來的那格往前拖）
      this.y = this.footY;
      this.angle = 0;
      if (walking && !this.anims.isPlaying) this.setFrame(Math.sin(this.walkPhase) > 0 ? 1 : 0);
    } else if (this.airborne || this.lift > 0) {
      this.y = this.footY - this.lift;
      this.angle = this.hitLean;
    } else if (walking) {
      this.y = this.footY - Math.abs(Math.sin(this.walkPhase)) * this.s;
      this.angle = Math.sin(this.walkPhase) * (this.anims.isPlaying ? 1.5 : 4) + this.hitLean;
    } else {
      this.y = this.footY;
      this.angle = Math.sin((this.walkPhase += dt * 3)) * 1.5 + this.hitLean;
    }
    // 前搖後仰（疊在其他姿勢上；受擊影格會蓋掉，那時本來就被打斷）
    if (this.atkPose > 0) {
      this.angle -= this.atkDir * ATTACK.lean * this.atkPose;
      this.y -= ATTACK.lift * this.atkPose;
    }
    this.setDepth(depthForY(this.footY));
    this.applyReactFrame();
    this.syncGear();
  }

  /** 有 H3 受擊影格的霧屍（一般人形）：受擊、擊飛、落地、爬起直接換格，不靠程式傾斜 */
  private get hasReact(): boolean {
    return this.spec.body === 'human' && this.texture.has(String(REACT_FRAMES.getup[3]));
  }

  private applyReactFrame(): void {
    if (!this.hasReact) return;
    let f = -1;
    if (this.airborne) f = this.bouncing ? REACT_FRAMES.bounce : this.liftVy < 0 ? REACT_FRAMES.rise : REACT_FRAMES.fall;
    else if (this.downed) {
      const g = REACT_FRAMES.getup;
      const k = 1 - this.stunTimer / REACT.getup;
      f = k < 0 ? REACT_FRAMES.down : g[Math.min(g.length - 1, Math.floor(k * g.length))];
    } else if (this.hitT > 0) {
      const h = REACT_FRAMES.hit;
      const k = 1 - this.hitT / REACT.hit;
      f = h[k < 0.25 ? 0 : k < 0.65 ? 1 : 2];
    }
    if (f >= 0) {
      if (this.anims.isPlaying) this.anims.pause();
      this.setFrame(f);
      // 動作影格本身就是姿勢，不再疊程式搖晃
      this.angle = 0;
    } else if (this.reactFrame >= 0) {
      // 動作播完：回到原本的動畫
      if (this.anims.currentAnim) this.anims.play(this.anims.currentAnim.key, true);
      else this.setFrame(0);
    }
    this.reactFrame = f;
  }

  /**
   * 護甲結算：回傳實際扣血量。爆頭打頭盔、打身體打防彈背心，再套天生減傷（消防衣、硬皮）。
   * 減傷用 src/combat/Damage.ts 的 armorAfter()：護甲 × 傷害類型係數 − 穿甲
   * （霰彈對護甲最無力、鈍器與爆炸無視部分護甲）。被吸收的傷害扣在裝備耐久上，歸零就壞掉。
   */
  private mitigate(amount: number, info: HitInfo): number {
    const pen = info.penetration ?? 0;
    const blast = info.type === 'blast';
    const bus = GameEvents.of(this.scene);
    const fx = Fx.of(this.scene);
    const dir = Math.sign(info.dirX ?? 1) || 1;
    let dmg = amount;
    if (info.headshot && !blast && this.helmet) {
      const piece = this.helmet;
      const a = armorAfter(piece.armor, info.type, pen);
      const absorbed = dmg * a;
      dmg -= absorbed;
      // 鈍擊特別容易把頭盔敲飛
      piece.hp -= absorbed * (info.type === 'blunt' ? 2 : 1) + 1;
      const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
      fx?.sparks(hp.x, hp.y + 3, info.dirX ?? 1, this.footY, 5);
      const broke = piece.hp <= 0;
      if (broke) this.knockOffHat(dir, 1.2);
      bus.emit('enemy:armor', { enemyId: this.def.id, x: hp.x, y: hp.y, part: 'helmet', broke });
    } else if (!info.headshot || blast) {
      if (this.vest) {
        const piece = this.vest;
        const a = armorAfter(piece.armor, info.type, pen);
        const absorbed = dmg * a;
        dmg -= absorbed;
        piece.hp -= absorbed;
        const broke = piece.hp <= 0;
        if (broke) {
          this.vest = null;
          fx?.popText(this.footX, this.footY - 44 * this.s, '破甲', '#c8d8ff');
        }
        if (a > 0) {
          fx?.sparks(this.footX, this.footY - 30 * this.s, info.dirX ?? 1, this.footY, 3);
          bus.emit('enemy:armor', { enemyId: this.def.id, x: this.footX, y: this.footY - 30 * this.s, part: 'vest', broke });
        }
      }
      const body = armorAfter(this.spec.bodyArmor, info.type, pen);
      dmg *= 1 - body;
    }
    return dmg;
  }

  /** 頭飾飛走（頭盔被打爆，或死亡時掉落） */
  private knockOffHat(dir: number, power = 1): void {
    if (!this.hat) return;
    const fx = Fx.of(this.scene);
    const hp = this.headPoint() ?? { x: this.footX, y: this.footY - 50 * this.s };
    if (fx) {
      fx.fling(GEAR_TEXTURE, this.spec.hat, hp.x, hp.y - 2, dir, this.footY + Phaser.Math.Between(-3, 3), {
        scale: this.s,
        tint: this.spec.hatTint,
        flipX: this.flipX,
        power,
      });
    }
    this.hat.destroy();
    this.hat = null;
    this.helmet = null;
  }

  /** 正在硬直（近戰處決、子彈打暈） */
  get stunned(): boolean {
    return this.stunTimer > 0;
  }

  /**
   * 子彈打到這裡會不會被擋下、不再往後穿：看這一槍打到的部位剩多少護甲（≥ 30% 就停）。
   * 只是預判，不會扣裝備耐久。
   */
  stopsBullet(info: Pick<DamageInfo, 'type' | 'penetration' | 'headshot'>): boolean {
    const raw = info.headshot ? (this.helmet?.armor ?? 0) : Math.max(this.vest?.armor ?? 0, this.spec.bodyArmor);
    return armorAfter(raw, info.type, info.penetration) >= 0.3;
  }

  /** 武器的統一入口：先上硬直（已含職業抗性），再交給 takeDamage 扣血與結算護甲 */
  takeHit(info: DamageInfo): boolean {
    if (this.dead) return false;
    if (info.stagger > 0) this.stagger(info.stagger);
    return this.takeDamage(info.amount, info.knockback, {
      headshot: info.headshot,
      dirX: info.dirX,
      type: info.type,
      penetration: info.penetration,
      hitY: info.hitY,
      heavy: info.heavy,
      gore: info.gore,
    });
  }

  takeDamage(amount: number, knockback: number, info: HitInfo = {}): boolean {
    if (this.dead) return false;
    const dealt = this.mitigate(amount, info);
    this.hp -= dealt;
    this.sinceHit = 0;
    // 擊退：小的當下推開；大的（鈍器）先推一截、剩下的滑出去，看得到被打飛
    const kb = knockback * (1 - this.spec.knockbackResist) * Math.sign(info.dirX ?? 1);
    // 大的擊退整段用滑的：卡肉時原地抖，停頓結束才飛出去（街機的打法）
    if (Math.abs(kb) > 12) this.knockVX += kb * KNOCK_SLIDE_DECAY;
    else this.footX += kb;
    this.x = this.footX;
    const fx = Fx.of(this.scene);
    if (this.hp <= 0) {
      this.dead = true;
      const dir = (info.dirX ?? 1) >= 0 ? 1 : -1;
      // 爆頭：頭整個炸開；近戰重擊殺掉也有機會
      const human = this.spec.body === 'human';
      const explode = human && (!!info.headshot || (!!info.heavy && Math.random() < GORE.heavyHeadBurst));
      const parts = explode ? goreParts(this.scene, this.baseKey) : null;
      if (explode && !info.headshot) fx?.popText(this.footX, this.footY - 60 * this.s, '爆頭', '#ffd24a');
      GameEvents.of(this.scene).emit('enemy:death', { enemyId: this.def.id, x: this.footX, y: this.footY, headshot: !!info.headshot, explode });
      // 倒下時頭飾一定掉
      this.knockOffHat(dir, info.headshot ? 1.3 : 0.7);
      this.mark?.destroy();
      this.mark = null;
      this.alertIcon?.destroy();
      this.alertIcon = null;
      this.dashLine?.destroy();
      this.dashLine = null;
      if (this.spec.burst) {
        const b = BURST[this.spec.burst];
        fx?.burst(this.footX, this.footY - 24 * this.s, this.footY, b.radius);
        GameEvents.of(this.scene).emit('enemy:burst', {
          enemyId: this.def.id,
          x: this.footX,
          y: this.footY,
          radius: b.radius,
          damage: b.damage,
        });
      }
      this.restoreTint();
      this.y = this.footY;
      if (fx && this.spec.body === 'crow') {
        // 屍鴉：從空中墜落，落地躺著
        fx.fling(this.texture.key, '6', this.x, this.y, dir, this.footY, { scale: this.s, flipX: this.flipX, power: 0.25 });
        fx.blood(this.x, this.y, dir, this.footY, 6, 0.6);
        this.destroy();
      } else if (fx && this.spec.body !== 'human') {
        // 屍犬、屍熊：身體是橫的，一律播倒地影格
        fx.fall(this, { dir, headshot: false, deathAnim: `${this.def.texture}_death`, forceAnim: true });
        this.destroy();
      } else if (fx && this.legLost) {
        // 爬行中被打死：原地癱平
        const hp = this.headPoint();
        fx.fall(this, {
          headX: hp?.x,
          headY: hp ? hp.y + 5 * this.s : undefined,
          dir,
          headshot: explode,
          flat: { neckX: crawlInfoOf(this.texture.key)?.neckX ?? 40 },
          explode: explode ? { parts } : undefined,
        });
        this.destroy();
      } else if (fx) {
        // 程式化倒地：複製當下影格成屍體，自己立刻移除
        const frame = this.frame.name;
        fx.fall(this, {
          dir,
          headshot: !!info.headshot || explode,
          explode: explode ? { parts } : undefined,
          headX: this.headPoint()?.x,
          headFrame: this.texture.has(`head_${frame}`) ? `head_${frame}` : undefined,
          neckRow: this.base.neck,
          deathAnim: `${this.def.texture}_death`,
        });
        this.destroy();
      } else {
        this.scene.tweens.add({ targets: this, angle: 90, alpha: 0, duration: 350, onComplete: () => this.destroy() });
      }
      return true;
    }
    this.tryDismember(dealt, info);
    // 囚犯：血量過半暴走
    if (this.spec.profession.ability === 'enrage' && !this.enraged && this.hp < this.maxHp * ENRAGE.below) {
      this.enraged = true;
      fx?.popText(this.footX, this.footY - 56 * this.s, '暴走', '#ff6a5a');
      GameEvents.of(this.scene).emit('enemy:enrage', { enemyId: this.def.id, x: this.footX, y: this.footY });
      if (this.anims.isPlaying) this.anims.timeScale *= ENRAGE.speedMul;
    }
    // 狂奔屍蓄力中被爆頭或重創：硬直，衝刺被打斷
    if (this.dashState === 'windup' && (info.headshot || info.heavy || dealt >= this.maxHp * 0.3)) this.stagger(0.5);
    // 受擊：閃白 → 轉紅 → 回正 + 擠壓 + 往後一仰
    // 受擊只染紅一下（整隻閃白太搶眼、會擋畫面）
    this.setTint(0xff7a6a);
    this.hat?.setTint(0xff7a6a);
    this.scene.time.delayedCall(140, () => this.active && !this.dead && this.restoreTint());
    fx?.squash(this, this.s, info.headshot ? 1.4 : 1, this.s * (this.spec.widthMul ?? 1));
    if (this.hasReact && !this.airborne && !this.downed) this.hitT = REACT.hit;
    if (!this.airborne && !this.downed) this.hitLean = (info.headshot ? 12 : 7) * Math.sign(info.dirX ?? 1) * (1 - this.spec.knockbackResist * 0.5) * (this.hasReact ? 0 : 1);
    return false;
  }

  /** 這一下有沒有把手或腳打斷（機率見 GORE） */
  private tryDismember(dealt: number, info: HitInfo): void {
    if (this.dead || this.spec.body !== 'human' || this.airborne || dealt <= 0) return;
    if (this.spec.knockbackResist >= GORE.resistAbove) return;
    if (this.armLost && this.legLost) return;
    if (!canDismember(this.scene, this.baseKey)) return;
    const type = info.type ?? 'ballistic';
    let part: 'arm' | 'leg' | null;
    if (info.hitY !== undefined) {
      const r = this.getHitRect();
      const rel = (info.hitY - r.y) / r.height;
      // 爬行中整隻都很矮，打到身體就算手
      part = this.legLost ? (rel < 0.4 ? null : 'arm') : rel < 0.25 ? null : rel < 0.6 ? 'arm' : 'leg';
    } else part = Math.random() < (type === 'blast' ? 0.4 : 0.55) ? 'arm' : 'leg';
    if (part === 'arm' && this.armLost) part = info.hitY === undefined ? 'leg' : null;
    if (part === 'leg' && this.legLost) part = info.hitY === undefined ? 'arm' : null;
    if (!part || (part === 'arm' && this.armLost) || (part === 'leg' && this.legLost)) return;
    const base = GORE.chance[type] ?? GORE.chance.ballistic;
    const chance = Math.min(GORE.max, base * (info.gore ?? 1) * (info.heavy ? GORE.heavyMul : 1) * Phaser.Math.Clamp((dealt / this.maxHp) * 3, 0.4, 1.6));
    if (Math.random() >= chance) return;
    const dir = (info.dirX ?? 1) >= 0 ? 1 : -1;
    if (part === 'arm') this.loseArm(dir);
    else this.loseLegs(dir);
  }

  /** 換成斷肢版本的貼圖，動畫 key 一起換 */
  private swapTexture(key: string): void {
    const frame = this.legLost ? 0 : Number(this.frame.name) || 0;
    this.walkKey = `${key}_walk`;
    this.attackKey = `${key}_attack`;
    this.anims.stop();
    this.setTexture(key, frame);
    if (!this.legLost && this.scene.anims.exists(this.walkKey)) this.play({ key: this.walkKey, startFrame: Math.min(3, frame) });
  }

  /** 斷手：前臂飛出去，照樣往前走，但攻擊力變弱 */
  loseArm(dir: number): void {
    if (this.armLost || this.dead) return;
    const key = this.legLost ? crawlTexture(this.scene, this.baseKey, true) : armlessTexture(this.scene, this.baseKey);
    const parts = goreParts(this.scene, this.baseKey);
    if (!key || !parts) return;
    this.armLost = true;
    this.swapTexture(key);
    const facing = this.flipX ? -1 : 1;
    const y = this.legLost ? this.footY - 10 * this.s : this.footY - 32 * this.s;
    Fx.of(this.scene)?.limb(parts, 'arm', this.footX + facing * 14 * this.s, y, dir, this.footY, {
      scale: this.s,
      tint: this.spec.tint ?? this.def.tint,
      flipX: this.flipX,
    });
    GameEvents.of(this.scene).emit('enemy:dismember', { enemyId: this.def.id, x: this.footX, y: this.footY, part: 'arm' });
  }

  /** 斷腳：腿飛出去、倒在地上，之後趴著往前爬 */
  loseLegs(dir: number): void {
    if (this.legLost || this.dead) return;
    const key = crawlTexture(this.scene, this.baseKey, this.armLost);
    const parts = goreParts(this.scene, this.baseKey);
    const info = key ? crawlInfoOf(key) : undefined;
    if (!key || !parts || !info) return;
    this.legLost = true;
    // 倒地中、受擊動作都取消，直接趴下
    this.downed = false;
    this.hitT = 0;
    this.lift = 0;
    this.hitLean = 0;
    this.reactFrame = -1;
    this.swapTexture(key);
    this.setOrigin(info.cx / this.base.size, this.base.foot / this.base.size);
    const fx = Fx.of(this.scene);
    fx?.limb(parts, 'leg', this.footX, this.footY - 14 * this.s, dir, this.footY, {
      scale: this.s,
      tint: this.spec.tint ?? this.def.tint,
      flipX: this.flipX,
    });
    fx?.dust(this.footX, this.footY, 6);
    // 頭飾在倒下時掉了
    this.knockOffHat(dir, 0.6);
    this.stagger(0.6);
    GameEvents.of(this.scene).emit('enemy:dismember', { enemyId: this.def.id, x: this.footX, y: this.footY, part: 'leg' });
  }

  /** 卡肉期間原地左右抖（用真實時間，畫面停住也照抖） */
  hitShake(ms: number, amp: number): void {
    this.shakeUntil = this.scene.game.loop.time + ms;
    this.shakeAmp = amp;
  }

  get inAir(): boolean {
    return this.airborne;
  }

  /**
   * 重擊打飛：拋物線飛起 → 落地彈一次 → 滑行 → 倒地一段時間再爬起來。
   * power 是起飛的垂直速度（px/s），dist 是大約的水平距離。動物和重量級（擊退抗性高）飛不高。
   */
  launch(dir: number, power: number, dist: number): void {
    if (this.dead || this.spec.body === 'crow' || this.legLost) return;
    const res = this.spec.knockbackResist;
    if (res >= 0.8) return;
    // 空中追打（浮空連段）：再被打只會小彈一下，不會越打越高
    const k = (1 - res) * (this.airborne || this.lift > 0 ? 0.55 : 1);
    this.airborne = true;
    this.liftVy = -power * k;
    this.bounces = 1;
    this.bowled.clear();
    const air = (2 * power * k) / LAUNCH.gravity;
    this.knockVX = (Math.sign(dir) || 1) * ((dist * k) / Math.max(0.15, air));
    this.hitLean = this.hasReact ? 0 : (Math.sign(dir) || 1) * 35;
    this.bouncing = false;
    this.downed = false;
    this.stunTimer = Math.max(this.stunTimer, 3);
  }

  private updateAir(dt: number): void {
    this.liftVy += LAUNCH.gravity * dt;
    this.lift -= this.liftVy * dt;
    const dir = Math.sign(this.knockVX) || 1;
    // 空中慢慢往後倒（有擊飛影格就用影格的姿勢）
    if (!this.hasReact) this.hitLean += (dir * 80 - this.hitLean) * Math.min(1, dt * 6);
    if (this.lift > 0 || this.liftVy < 0) return;
    this.lift = 0;
    const fx = Fx.of(this.scene);
    fx?.dust(this.footX, this.footY, 6);
    if (this.bounces > 0) {
      // 落地彈一下
      this.bounces--;
      this.liftVy = -this.liftVy * LAUNCH.bounce;
      this.knockVX *= 0.6;
      this.bouncing = true;
      return;
    }
    // 倒地：躺著滑一段，倒地時間到再爬起來（硬直結束後 hitLean 回正＝爬起）
    this.airborne = false;
    this.liftVy = 0;
    this.knockVX = dir * 60;
    this.bouncing = false;
    if (this.hasReact) {
      // 躺著 → 爬起影格（硬直最後 REACT.getup 秒播爬起）
      this.hitLean = 0;
      this.downed = true;
      this.stunTimer = LAUNCH.down + REACT.getup;
    } else {
      this.hitLean = dir * 85;
      this.stunTimer = LAUNCH.down;
    }
  }

  /** 被打飛／高速滑行時撞到路徑上的霧屍：對方被撞歪、小硬直，最多撞倒 BOWL_MAX 隻 */
  private bowl(ctx: ZombieContext): void {
    if (!ctx.zombies || this.bowled.size >= BOWL_MAX) return;
    const dir = Math.sign(this.knockVX) || 1;
    for (const o of ctx.zombies) {
      if (o === this || o.dead || o.airborne || this.bowled.has(o) || o.spec.body === 'crow') continue;
      const dx = (o.footX - this.footX) * dir;
      if (dx < -2 || dx > 12 * Math.max(this.s, o.s) || Math.abs(o.footY - this.footY) > 7) continue;
      this.bowled.add(o);
      o.bowled.add(this);
      const dmg = Math.min(4, o.hp - 1);
      o.takeDamage(Math.max(0, dmg), 30 * dir, { dirX: dir, type: 'blunt' });
      o.stagger(0.45);
      o.hitShake(70, 1);
      Fx.of(this.scene)?.meleeImpact(o.footX - dir * 4, o.footY - 26 * o.s, dir, 'blunt', o.footY);
      this.knockVX *= 0.8;
      if (this.bowled.size >= BOWL_MAX) break;
    }
  }
}
