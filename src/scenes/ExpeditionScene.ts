import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { COMPANION_ROLES } from '../data/companions';
import { crewStats } from '../data/crewLoadout';
import { getZone, MEDKIT_HEAL, NOISE, SUPPLIES, WALK, type EventOption, type ExploreEvent, type Outcome } from '../data/explore';
import { Expedition, playerExploreHp, describeLoot, lootEntries, type Resolution } from '../explore/Expedition';
import { ensureEventArt, icon, VIG_H, VIG_W, type IconId } from '../art/EventArt';
import { ensureIllustration, illustrationFor, ILLUS_H, ILLUS_W } from '../art/IllustrationArt';
import { uiBar, uiButton, uiPanel, uiTopBar } from '../explore/ui';
import { icon as uiIcon } from '../ui/theme';
import { GameState } from '../state/GameState';
import type { Chapter } from '../data/story';
import { getWeapon } from '../data/weapons';
import { pixelText, wrapCJK } from '../utils/text';
import { backdropScenery } from '../scenery/locations';
import { placeStaticProps } from '../scenery/SceneryBuilder';
import type { DefenseSceneData } from './DefenseScene';
import type { ExploreFieldData, FieldResult } from './ExploreFieldScene';
import type { QteData } from './QteScene';
import type { LockData } from './LockScene';
import type { SiegeData, SiegeResult } from './SiegeScene';

/** 事件卡放右邊，左邊留給場景插圖（事件寫到的東西都畫在這裡） */
const CARD_X = 316;
const CARD_Y = 76;
const CARD_W = GAME_WIDTH - CARD_X - 12;
const CARD_H = 270;
/** 卡片最上方的事件插圖（284×86） */
const ART_X = CARD_X + 14;
const ART_Y = CARD_Y + 10;
/** 有插圖時標題的位置 */
const BODY_Y = ART_Y + VIG_H + 6;
/** 插圖擺件的範圍 */
const ART_SPAN: [number, number] = [24, 296];

/**
 * 一趟探索的主畫面：上方是路線與狀態，中間是事件卡。
 * 事件的選項可能直接結算、跳出 QTE，或進入潛入／戰鬥場景（這個場景先睡著，打完再叫醒）。
 */
export class ExpeditionScene extends Phaser.Scene {
  private exp!: Expedition;
  private card!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private setHp!: (r: number) => void;
  private setNoise!: (r: number) => void;
  private hpText!: Phaser.GameObjects.Text;
  private noiseText!: Phaser.GameObjects.Text;
  private bagText!: Phaser.GameObjects.Text;
  private event: ExploreEvent | null = null;
  /** 最後選的選項（屍潮要知道是不是丟了誘餌） */
  private lastOpt: EventOption | null = null;
  private backdrop!: Phaser.GameObjects.Container;
  private backdropFor = '';

  constructor() {
    super('Expedition');
  }

  create(): void {
    const exp = Expedition.current;
    if (!exp) {
      this.scene.start(GameState.data.route ? 'ExploreMap' : 'Defense', {} as DefenseSceneData);
      return;
    }
    this.exp = exp;
    this.event = null;
    AudioManager.setMood('menu');
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.backdropFor = '';
    this.drawBackdrop(null);

    // 上方狀態列
    uiTopBar(this, 26, 98);
    pixelText(this, 8, 6, `探索：${exp.zone.name}`, 9, '#f5d76e');
    uiIcon(this, 166, 8, 'heart');
    this.setHp = uiBar(this, 178, 9, 70, 7, 0xef5350);
    this.hpText = pixelText(this, 252, 7, '', 8);
    pixelText(this, 296, 7, '噪音', 8, '#ffcc80');
    this.setNoise = uiBar(this, 324, 9, 70, 7, 0xffa726);
    this.noiseText = pixelText(this, 398, 7, '', 8, '#ffcc80');
    this.bagText = pixelText(this, 8, GAME_HEIGHT - 16, '', 8, '#c8c8c8').setDepth(100);

    this.hud = this.add.container(0, 0).setDepth(100);
    this.card = this.add.container(0, 0).setDepth(100);
    this.refreshHud();
    this.showApproach();
  }

