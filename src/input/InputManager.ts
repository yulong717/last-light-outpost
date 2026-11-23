import Phaser from 'phaser';
import { toLogical } from '../render/RenderScale';

/**
 * 動作抽象層：遊戲邏輯只問「要不要開槍、瞄哪裡、要不要換彈」，
 * 不直接碰鍵盤、滑鼠或觸控。之後加手把或虛擬搖桿只要改這裡。
 */
export interface InputState {
  /** 移動方向，-1 ~ 1（x 向右為正、y 向下＝往鏡頭靠近為正） */
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  /** 正在按住開火 */
  fireHeld: boolean;
  /** 這一幀剛按下開火（半自動武器用） */
  firePressed: boolean;
  reloadPressed: boolean;
  /** 指定切換到第幾把武器（0 起算），-1 代表沒切換 */
  selectWeapon: number;
  nextWeapon: boolean;
  /** 這一幀按下近戰（右鍵、V、E 或觸控按鈕；F 是夥伴指令） */
  meleePressed: boolean;
  /** 近戰鍵按住不放（連續揮擊） */
  meleeHeld: boolean;
  /** 切換近戰模式（4、X 或觸控「持刀」鍵）：槍收起來，攻擊鍵改成揮擊 */
  toggleMelee: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };

/** UI 按鈕所在的區域，點在這些區域不會觸發開火。 */
const uiRects = new Set<Rect>();

export function registerUIRect(rect: Rect): () => void {
  uiRects.add(rect);
  return () => uiRects.delete(rect);
}

/** 指標是否落在 UI 上；pointer.x/y 是畫布像素，先換算成 640×360 邏輯座標。 */
export function isPointerOverUI(p: { x: number; y: number }): boolean {
  const l = toLogical(p.x, p.y);
  return isOverUI(l.x, l.y);
}

