import Phaser from 'phaser';

/**
 * 遊戲事件匯流排：玩法程式只負責「發生了什麼」，音效、震動、NPC 反應、統計等
 * 系統各自訂閱，不必互相 import。每個遊戲場景一條，場景關閉時自動清空。
 *
 *   GameEvents.of(scene).on('player:shoot', (e) => sfx.play(e.weaponId));
 *
 * 座標都是世界座標；音效可以用 x 和鏡頭中心算左右聲道。
 */
export interface GameEventMap {
  /** 開了一槍（霰彈槍一次射出多顆也只發一次） */
  'player:shoot': { weaponId: string; x: number; y: number; angle: number; pellets: number; ammoLeft: number; magazine: number };
  /** 彈匣空了或換彈中還扣扳機（喀一聲） */
  'player:dryfire': { weaponId: string };
  /** 開始換彈；style 是裝填方式（magazine / single / whole），empty 代表打空才換（要多拉一次槍機） */
  'player:reload-start': { weaponId: string; duration: number; style?: string; empty?: boolean };
  /** 一顆一顆塞的武器：塞進一顆（霰彈、栓動）；clip 代表用橋夾一次壓滿 */
  'player:reload-round': { weaponId: string; loaded: number; magazine: number; clip?: boolean };
  /** 打空後最後拉一下泵動／槍栓 */
  'player:rack': { weaponId: string };
  /** 換彈被開火或近戰打斷（已塞進去的子彈保留） */
  'player:reload-cancel': { weaponId: string };
  'player:reload-end': { weaponId: string };
  /** 泵動／栓動：開完一槍後上膛（音效接拉槓聲） */
  'player:cycle': { weaponId: string; kind: 'pump' | 'bolt'; x: number; y: number; delay: number };
  /** 近戰揮擊（起手時發） */
  'player:melee-swing': { weaponId: string; x: number; y: number; heavy: boolean; tired: boolean; combo?: number; finisher?: boolean };
  /** 揮擊進入判定段（球棒揮到前方）的那一刻：場景道具在這時候算打中 */
  'player:melee-active': { x: number; y: number; heavy: boolean };
  /** 近戰打中（每隻各一次）；type 是傷害類型（slash / blunt） */
  'player:melee-hit': { weaponId: string; x: number; y: number; type: string; killed: boolean; execute: boolean; combo?: number; finisher?: boolean };
  /** 體力不夠還硬揮 */
  'player:exhausted': { stamina: number };
  'player:weapon-switch': { weaponId: string };
  /** 每一步落地；foot 左右腳交替，speed 0..1 */
  'player:step': { x: number; y: number; foot: 0 | 1; speed: number };
  /** 主角真的被扣血（無敵時間內不會發） */
  /** 阿凱的閃身步閃過一次攻擊 */
  'player:dodge': { x: number; y: number };
  /** 被霧屍抓住（count：目前有幾隻抓著） */
  'player:grabbed': { count: number };
  'player:hurt': { amount: number; hp: number; maxHp: number; fromX: number; fromY: number };
  /** 進入／離開低血量狀態 */
  'player:low-hp': { entering: boolean; hp: number; maxHp: number };
  /** 低血量時每一下心跳（畫面紅邊跟著跳），音效可以接心跳聲 */
  'player:heartbeat': { hp: number; maxHp: number };
  'player:death': { x: number; y: number };
  /** 子彈打中敵人（每顆彈丸各一次） */
  'enemy:hit': { enemyId: string; x: number; y: number; damage: number; headshot: boolean; killed: boolean };
  'barricade:hit': { damage: number; y: number; hp: number; maxHp: number; x?: number };
  /** 路障被打爛 */
  'barricade:break': { x: number };
  'base:hit': { damage: number; hp: number; maxHp: number; x?: number };
  /** 霧屍出現／低吼／出手攻擊／死亡（任何傷害來源，包含之後的 NPC 隊友） */
  'enemy:spawn': { enemyId: string; x: number; y: number };
  'enemy:groan': { enemyId: string; x: number; y: number };
  'enemy:attack': { enemyId: string; x: number; y: number };
  'enemy:death': { enemyId: string; x: number; y: number; headshot: boolean };
  /** 子彈打在頭盔／防彈衣上；broke 代表這一下把它打壞（頭盔飛走） */
  'enemy:armor': { enemyId: string; x: number; y: number; part: 'helmet' | 'vest'; broke: boolean };
  /** 腫脹霧屍或「爆裂」變異死亡時爆開；場景負責結算範圍傷害 */
  'enemy:burst': { enemyId: string; x: number; y: number; radius: number; damage: number };
  /** 囚犯霧屍血量過半後暴走 */
  'enemy:enrage': { enemyId: string; x: number; y: number };
  /** 護理師霧屍替附近同伴回血 */
  'enemy:heal': { enemyId: string; x: number; y: number; targets: number };
  'wave:start': { wave: number; total: number };
  'game:over': { survived: boolean };
  /** NPC 夥伴開了一槍 */
  'ally:shoot': { role: string; x: number; y: number; angle: number; weaponId?: string };
  /** 夥伴真的被扣血 */
  'ally:hurt': { name: string; role: string; amount: number; hp: number; maxHp: number; x: number; y: number };
  /** 夥伴陣亡（永久離隊） */
  'ally:death': { name: string; role: string; x: number; y: number };
  /** 醫護補了一次血 */
  'ally:heal': { amount: number; x: number; y: number };
  /** 全隊指令切換 */
  'ally:order': { order: 'hold' | 'follow' };
  /** 工兵修路障：修理中每 0.5 秒一次（敲槌子的節奏） */
  'barricade:repair': { amount: number; hp: number; maxHp: number };
}

export type GameEventName = keyof GameEventMap;

const registry = new WeakMap<Phaser.Scene, GameEvents>();

export class GameEvents {
  private emitter = new Phaser.Events.EventEmitter();

  /** 取得（必要時建立）這個場景的事件匯流排 */
  static of(scene: Phaser.Scene): GameEvents {
    let bus = registry.get(scene);
    if (!bus) {
      bus = new GameEvents();
      registry.set(scene, bus);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        bus!.emitter.removeAllListeners();
        registry.delete(scene);
      });
    }
    return bus;
  }

  emit<K extends GameEventName>(name: K, payload: GameEventMap[K]): void {
    this.emitter.emit(name, payload);
  }

  on<K extends GameEventName>(name: K, fn: (e: GameEventMap[K]) => void, context?: unknown): this {
    this.emitter.on(name, fn, context);
    return this;
  }

  once<K extends GameEventName>(name: K, fn: (e: GameEventMap[K]) => void, context?: unknown): this {
    this.emitter.once(name, fn, context);
    return this;
  }

  off<K extends GameEventName>(name: K, fn?: (e: GameEventMap[K]) => void, context?: unknown): this {
    this.emitter.off(name, fn, context);
    return this;
  }
}