  /**
   * 背景：這一站的場景插圖。換事件就重畫（儲物間有紙箱、鐵櫃前有櫃子、拾荒者在營火旁…）。
   * 所有物件先畫在場景上，再整批收進一個容器，換場景時一起清掉。
   */
  private drawBackdrop(eventId: string | null): void {
    const key = eventId ?? 'arrive';
    if (key === this.backdropFor) return;
    this.backdropFor = key;
    this.backdrop?.destroy(true);
    const before = new Set(this.children.list);
    const res = backdropScenery(this, this.exp.zone.id, eventId, ART_SPAN);
    placeStaticProps(this, res);
    // 暗角＋霧，讓插圖不要搶走事件卡的注意力
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070c, res.darkness + 0.12).setOrigin(0).setDepth(41);
    for (let i = 0; i < 3; i++) {
      const fog = this.add.rectangle(0, 150 + i * 50, GAME_WIDTH * 1.5, 40, 0x9aa3ad, 0.05).setOrigin(0).setDepth(42);
      this.tweens.add({ targets: fog, x: -GAME_WIDTH * 0.4, duration: 14000 + i * 5000, yoyo: true, repeat: -1 });
    }
    const made = this.children.list.filter((o) => !before.has(o));
    this.backdrop = this.add.container(0, 0).setDepth(-1);
    // 容器會吃掉子物件的深度：照原本的深度排好再放進去
    made.sort((a, b) => ((a as unknown as { depth: number }).depth ?? 0) - ((b as unknown as { depth: number }).depth ?? 0));
    this.backdrop.add(made);
    // 淡入
    this.backdrop.setAlpha(0);
    this.tweens.add({ targets: this.backdrop, alpha: 1, duration: 350 });
  }

  // ── 狀態列 ──

  private refreshHud(): void {
    const e = this.exp;
    this.setHp(e.hp / playerExploreHp());
    this.hpText.setText(`${e.hp}`);
    this.setNoise(e.noise / NOISE.max);
    this.noiseText.setText(e.noise >= NOISE.max ? '屍潮！' : `${e.noise}`);
    const bag = describeLoot(e.bag);
    this.bagText.setText(`背包：${bag.length ? bag.join('・') : '空的'}`);

    this.hud.removeAll(true);
    // 路線
    const n = e.zone.nodes;
    const x0 = 120;
    const x1 = GAME_WIDTH - 120;
    const y = 52;
    const g = this.add.graphics();
    g.lineStyle(2, 0x5a606b, 1).lineBetween(x0, y, x1, y);
    this.hud.add(g);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1);
      const done = i < e.index;
      const cur = i === e.index;
      const finale = i === n - 1;
      this.hud.add(this.add.circle(x, y, finale ? 9 : 7, done ? 0x4caf50 : cur ? 0xf5d76e : 0x2a2f3a).setStrokeStyle(2, 0x000000));
      this.hud.add(pixelText(this, x, y + 12, finale ? '大獎' : `第 ${i + 1} 站`, 7, cur ? '#f5d76e' : '#90a4ae').setOrigin(0.5, 0));
      if (finale) this.hud.add(pixelText(this, x, y, '★', 8, '#000000').setOrigin(0.5));
    }
    // 起點（據點）
    this.hud.add(this.add.rectangle(x0 - 30, y, 10, 10, 0x4caf50));
    this.hud.add(pixelText(this, x0 - 30, y + 12, '據點', 7, '#9ad17a').setOrigin(0.5, 0));

    // 隊員
    let cx = GAME_WIDTH - 8;
    for (const m of [...e.squad].reverse()) {
      const hp = e.crewHp.get(m.id) ?? 0;
      const max = crewStats(m).maxHp;
      const t = pixelText(this, cx, 7, `${m.name} ${hp > 0 ? `${hp}/${max}` : '倒下'}`, 8, hp > 0 ? '#c8e6c9' : '#ef9a9a').setOrigin(1, 0);
      this.hud.add(t);
      cx -= t.width + 10;
    }
  }

  // ── 事件卡 ──

  private clearCard(): void {
    this.card.removeAll(true);
  }

  /**
   * 卡片外框＋最上方的插圖＋標題＋說明。art：事件 id（畫事件插圖）、'zone'（這一區的章節插圖）或不畫。
   * 回傳說明文字的底部 y，呼叫端接著往下排。
   */
  private cardFrame(title: string, text: string, color = '#f5d76e', art?: string): number {
    this.clearCard();
    this.card.add(uiPanel(this, CARD_X, CARD_Y, CARD_W, CARD_H));
    let y = CARD_Y + 10;
    if (art) {
      this.drawArt(art);
      y = BODY_Y;
    }
    this.card.add(pixelText(this, CARD_X + 14, y, title, 11, color));
    const t = wrapCJK(pixelText(this, CARD_X + 14, y + 19, text, 8, '#e0e0e0').setLineSpacing(2), CARD_W - 28);
    this.card.add(t);
    return t.y + t.height;
  }

  /** 卡片頂端的插圖：外框像一格漫畫分鏡，淡入時輕輕往上滑 */
  private drawArt(art: string): void {
    let img: Phaser.GameObjects.Image;
    if (art === 'zone') {
      // 章節插圖是 400×120：裁中間一塊
      const key = ensureIllustration(this, illustrationFor(this.exp.zone.id));
      const cx = Math.round((ILLUS_W - VIG_W) / 2);
      const cy = ILLUS_H - VIG_H - 4;
      img = this.add.image(ART_X - cx, ART_Y - cy, key).setOrigin(0).setCrop(cx, cy, VIG_W, VIG_H);
    } else {
      img = this.add.image(ART_X, ART_Y, ensureEventArt(this, art, this.exp.zone.id)).setOrigin(0);
    }
    img.setDepth(100);
    const frame = this.add.rectangle(ART_X - 1, ART_Y - 1, VIG_W + 2, VIG_H + 2).setOrigin(0).setStrokeStyle(1, 0x000000, 1).setDepth(101);
    const inner = this.add.rectangle(ART_X, ART_Y, VIG_W, VIG_H).setOrigin(0).setStrokeStyle(1, 0xf5d76e, 0.25).setDepth(101);
    this.card.add([img, frame, inner]);
    img.setAlpha(0);
    const y0 = img.y;
    img.y += 3;
    this.tweens.add({ targets: img, alpha: 1, y: y0, duration: 260, ease: 'Quad.easeOut' });
  }

  /** 按鈕左邊加一個小圖示 */
  private withIcon(objs: Phaser.GameObjects.GameObject[], x: number, y: number, h: number, id: IconId, enabled = true): Phaser.GameObjects.GameObject[] {
    const im = icon(this, x + 11, y + h / 2, id);
    if (im) {
      if (!enabled) im.setAlpha(0.35);
      objs.push(im);
    }
    return objs;
  }

  /** 戰利品／代價清單：小圖示＋文字，排成兩欄 */
  private iconList(entries: { icon: IconId; text: string; color: string }[], y: number, maxRows: number): void {
    const colW = (CARD_W - 28) / 2;
    const rows = Math.min(maxRows, Math.ceil(entries.length / 2));
    const twoCol = entries.length > maxRows;
    entries.slice(0, twoCol ? rows * 2 : maxRows).forEach((e, i) => {
      const col = twoCol ? Math.floor(i / rows) : 0;
      const row = twoCol ? i % rows : i;
      const x = CARD_X + 18 + col * colW;
      const yy = y + row * 15;
      const im = icon(this, x + 6, yy + 6, e.icon);
      if (im) this.card.add(im);
      this.card.add(pixelText(this, x + 16, yy, e.text, 8, e.color));
    });
  }

  /** 選項的圖示：看它會做什麼（QTE 種類、潛入、戰鬥、檢定、消耗用品…） */
  private optionIcon(opt: EventOption): IconId {
    const a = opt.action;
    if (opt.consume) return opt.consume;
    switch (a.type) {
      case 'qte':
        return a.qte.kind === 'timing' ? 'timing' : a.qte.kind === 'sequence' ? 'arrows' : 'mash';
      case 'field':
        if (a.field.mode === 'stealth') return 'stealth';
        if (a.field.meleeOnly) return 'melee';
        if (a.field.goal === 'protect') return 'protect';
        if (a.field.goal === 'survive') return 'survive';
        return 'fight';
      case 'check':
        return 'check';
      case 'lock':
        return 'lockpick';
      case 'siege':
        return 'siege';
      case 'outcome':
        if (a.outcome.scrapCost) return 'trade';
        if (a.outcome.loot || a.outcome.bonus || a.outcome.survivor) return 'bag';
        return 'leave';
    }
  }

  /** 兩站之間：前進、撤退、用醫療包 */
  private showApproach(): void {
    const e = this.exp;
    this.refreshHud();
    const first = e.index === 0;
    if (e.index === 0) this.drawBackdrop(null);
    const story = e.chapter && e.isFinale;
    const title = story ? `最後一站：${e.chapter!.objective}` : e.isFinale ? '最後一站：大獎就在前面' : first ? `抵達${e.zone.name}` : `前往第 ${e.index + 1} 站`;
    const who = e.squad.length ? '你們' : '你';
    let text = first ? e.zone.blurb : `${who}稍作休息，檢查一下裝備。要繼續深入，還是見好就收？`;
    if (e.chapter && first) text += `\n\n主線　${e.chapter.title}：${e.chapter.objective}（在最後一站）`;
    if (e.intel && first) text += `\n\n情報：${e.intel.name}。${e.intel.desc}`;
    if (e.noise >= NOISE.max) text += '\n\n四周的吼聲越來越近……噪音太大，屍潮正在逼近！';
    this.cardFrame(title, text.replace(/\n\n/g, '\n'), '#f5d76e', first ? 'zone' : 'walk');
    // 2×2：沿街前進（橫向捲軸）／抄近路（直接看事件）／醫療包／撤退
    const gap = 8;
    const bw = (CARD_W - 28 - gap) / 2;
    const bh = 28;
    const x0 = CARD_X + 14;
    const x1 = x0 + bw + gap;
    const y1 = CARD_Y + CARD_H - 12 - bh;
    const y0 = y1 - bh - 6;
    const stop = e.isFinale ? '大獎' : `第 ${e.index + 1} 站`;
    this.card.add(
      this.withIcon(uiButton(this, x0, y0, bw, bh, '沿街前進 ▶', () => this.walk(stop), { fill: 0x7a2a22, size: 9, sub: '橫向推進・路上能搜刮' }), x0, y0, bh, 'walk'),
    );
    this.card.add(this.withIcon(uiButton(this, x1, y0, bw, bh, '抄近路', () => this.enterNode(), { sub: `直接到${stop}` }), x1, y0, bh, 'fast'));
    const meds = GameState.data.supplies.medkit;
    const canHeal = meds > 0 && e.hp < playerExploreHp();
    this.card.add(
      this.withIcon(
        uiButton(this, x0, y1, bw, bh, `醫療包（${meds}）`, () => this.useMedkit(), { enabled: canHeal, sub: `+${MEDKIT_HEAL} 生命` }),
        x0,
        y1,
        bh,
        'medkit',
        canHeal,
      ),
    );
    this.card.add(
      this.withIcon(uiButton(this, x1, y1, bw, bh, first ? '回據點' : '撤退回據點', () => this.retreat(), { fill: 0x3a3f4a, sub: '帶著背包回家' }), x1, y1, bh, 'leave'),
    );
  }

  /**
   * 沿街前進：先抽好這一站的事件，再進入橫向捲軸的街道（只能左右走），
   * 走到右邊的路牌才翻開事件卡。路上的霧屍、箱子都是實際要處理的東西。
   */
  private walk(stop: string): void {
    AudioManager.ui('confirm');
    const ev = this.exp.nextEvent();
    this.event = ev;
    const data: ExploreFieldData = {
      spec: { mode: 'fight', goal: 'reach', title: `沿街前進：走到${stop}`, zombies: WALK.zombies, walk: true, axis: 'single', exitLabel: stop },
      onDone: (r: FieldResult) => {
        this.scene.wake();
        this.cameras.main.fadeIn(250, 0, 0, 0);
        AudioManager.setMood('menu');
        if (r.result === 'down') {
          this.exp.hp = 0;
          this.showDown();
          return;
        }
        this.showEvent(ev);
      },
    };
    this.clearCard();
    this.scene.sleep();
    this.scene.launch('ExploreField', data);
  }

  private useMedkit(): void {
    if (!GameState.useSupply('medkit')) return;
    this.exp.hp = Math.min(playerExploreHp(), this.exp.hp + MEDKIT_HEAL);
    AudioManager.ui('confirm');
    this.showApproach();
  }

  private enterNode(): void {
    AudioManager.ui('confirm');
    this.event = this.exp.nextEvent();
    this.showEvent(this.event);
  }

  private showEvent(ev: ExploreEvent): void {
    this.drawBackdrop(ev.id);
    this.refreshHud();
    this.cardFrame(ev.title, ev.text, ev.id === 'horde' ? '#ff6b6b' : '#f5d76e', ev.id);
    const n = ev.options.length;
    const bh = n >= 3 ? 27 : 30;
    const gap = n >= 3 ? 4 : 6;
    const y0 = CARD_Y + CARD_H - 12 - n * bh - (n - 1) * gap;
    ev.options.forEach((opt, i) => {
      const blocked = this.exp.blocked(opt);
      let sub = opt.hint ?? '';
      if (opt.consume) sub = `消耗${SUPPLIES[opt.consume].name}（剩 ${GameState.data.supplies[opt.consume]}）${sub ? '・' + sub : ''}`;
      if (opt.action.type === 'check') sub += `・成功率 ${Math.round(this.exp.checkChance(opt.action) * 100)}%`;
      if (blocked) sub = `${blocked === '沒有' && opt.consume ? `沒有${SUPPLIES[opt.consume].name}` : blocked}`;
      const by = y0 + i * (bh + gap);
      this.card.add(
        this.withIcon(
          uiButton(this, CARD_X + 14, by, CARD_W - 28, bh, opt.label, () => this.choose(ev, opt), {
            enabled: !blocked,
            sub,
            subColor: opt.consume ? '#ffd24a' : undefined,
          }),
          CARD_X + 14,
          by,
          bh,
          this.optionIcon(opt),
          !blocked,
        ),
      );
    });
  }

  private choose(ev: ExploreEvent, opt: EventOption): void {
    if (opt.consume && !GameState.useSupply(opt.consume)) return;
    this.lastOpt = opt;
    const a = opt.action;
    switch (a.type) {
      case 'outcome':
        this.resolve(ev, a.outcome);
        break;
      case 'check': {
        const chance = this.exp.checkChance(a);
        const ok = this.exp.rng.next() < chance;
        const o = ok ? a.success : a.fail;
        this.resolve(ev, { ...o, text: `${ok ? '成功！' : '失敗……'}${o.text}` });
        break;
      }
      case 'qte': {
        const data: QteData = {
          spec: a.qte,
          ease: this.exp.qteEase(),
          comic: a.comic ? { id: a.comic, zone: this.exp.zone.id } : undefined,
          onDone: (grade) => {
            this.input.enabled = true;
            const o = grade === 'great' ? a.great ?? a.success : grade === 'ok' ? a.success : a.fail;
            const tag = grade === 'great' ? '大成功！' : '';
            this.resolve(ev, { ...o, text: tag + o.text });
          },
        };
        this.input.enabled = false;
        this.clearCard();
        this.scene.launch('Qte', data);
        this.scene.bringToTop('Qte');
        break;
      }
      case 'lock': {
        const data: LockData = {
          spec: a.lock,
          zone: this.exp.zone.id,
          ease: this.exp.qteEase(),
          onDone: (ok) => {
            this.input.enabled = true;
            this.refreshHud();
            this.resolve(ev, ok ? a.success : a.fail);
          },
        };
        this.input.enabled = false;
        this.clearCard();
        this.scene.launch('Lock', data);
        this.scene.bringToTop('Lock');
        break;
      }
      case 'siege': {
        const data: SiegeData = {
          spec: a.siege,
          zone: this.exp.zone.id,
          risk: this.exp.zone.risk,
          onDone: (r: SiegeResult) => {
            this.scene.wake();
            this.cameras.main.fadeIn(250, 0, 0, 0);
            AudioManager.setMood('menu');
            if (r === 'down') {
              this.exp.hp = 0;
              this.showDown();
              return;
            }
            this.resolve(ev, r === 'win' ? a.success : a.fail);
          },
        };
        this.clearCard();
        this.scene.sleep();
        this.scene.launch('Siege', data);
        break;
      }
      case 'field': {
        const data: ExploreFieldData = {
          spec: a.field,
          eventId: ev.id,
          onDone: (r: FieldResult) => this.afterField(ev, r, a.success, a.clean),
        };
        this.clearCard();
        this.scene.sleep();
        this.scene.launch('ExploreField', data);
        break;
      }
    }
  }

  private afterField(ev: ExploreEvent, r: FieldResult, success: Outcome, clean?: Outcome): void {
    this.scene.wake();
    this.cameras.main.fadeIn(250, 0, 0, 0);
    AudioManager.setMood('menu');
    if (r.result === 'down') {
      this.exp.hp = 0;
      this.showDown();
      return;
    }
    const o = r.result === 'clean' && clean ? clean : success;
    this.resolve(ev, { ...o, text: `${o.text}${r.kills ? `（擊殺 ${r.kills}）` : ''}` });
  }

  private resolve(ev: ExploreEvent, o: Outcome): void {
    const res = this.exp.apply(o);
    // 屍潮：打完噪音降到一半；丟誘餌直接歸零
    if (ev.id === 'horde') this.exp.noise = this.lastOpt?.consume === 'decoy' ? 0 : NOISE.afterHorde;
    this.exp.advance();
    this.refreshHud();
    if (this.exp.hp <= 0) {
      this.showDown(res);
      return;
    }
    this.showResult(ev, res);
  }

  private resultLines(res: Resolution): { icon: IconId; text: string; color: string }[] {
    const lines = lootEntries(res.gained).map((l) => ({ ...l, color: '#9ad17a' }));
    const bad = '#ff8a80';
    if (res.hurt) lines.push({ icon: 'hurt', text: `你受傷 −${res.hurt}`, color: bad });
    for (const c of res.crewHurt) lines.push({ icon: 'hurt', text: `${c.name} −${c.amount}${c.downed ? ' 倒下' : ''}`, color: bad });
    if (res.noise) lines.push({ icon: 'noise', text: `噪音 +${res.noise}`, color: bad });
    return lines;
  }

  private showResult(ev: ExploreEvent, res: Resolution): void {
    const bottom = this.cardFrame(ev.title, res.text, '#f5d76e', ev.id);
    const lines = this.resultLines(res);
    const y = bottom + 6;
    const room = Math.max(1, Math.floor((CARD_Y + CARD_H - 46 - y) / 15));
    this.iconList(lines, y, room);
    if (lines.length === 0) this.card.add(pixelText(this, CARD_X + 24, y, '（什麼也沒得到）', 8, '#90a4ae'));
    const by = CARD_Y + CARD_H - 40;
    if (this.exp.finished) {
      this.card.add(uiButton(this, CARD_X + 14, by, CARD_W - 28, 28, '滿載而歸，回據點 ▶', () => this.goHome(true), { fill: 0x3a4a2a, size: 9 }));
    } else {
      this.card.add(uiButton(this, CARD_X + 14, by, CARD_W - 28, 28, '繼續', () => this.showApproach(), { size: 9 }));
    }
  }

  private showDown(res?: Resolution): void {
    AudioManager.play('stinger_lose');
    const solo = this.exp.squad.length === 0;
    this.cardFrame(
      '你倒下了',
      solo ? '眼前一黑。等你醒來，已經拖著身子爬回了據點……背包裡的東西全都丟在了路上。' : '眼前一黑。等你醒來，已經被隊員拖回了據點……背包裡的東西全都丟在了路上。',
      '#ff6b6b',
    );
    if (res) this.iconList(this.resultLines(res).filter((l) => l.color !== '#9ad17a'), CARD_Y + 80, 5);
    this.exp.fail();
    this.bagText.setText('背包：全部丟失').setColor('#ff8a80');
    if (this.exp.squad.length) this.card.add(pixelText(this, CARD_X + 24, CARD_Y + CARD_H - 58, '同行隊員為了把你拖回來都掛了彩，要休養 1 天。', 8, '#ef9a9a'));
    this.card.add(uiButton(this, CARD_X + 14, CARD_Y + CARD_H - 40, CARD_W - 28, 28, '回據點', () => this.leave(), { fill: 0x3a3f4a, size: 9 }));
  }

  private retreat(): void {
    this.goHome(false);
  }

  /** 平安回家：背包入帳，列出收穫 */
  private goHome(full: boolean): void {
    const e = this.exp;
    const bagLines = describeLoot(e.bag);
    const bagSnapshot = JSON.parse(JSON.stringify(e.bag)) as typeof e.bag;
    const res = e.bank();
    AudioManager.play(full ? 'stinger_win' : 'ui_confirm');
    this.cardFrame(full ? '滿載而歸' : '撤退回據點', bagLines.length ? '帶回來的東西都收進了據點：' : '這趟空手而回。');
    const good = '#9ad17a';
    const lines: { icon: IconId; text: string; color: string }[] = lootEntries(bagSnapshot)
      .filter((l) => l.icon !== 'survivor')
      .map((l) => ({ ...l, color: good }));
    if (res.overflowScrap) lines.push({ icon: 'scrap', text: `放不下的換廢料 +${res.overflowScrap}`, color: good });
    for (const r of res.recruits) lines.push({ icon: 'survivor', text: `${r.name}（${COMPANION_ROLES[r.role].title}）入隊`, color: '#f5d76e' });
    const injured = e.squad.filter((m) => (e.crewHp.get(m.id) ?? 0) <= 0);
    for (const m of injured) lines.push({ icon: 'hurt', text: `${m.name} 負傷休養 1 天`, color: '#ef9a9a' });
    this.iconList(lines, CARD_Y + 52, 10);
    const ch = res.chapter;
    const next = ch ? () => this.showChapterDone(ch) : () => this.leave();
    this.card.add(uiButton(this, CARD_X + 14, CARD_Y + CARD_H - 40, CARD_W - 28, 28, ch ? '繼續 ▶' : '回據點', next, { fill: 0x3a4a2a, size: 9 }));
  }

  /** 主線一章完成：收尾劇情＋開放了什麼 */
  private showChapterDone(ch: Chapter): void {
    AudioManager.play('stinger_win');
    this.cardFrame(`完成　${ch.title}`, ch.outro.join('\n'), '#f5d76e');
    const unlocked: string[] = [];
    for (const id of ch.openZones) unlocked.push(`新區域：${getZone(id)?.name ?? id}`);
    const guns = ch.shop.map((id) => getWeapon(id)?.name ?? id);
    if (guns.length) unlocked.push(`軍械庫進貨：${guns.join('、')}`);
    const nextCh = GameState.chapter;
    if (nextCh) unlocked.push(`下一章：${nextCh.title}（第 ${nextCh.minDay} 天起）`);
    unlocked.forEach((l, i) => this.card.add(pixelText(this, CARD_X + 24, CARD_Y + CARD_H - 50 - (unlocked.length - i) * 13, l, 8, '#9ad17a')));
    this.card.add(uiButton(this, CARD_X + 14, CARD_Y + CARD_H - 40, CARD_W - 28, 28, '回據點', () => this.leave(), { fill: 0x3a4a2a, size: 9 }));
  }

  private leave(): void {
    AudioManager.ui('confirm');
    this.cameras.main.fadeOut(300, 0, 0, 0);
    // 路線圖模式：打完回路線圖繼續走（時間到了會在那裡天黑）
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start(GameState.data.route ? 'ExploreMap' : 'Defense', {} as DefenseSceneData));
  }
}