/** x、y 為 640×360 邏輯座標。 */
export function isOverUI(x: number, y: number): boolean {
  for (const r of uiRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

/**
 * 觸控虛擬搖桿：手指在畫面左下角按下就是搖桿，不會開火。
 * 座標是畫面座標（不受鏡頭捲動影響）；UIScene 讀這裡畫出搖桿。
 */
export const JOYSTICK_ZONE: Rect = { x: 0, y: 170, w: 200, h: 190 };
export const JOYSTICK_RADIUS = 26;
export const joystick = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0 };

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 讓 UI 按鈕（換彈、換槍）也能送出動作。 */
const queued = { reload: false, next: false, melee: false, stance: false };
export function queueAction(action: 'reload' | 'next' | 'melee' | 'stance'): void {
  queued[action] = true;
}

/** 觸控近戰鍵按住不放：連續揮擊 */
const held = { melee: false };
export function holdAction(action: 'melee', down: boolean): void {
  held[action] = down;
}

export class InputManager {
  private scene: Phaser.Scene;
  private keys: Record<
    'reload' | 'one' | 'two' | 'three' | 'four' | 'stance' | 'swap' | 'melee' | 'melee2' | 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd',
    Phaser.Input.Keyboard.Key
  > | null = null;
  private movePointerId: number | null = null;
  /** 按下又放開都在同一幀之間的快速點擊，也要算一發（半自動武器） */
  private tapQueued: { x: number; y: number } | null = null;
  private wasFiring = false;
  private firingPointerId: number | null = null;

  readonly state: InputState = {
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    fireHeld: false,
    firePressed: false,
    reloadPressed: false,
    selectWeapon: -1,
    nextWeapon: false,
    meleePressed: false,
    meleeHeld: false,
    toggleMelee: false,
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = {
        reload: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
        one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
        two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
        three: kb.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
        four: kb.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
        stance: kb.addKey(Phaser.Input.Keyboard.KeyCodes.X),
        melee: kb.addKey(Phaser.Input.Keyboard.KeyCodes.V),
        melee2: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
        swap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
        down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
        w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    }
    // 右鍵不要跳出瀏覽器選單
    scene.input.mouse?.disableContextMenu();

    joystick.active = false;
    held.melee = false;
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // 滑鼠右鍵 = 近戰，不會開火
      if (!p.wasTouch && p.rightButtonDown()) {
        if (!isPointerOverUI(p)) queued.melee = true;
        return;
      }
      const l = toLogical(p.x, p.y);
      if (p.wasTouch && this.movePointerId === null && inRect(JOYSTICK_ZONE, l.x, l.y) && !isOverUI(l.x, l.y)) {
        this.movePointerId = p.id;
        joystick.active = true;
        joystick.baseX = joystick.knobX = l.x;
        joystick.baseY = joystick.knobY = l.y;
        return;
      }
      if (this.firingPointerId === null && !isOverUI(l.x, l.y)) {
        this.firingPointerId = p.id;
        this.tapQueued = { x: p.x, y: p.y };
      }
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.firingPointerId) this.firingPointerId = null;
      if (p.id === this.movePointerId) this.releaseJoystick();
    });
  }

  private releaseJoystick(): void {
    this.movePointerId = null;
    joystick.active = false;
  }

  update(): InputState {
    const s = this.state;
    const pointers = [this.scene.input.activePointer, ...this.scene.input.manager.pointers];
    const firing = pointers.find((p) => p && p.id === this.firingPointerId && p.isDown);
    if (this.firingPointerId !== null && !firing) this.firingPointerId = null;
    const mover = pointers.find((p) => p && p.id === this.movePointerId && p.isDown);
    if (this.movePointerId !== null && !mover) this.releaseJoystick();

    // 瞄準：開火中的手指優先；滑鼠則永遠跟著游標。
    // 鏡頭會捲動，所以每幀用畫面座標重新換算世界座標（pointer.worldX 只在游標移動時更新）
    // 只按著搖桿、沒在開火時，維持上一次的瞄準點
    const active = this.scene.input.activePointer;
    const aimPointer = firing ?? (active.id === this.movePointerId ? null : active);
    const aimScreen = aimPointer ?? this.tapQueued;
    if (aimScreen) {
      const world = this.scene.cameras.main.getWorldPoint(aimScreen.x, aimScreen.y);
      s.aimX = world.x;
      s.aimY = world.y;
    }

    // 移動：鍵盤 WASD／方向鍵，或觸控搖桿
    const k = this.keys;
    let mx = 0;
    let my = 0;
    if (k) {
      mx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
      my = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    }
    if (mover) {
      const ml = toLogical(mover.x, mover.y);
      const dx = ml.x - joystick.baseX;
      const dy = ml.y - joystick.baseY;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, JOYSTICK_RADIUS);
      const nx = len > 0 ? dx / len : 0;
      const ny = len > 0 ? dy / len : 0;
      joystick.knobX = joystick.baseX + nx * clamped;
      joystick.knobY = joystick.baseY + ny * clamped;
      // 小小的死區，避免手指一放上去就飄
      if (len > 4) {
        mx = nx * (clamped / JOYSTICK_RADIUS);
        my = ny * (clamped / JOYSTICK_RADIUS);
      }
    }
    s.moveX = mx;
    s.moveY = my;

    s.fireHeld = !!firing;
    s.firePressed = (s.fireHeld && !this.wasFiring) || this.tapQueued !== null;
    this.tapQueued = null;
    this.wasFiring = s.fireHeld;

    const jd = Phaser.Input.Keyboard.JustDown;
    s.reloadPressed = (k ? jd(k.reload) : false) || queued.reload;
    s.nextWeapon = (k ? jd(k.swap) : false) || queued.next;
    s.selectWeapon = k && jd(k.one) ? 0 : k && jd(k.two) ? 1 : k && jd(k.three) ? 2 : -1;
    s.meleePressed = (k ? jd(k.melee) || jd(k.melee2) : false) || queued.melee;
    const rightHeld = !active.wasTouch && active.rightButtonDown() && !isPointerOverUI(active);
    s.meleeHeld = (k ? k.melee.isDown || k.melee2.isDown : false) || rightHeld || held.melee;
    s.toggleMelee = (k ? jd(k.four) || jd(k.stance) : false) || queued.stance;
    queued.reload = false;
    queued.next = false;
    queued.melee = false;
    queued.stance = false;
    return s;
  }
}
