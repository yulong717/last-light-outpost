import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';

/**
 * 高解析度渲染：畫布用「邏輯解析度 × RENDER_SCALE」的實際像素繪製，
 * 每個場景的主鏡頭再放大 RENDER_SCALE 倍。
 *
 * - 遊戲邏輯、座標、版面照舊用 640×360 撰寫，完全不用改。
 * - 像素圖以整數倍、最近鄰放大，所以仍是銳利的像素風。
 * - 文字以 RENDER_SCALE 倍解析度繪製，筆畫細節不再被壓成 640×360 的格子，中文才看得清楚。
 */

const MAX_SCALE = 4;
/**
 * 手機（觸控為主）最多 3 倍：4 倍時畫布是 2560×1440，比多數手機螢幕的實際像素還多，
 * 每幀都在填用不到的像素，打擊特效一多就掉幀。3 倍在手機螢幕上看起來沒有差別。
 */
const MAX_SCALE_TOUCH = 3;

function pickScale(): number {
  if (typeof window === 'undefined') return 2;
  const dpr = window.devicePixelRatio || 1;
  // 用螢幕較長邊估計：視窗之後被拉大也不會糊掉
  const w = Math.max(window.innerWidth, window.screen?.width ?? 0, window.screen?.height ?? 0) * dpr;
  const h = Math.max(window.innerHeight, Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)) * dpr;
  const fit = Math.min(w / GAME_WIDTH, h / GAME_HEIGHT);
  const touch = window.matchMedia?.('(pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) > 0;
  return Phaser.Math.Clamp(Math.ceil(fit - 0.05), 2, touch ? MAX_SCALE_TOUCH : MAX_SCALE);
}

/** 畫布實際像素對邏輯像素的整數倍率（2～4）。 */
export const RENDER_SCALE = pickScale();

/** 畫面（指標）座標 → 640×360 邏輯座標。pointer.x/y 是畫布像素，UI 判斷要先換算。 */
export function toLogical(x: number, y: number): { x: number; y: number } {
  return { x: x / RENDER_SCALE, y: y / RENDER_SCALE };
}

type HiResCamera = Phaser.Cameras.Scene2D.Camera & { __hiRes?: true };
type CamMatrix = { matrix: Phaser.GameObjects.Components.TransformMatrix };

/**
 * 讓鏡頭以「左上角」為縮放中心放大 RENDER_SCALE 倍，並維持 scrollX/scrollY 的原本意義
 * （= 畫面左上角的世界座標）。Phaser 內建的縮放以畫面中心為準，會讓 scrollFactor ≠ 1 的
 * 物件（天空、視差背景、HUD）跑位；這裡讓 Phaser 照常計算跟隨、邊界、死區，
 * 最後再把結果換算回左上角版本，所有物件位置都與 1 倍時完全一致，只是更清晰。
 */
export function applyHiRes(cam: Phaser.Cameras.Scene2D.Camera): void {
  const c = cam as HiResCamera;
  if (c.__hiRes) return;
  c.__hiRes = true;
  cam.setZoom(RENDER_SCALE);

  // Phaser 版的 scroll（以中心縮放）＝ 對外的 scroll（左上角）－ shift
  // 倍率每幀讀 cam.zoom：單軸模式會再拉近（setViewZoom），一樣以左上角為縮放中心
  const shiftX = () => (cam.width / 2) * (1 - 1 / cam.zoom);
  const shiftY = () => (cam.height / 2) * (1 - 1 / cam.zoom);
  let innerX = cam.scrollX - shiftX();
  let innerY = cam.scrollY - shiftY();
  let outerX = cam.scrollX;
  let outerY = cam.scrollY;

  const original = cam.preRender.bind(cam);
  cam.preRender = () => {
    // 外部若用 Phaser API（centerOn、setScroll…）改過 scroll，那個值就是 Phaser 版本，直接沿用
    if (cam.scrollX === outerX) cam.scrollX = innerX;
    if (cam.scrollY === outerY) cam.scrollY = innerY;
    original();
    innerX = cam.scrollX;
    innerY = cam.scrollY;
    outerX = cam.scrollX = innerX + shiftX();
    outerY = cam.scrollY = innerY + shiftY();
    // 原本的矩陣是 T(origin)·S(z)·T(-origin)·震動；改成 S(z)·震動（以左上角為縮放中心）
    const m = (cam as unknown as CamMatrix).matrix;
    m.e += (cam.width / 2) * (cam.zoom - 1);
    m.f += (cam.height / 2) * (cam.zoom - 1);
  };
}

/**
 * 鏡頭再拉近 k 倍（1 = 原本的 640×360 視野）。看到的世界範圍變成 640/k × 360/k，
 * scrollX/scrollY 仍是畫面左上角的世界座標。HUD 要另外放在沒有拉近的鏡頭上。
 */
export function setViewZoom(cam: Phaser.Cameras.Scene2D.Camera, k: number): void {
  cam.setZoom(RENDER_SCALE * k);
}

/**
 * 全域場景外掛：每個場景啟動時（鏡頭剛建好、create() 之前）自動套用高解析度鏡頭。
 * 之後新增的場景不需要做任何事。
 */
export class HiResPlugin extends Phaser.Plugins.ScenePlugin {
  boot(): void {
    this.systems?.events.on(Phaser.Scenes.Events.START, this.onStart, this);
  }

  private onStart(): void {
    const cams = this.systems?.cameras;
    cams?.cameras.forEach((cam) => applyHiRes(cam));
  }
}

/**
 * 畫布在瀏覽器中被縮放時的插值方式：
 * 畫布比顯示區大（縮小顯示）用平滑縮放，文字邊緣才不會缺像素；
 * 畫布比顯示區小（放大顯示）才用最近鄰，保持像素感。
 */
export function syncCanvasSmoothing(game: Phaser.Game): void {
  const update = () => {
    const canvas = game.canvas;
    if (!canvas) return;
    const shown = canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1);
    canvas.style.imageRendering = shown < canvas.width ? 'auto' : 'pixelated';
  };
  game.scale.on(Phaser.Scale.Events.RESIZE, update);
  window.addEventListener('resize', () => requestAnimationFrame(update));
  game.events.once(Phaser.Core.Events.READY, update);
}
