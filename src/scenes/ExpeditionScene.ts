import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { COMPANION_ROLES } from '../data/companions';
import { getZone, MEDKIT_HEAL, NOISE, SUPPLIES, type EventOption, type ExploreEvent, type Outcome } from '../data/explore';
import { Expedition, playerExploreHp, describeLoot, type Resolution } from '../explore/Expedition';
import { uiBar, uiButton, uiPanel } from '../explore/ui';
import { GameState } from '../state/GameState';
import type { Chapter } from '../data/story';
import { getWeapon } from '../data/weapons';
import { pixelText } from '../utils/text';
import { backdropScenery } from '../scenery/locations';
import { placeStaticProps } from '../scenery/SceneryBuilder';
import type { DefenseSceneData } from './DefenseScene';
import type { ExploreFieldData, FieldResult } from './ExploreFieldScene';
import type { QteData } from './QteScene';

/** 事件卡放右邊，左邊留給場景插圖（事件寫到的東西都畫在這裡） */
const CARD_X = 316;
const CARD_Y = 84;
const CARD_W = GAME_WIDTH - CARD_X - 12;
const CARD_H = 262;
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
      this.scene.start('Defense', {} as DefenseSceneData);
      return;
    }
    this.exp = exp;
    this.event = null;
    AudioManager.setMood('menu');
    this.cameras.main.fadeIn(300, 0, 0, 0);
    this.backdropFor = '';
    this.drawBackdrop(null);

    // 上方狀態列
    this.add.rectangle(0, 0, GAME_WIDTH, 26, 0x000000, 0.6).setOrigin(0).setDepth(98);
    pixelText(this, 8, 6, `探索：${exp.zone.name}`, 9, '#f5d76e');
    pixelText(this, 150, 7, '生命', 8);
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
      const max = COMPANION_ROLES[m.role].maxHp;
      const t = pixelText(this, cx, 7, `${m.name} ${hp > 0 ? `${hp}/${max}` : '倒下'}`, 8, hp > 0 ? '#c8e6c9' : '#ef9a9a').setOrigin(1, 0);
      this.hud.add(t);
      cx -= t.width + 10;
    }
  }

  // ── 事件卡 ──

  private clearCard(): void {
    this.card.removeAll(true);
  }

  private cardFrame(title: string, text: string, color = '#f5d76e'): void {
    this.clearCard();
    this.card.add(uiPanel(this, CARD_X, CARD_Y, CARD_W, CARD_H));
    this.card.add(pixelText(this, CARD_X + 14, CARD_Y + 10, title, 11, color));
    this.card.add(pixelText(this, CARD_X + 14, CARD_Y + 32, text, 8, '#e0e0e0').setWordWrapWidth(CARD_W - 28, true).setLineSpacing(3));
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
    this.cardFrame(title, text);
    const bw = (CARD_W - 28 - 16) / 3;
    const by = CARD_Y + CARD_H - 40;
    this.card.add(uiButton(this, CARD_X + 14, by, bw, 28, '前進 ▶', () => this.enterNode(), { fill: 0x7a2a22, size: 9 }));
    const meds = GameState.data.supplies.medkit;
    this.card.add(
      uiButton(this, CARD_X + 22 + bw, by, bw, 28, `用醫療包（${meds}）`, () => this.useMedkit(), {
        enabled: meds > 0 && e.hp < playerExploreHp(),
        sub: `+${MEDKIT_HEAL} 生命`,
      }),
    );
    this.card.add(uiButton(this, CARD_X + 30 + bw * 2, by, bw, 28, first ? '回據點' : '撤退回據點', () => this.retreat(), { fill: 0x3a3f4a, sub: '帶著背包回家' }));
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
    this.cardFrame(ev.title, ev.text, ev.id === 'horde' ? '#ff6b6b' : '#f5d76e');
    const n = ev.options.length;
    const bh = 30;
    const gap = 6;
    const y0 = CARD_Y + CARD_H - 12 - n * bh - (n - 1) * gap;
    ev.options.forEach((opt, i) => {
      const blocked = this.exp.blocked(opt);
      let sub = opt.hint ?? '';
      if (opt.consume) sub = `消耗${SUPPLIES[opt.consume].name}（剩 ${GameState.data.supplies[opt.consume]}）${sub ? '・' + sub : ''}`;
      if (opt.action.type === 'check') sub += `・成功率 ${Math.round(this.exp.checkChance(opt.action) * 100)}%`;
      if (blocked) sub = `${blocked === '沒有' && opt.consume ? `沒有${SUPPLIES[opt.consume].name}` : blocked}`;
      this.card.add(
        uiButton(this, CARD_X + 14, y0 + i * (bh + gap), CARD_W - 28, bh, opt.label, () => this.choose(ev, opt), {
          enabled: !blocked,
          sub,
          subColor: opt.consume ? '#ffd24a' : undefined,
        }),
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
          onDone: (ok) => {
            this.input.enabled = true;
            this.resolve(ev, ok ? a.success : a.fail);
          },
        };
        this.input.enabled = false;
        this.clearCard();
        this.scene.launch('Qte', data);
        this.scene.bringToTop('Qte');
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

  private resultLines(res: Resolution): string[] {
    const lines = describeLoot(res.gained).map((l) => `＋ ${l}`);
    if (res.hurt) lines.push(`你受傷了 −${res.hurt}`);
    for (const c of res.crewHurt) lines.push(`${c.name} 受傷 −${c.amount}${c.downed ? '，倒下了（回據點後休養）' : ''}`);
    if (res.noise) lines.push(`噪音 +${res.noise}`);
    return lines;
  }

  private showResult(ev: ExploreEvent, res: Resolution): void {
    this.cardFrame(ev.title, res.text);
    const lines = this.resultLines(res);
    lines.slice(0, 7).forEach((l, i) => {
      const bad = l.includes('−') || l.startsWith('噪音');
      this.card.add(pixelText(this, CARD_X + 24, CARD_Y + 70 + i * 14, l, 8, bad ? '#ff8a80' : '#9ad17a'));
    });
    if (lines.length === 0) this.card.add(pixelText(this, CARD_X + 24, CARD_Y + 70, '（什麼也沒得到）', 8, '#90a4ae'));
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
    if (res) this.resultLines(res).slice(0, 5).forEach((l, i) => this.card.add(pixelText(this, CARD_X + 24, CARD_Y + 80 + i * 14, l, 8, '#ff8a80')));
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
    const res = e.bank();
    AudioManager.play(full ? 'stinger_win' : 'ui_confirm');
    this.cardFrame(full ? '滿載而歸' : '撤退回據點', bagLines.length ? '帶回來的東西都收進了據點：' : '這趟空手而回。');
    const lines = [...bagLines];
    if (res.overflowScrap) lines.push(`（放不下的換成廢料 +${res.overflowScrap}）`);
    for (const r of res.recruits) lines.push(`${r.name}（${COMPANION_ROLES[r.role].title}）加入了隊伍！`);
    const injured = e.squad.filter((m) => (e.crewHp.get(m.id) ?? 0) <= 0);
    for (const m of injured) lines.push(`${m.name} 負傷，休養 1 天`);
    lines.slice(0, 9).forEach((l, i) => this.card.add(pixelText(this, CARD_X + 24, CARD_Y + 52 + i * 13, l, 8, l.includes('負傷') ? '#ef9a9a' : '#9ad17a')));
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
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Defense', {} as DefenseSceneData));
  }
}
