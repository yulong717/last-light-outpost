/**
 * 穩健的手機直／橫向偵測。
 *
 * 舊做法只聽 Phaser 的 ORIENTATION_CHANGE，並在當下讀 window.innerWidth/innerHeight。
 * 問題：iOS Safari 與部分 Android Chrome 觸發 orientationchange 時，innerWidth/Height
 * 還是旋轉前的值（要等下一次 resize 才更新），所以轉成橫向時讀到的仍是「直向」，
 * 提示不會消失；而 Phaser 認為方向已切換過，不會再發一次事件，
 * 直到使用者轉回直向再轉一次才被「補」到正確狀態。
 *
 * 新做法：
 * 1. 以 matchMedia('(orientation: portrait)') 為主要依據（瀏覽器在版面更新後才改變結果），
 *    退而求其次才比較 innerWidth/innerHeight。
 * 2. 同時監聽 matchMedia change、resize、orientationchange、screen.orientation change、
 *    visualViewport resize，任何一個觸發都重新判斷。
 * 3. 旋轉動畫期間尺寸會晚到，觸發後再於 rAF 與 100/300/700ms 補查幾次。
 * 4. 只在結果真的改變時通知。
 */
export function isPortraitNow(): boolean {
  if (typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(orientation: portrait)');
    if (mq.media !== 'not all') return mq.matches;
  }
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  return h > w;
}

export function watchOrientation(onChange: (portrait: boolean) => void): () => void {
  let last = isPortraitNow();
  let timers: number[] = [];
  let raf = 0;

  const check = (): void => {
    const now = isPortraitNow();
    if (now !== last) {
      last = now;
      onChange(now);
    }
  };

  const schedule = (): void => {
    check();
    timers.forEach((t) => window.clearTimeout(t));
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(check);
    timers = [100, 300, 700].map((ms) => window.setTimeout(check, ms));
  };

  const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null;
  const so = window.screen?.orientation;
  const vv = window.visualViewport;

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', schedule);
    else mq.addListener?.(schedule); // 舊版 iOS Safari (<14)
  }
  so?.addEventListener?.('change', schedule);
  vv?.addEventListener('resize', schedule);

  return () => {
    timers.forEach((t) => window.clearTimeout(t));
    if (raf) window.cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    if (mq) {
      if (mq.removeEventListener) mq.removeEventListener('change', schedule);
      else mq.removeListener?.(schedule);
    }
    so?.removeEventListener?.('change', schedule);
    vv?.removeEventListener('resize', schedule);
  };
}
