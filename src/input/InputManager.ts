import Phaser from 'phaser';

/**
 * 動作抽象層：遊戲邏輯只問「要不要開槍、瞄哪裡、要不要換彈」，
 * 不直接碰鍵盤、滑鼠或觸控。之後加手把或虛擬搖桿只要改這裡。
 */
export interface InputState {
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
}

type Rect = { x: number; y: number; w: number; h: number };

/** UI 按鈕所在的區域，點在這些區域不會觸發開火。 */
const uiRects = new Set<Rect>();

export function registerUIRect(rect: Rect): () => void {
  uiRects.add(rect);
  return () => uiRects.delete(rect);
}

function isOverUI(x: number, y: number): boolean {
  for (const r of uiRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
}

/** 讓 UI 按鈕（換彈、換槍）也能送出動作。 */
const queued = { reload: false, next: false };
export function queueAction(action: 'reload' | 'next'): void {
  queued[action] = true;
}

export class InputManager {
  private scene: Phaser.Scene;
  private keys: Record<'reload' | 'one' | 'two' | 'swap', Phaser.Input.Keyboard.Key> | null = null;
  private wasFiring = false;
  private firingPointerId: number | null = null;

  readonly state: InputState = {
    aimX: 0,
    aimY: 0,
    fireHeld: false,
    firePressed: false,
    reloadPressed: false,
    selectWeapon: -1,
    nextWeapon: false,
  };

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = {
        reload: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
        one: kb.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
        two: kb.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
        swap: kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      };
    }
    // 右鍵不要跳出瀏覽器選單
    scene.input.mouse?.disableContextMenu();

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.firingPointerId === null && !isOverUI(p.x, p.y)) this.firingPointerId = p.id;
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.firingPointerId) this.firingPointerId = null;
    });
  }

  update(): InputState {
    const s = this.state;
    const pointers = [this.scene.input.activePointer, ...this.scene.input.manager.pointers];
    const firing = pointers.find((p) => p && p.id === this.firingPointerId && p.isDown);
    if (this.firingPointerId !== null && !firing) this.firingPointerId = null;

    // 瞄準：開火中的手指優先；滑鼠則永遠跟著游標
    const aimPointer = firing ?? this.scene.input.activePointer;
    s.aimX = aimPointer.worldX;
    s.aimY = aimPointer.worldY;

    s.fireHeld = !!firing;
    s.firePressed = s.fireHeld && !this.wasFiring;
    this.wasFiring = s.fireHeld;

    const k = this.keys;
    const jd = Phaser.Input.Keyboard.JustDown;
    s.reloadPressed = (k ? jd(k.reload) : false) || queued.reload;
    s.nextWeapon = (k ? jd(k.swap) : false) || queued.next;
    s.selectWeapon = k && jd(k.one) ? 0 : k && jd(k.two) ? 1 : -1;
    queued.reload = false;
    queued.next = false;
    return s;
  }
}
