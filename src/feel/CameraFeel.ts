import Phaser from 'phaser';
import { FEEL } from './FeelConfig';

const registry = new WeakMap<Phaser.Scene, CameraFeel>();

/**
 * 鏡頭手感：
 * - trauma 震動：每次衝擊累加 trauma（0..1），位移 = 最大值 × trauma²，用平滑雜訊而不是每幀亂跳，
 *   小衝擊幾乎感覺不到、大衝擊很猛，連續被打也不會無限疊加。
 * - kick：開槍時鏡頭往槍口反方向頓一下再彈回，表現後座力。
 *
 * 位移在鏡頭算完跟隨之後才疊上去（和 Phaser 內建 shake 同一個時間點），不會干擾鏡頭跟隨。
 * 用真實時間計算，卡肉（hit-stop）時鏡頭照樣在震。
 */
export class CameraFeel {
  private trauma = 0;
  private kickX = 0;
  private kickY = 0;
  private t = Math.random() * 100;
  private offX = 0;
  private offY = 0;
  private zoomK = 1;
  private zoomUntil = 0;
  private zoomMs = 1;
  private zoomPeak = 1;
  private scene: Phaser.Scene;

  static attach(scene: Phaser.Scene): CameraFeel {
    const feel = new CameraFeel(scene);
    registry.set(scene, feel);
    return feel;
  }

  static of(scene: Phaser.Scene): CameraFeel | undefined {
    return registry.get(scene);
  }

  private constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const cam = scene.cameras.main;
    const original = cam.preRender.bind(cam);
    cam.preRender = () => {
      original();
      const m = (cam as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix;
      if (this.zoomK !== 1) {
        // 以畫面中心放大（重擊時鏡頭往前衝一下）
        // 矩陣這一段已經乘過鏡頭縮放（高解析度渲染），畫面中心要換回未縮放的單位
        const ox = (cam.width * cam.originX) / cam.zoom;
        const oy = (cam.height * cam.originY) / cam.zoom;
        m.translate(ox, oy);
        m.scale(this.zoomK, this.zoomK);
        m.translate(-ox, -oy);
      }
      // matrix 沒有寫在型別定義裡，但內建 shake 也是這樣疊位移
      if (this.offX !== 0 || this.offY !== 0) (cam as unknown as { matrix: Phaser.GameObjects.Components.TransformMatrix }).matrix.translate(this.offX, this.offY);
    };
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
      cam.preRender = original;
      registry.delete(scene);
    });
  }

  /** 加一點震動；amount 建議 0.1（小）～ 0.6（很大） */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** 開槍後頓：angle 是射擊方向，鏡頭往反方向推 px 像素 */
  kick(angle: number, px: number): void {
    this.kickX -= Math.cos(angle) * px;
    this.kickY -= Math.sin(angle) * px * 0.5;
  }

  /** 重擊推鏡：瞬間放大到 peak，ms 毫秒內彈回（真實時間，卡肉時也在動） */
  punch(peak: number, ms: number): void {
    this.zoomPeak = Math.max(peak, this.zoomK);
    this.zoomMs = ms;
    this.zoomUntil = this.scene.game.loop.time + ms;
  }

  private update(_t: number, deltaMs: number): void {
    const left = this.zoomUntil - this.scene.game.loop.time;
    this.zoomK = left > 0 ? 1 + (this.zoomPeak - 1) * (left / this.zoomMs) : 1;
    const dt = Math.min(deltaMs / 1000, 0.05);
    const c = FEEL.camera;
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - c.traumaDecay * dt);
    const back = Math.exp(-c.kickReturn * dt);
    this.kickX *= back;
    this.kickY *= back;
    if (Math.abs(this.kickX) < 0.05) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.05) this.kickY = 0;

    const shake = c.maxShake * this.trauma * this.trauma;
    const sx = shake * noise(this.t * 31, 0);
    const sy = shake * noise(this.t * 31, 7.3);
    // 鏡頭往左移＝畫面內容往右移，所以取負號
    this.offX = -(this.kickX + sx);
    this.offY = -(this.kickY + sy);
  }
}

/** 幾個不同頻率的 sin 疊起來當平滑雜訊，範圍約 -1..1 */
function noise(t: number, seed: number): number {
  return (Math.sin(t + seed) * 0.5 + Math.sin(t * 1.7 + seed * 2.1) * 0.3 + Math.sin(t * 3.1 + seed * 0.7) * 0.2);
}
