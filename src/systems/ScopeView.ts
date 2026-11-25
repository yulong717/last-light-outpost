import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { RENDER_SCALE, UI_DEPTH, toLogical } from '../render/RenderScale';
import { pixelText } from '../utils/text';
import { AudioManager } from '../audio/AudioManager';
import type { WeaponSystem } from './WeaponSystem';

/** 開鏡：鏡頭多快追到游標指的地方、游標在畫面中間多少範圍內不平移 */
const SCOPE = { follow: 7, deadzone: 0.12, ring: 54 };

/**
 * 巴雷特的狙擊鏡：按 Z（觸控「瞄準」鍵）開鏡。
 *
 * 開鏡時鏡頭不再跟著主角，改成跟著游標平移：游標推到畫面右緣，鏡頭一路看到戰場最右邊，
 * 畫面外還沒走過來的霧屍也看得到、打得到（巴雷特射程涵蓋整張地圖）。
 * 畫面四周變暗、只留準星一圈，散射幾乎歸零（WeaponSystem.scoped）。
 * 換槍、切近戰、主角倒下會自動關鏡，鏡頭滑回主角身上。
 */
export class ScopeView {
  active = false;
  /** 鏡頭中心目前在哪（世界 x）；開鏡時從主角位置開始滑 */
  private centerX = 0;
  private savedLerp: { x: number; y: number } | null = null;
  private overlay: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;

  constructor(
    private scene: Phaser.Scene,
    private weapons: WeaponSystem,
  ) {
    this.overlay = scene.add.graphics().setScrollFactor(0).setDepth(UI_DEPTH).setVisible(false);
    this.label = pixelText(scene, GAME_WIDTH / 2, GAME_HEIGHT - 22, '', 8, '#ffd180').setOrigin(0.5, 0).setScrollFactor(0).setDepth(UI_DEPTH + 1).setStroke('#000000', 3).setVisible(false);
    this.label.setText(scene.sys.game.device.input.touch ? '開鏡中：準星推到畫面邊緣看遠方' : '開鏡中：游標推到畫面邊緣看遠方　Z 關鏡');
  }

  /** 視野寬度（世界座標）：單軸據點鏡頭有拉近 */
  private viewW(cam: Phaser.Cameras.Scene2D.Camera): number {
    return (GAME_WIDTH * RENDER_SCALE) / cam.zoom;
  }

  /**
   * 每幀呼叫。toggle：這一幀按了開／關鏡；allowed：現在能不能開鏡（拿槍、活著、沒在揮刀）。
   * aimX/aimY 是世界座標的準星位置。
   */
  update(dt: number, toggle: boolean, allowed: boolean, playerX: number, aimX: number, aimY: number): void {
    const has = !!this.weapons.active.def.scope && allowed;
    if (toggle && has) {
      this.active = !this.active;
      AudioManager.ui(this.active ? 'tap' : 'back');
    }
    if (!has) this.active = false;
    this.weapons.scoped = this.active;
    const cam = this.scene.cameras.main;
    if (!this.active) {
      if (this.savedLerp) {
        // 關鏡：恢復跟隨，鏡頭照原本的速度滑回主角
        cam.setLerp(this.savedLerp.x, this.savedLerp.y);
        this.savedLerp = null;
      }
      this.overlay.setVisible(false);
      this.label.setVisible(false);
      return;
    }
    const vw = this.viewW(cam);
    if (!this.savedLerp) {
      this.savedLerp = { x: cam.lerp.x, y: cam.lerp.y };
      // 跟隨還開著但不再水平移動，鏡頭交給這裡
      cam.setLerp(0, cam.lerp.y);
      this.centerX = cam.scrollX + vw / 2;
    }
    // 準星在畫面上的位置（邏輯座標）：滑鼠直接讀游標，觸控用準星的世界座標換算
    const zoom = cam.zoom / RENDER_SCALE;
    const p = this.scene.input.activePointer;
    const screen = !p.wasTouch ? toLogical(p.x, p.y) : { x: (aimX - cam.scrollX) * zoom, y: (aimY - cam.scrollY) * zoom };
    let nx = Phaser.Math.Clamp((screen.x - GAME_WIDTH / 2) / (GAME_WIDTH / 2), -1, 1);
    nx = Math.sign(nx) * Math.max(0, Math.abs(nx) - SCOPE.deadzone) / (1 - SCOPE.deadzone);
    const b = cam.getBounds();
    // 游標推到邊緣 = 看到戰場那一頭的盡頭
    const reach = Math.max(0, b.width - vw);
    const target = Phaser.Math.Clamp(playerX + nx * reach, b.x + vw / 2, b.right - vw / 2);
    this.centerX += (target - this.centerX) * (1 - Math.exp(-SCOPE.follow * dt));
    cam.centerOnX(this.centerX);

    // 鏡片：四周壓暗、只留準星一圈；十字線與刻度
    const cx = Phaser.Math.Clamp(screen.x, 0, GAME_WIDTH);
    const cy = Phaser.Math.Clamp(screen.y, 0, GAME_HEIGHT);
    const r = SCOPE.ring;
    const g = this.overlay.clear().setVisible(true);
    const thick = 1400;
    g.lineStyle(thick, 0x000000, 0.5).strokeCircle(cx, cy, r + thick / 2);
    g.lineStyle(2, 0x0a0a0a, 0.9).strokeCircle(cx, cy, r);
    g.lineStyle(1, 0x000000, 0.75);
    g.lineBetween(cx - r, cy, cx - 6, cy);
    g.lineBetween(cx + 6, cy, cx + r, cy);
    g.lineBetween(cx, cy - r, cx, cy - 6);
    g.lineBetween(cx, cy + 6, cx, cy + r);
    for (let i = 1; i <= 3; i++) {
      g.lineBetween(cx - 2, cy + i * 10, cx + 2, cy + i * 10);
      g.lineBetween(cx + i * 10, cy - 2, cx + i * 10, cy + 2);
      g.lineBetween(cx - i * 10, cy - 2, cx - i * 10, cy + 2);
    }
    g.fillStyle(0xff3b3b, 0.9).fillRect(cx - 1, cy - 1, 2, 2);
    // 鏡頭看到主角以外的地方：畫面邊緣一個小箭頭指回主角
    const px = (playerX - cam.scrollX) * zoom;
    if (px < 0 || px > GAME_WIDTH) {
      const ax = px < 0 ? 10 : GAME_WIDTH - 10;
      const d = px < 0 ? -1 : 1;
      g.fillStyle(0xffd180, 0.9).fillTriangle(ax + d * 6, GAME_HEIGHT - 60, ax - d * 2, GAME_HEIGHT - 66, ax - d * 2, GAME_HEIGHT - 54);
    }
    this.label.setVisible(true);
  }
}
