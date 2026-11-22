import { FEEL } from './FeelConfig';

type RumblePad = Gamepad & {
  vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<unknown> };
};

/**
 * 觸覺回饋：手機用 navigator.vibrate，手把用 Gamepad 的 dual-rumble。
 * 不支援的裝置（iOS Safari、桌機沒接手把）就什麼都不做。
 *
 * @param ms 震動長度
 * @param strength 0..1，手把的強度；手機只有開／關
 */
export function rumble(ms: number, strength = 0.5): void {
  if (!FEEL.haptics) return;
  try {
    const pads = navigator.getGamepads?.() ?? [];
    let padRumbled = false;
    for (const p of pads as (RumblePad | null)[]) {
      const act = p?.vibrationActuator;
      if (act?.playEffect) {
        act
          .playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.4) })
          .catch(() => undefined);
        padRumbled = true;
      }
    }
    // 只有觸控裝置才用 vibrate，避免桌機瀏覽器報警告
    if (!padRumbled && 'ontouchstart' in window && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
  } catch {
    // 有些瀏覽器在沒有使用者互動前呼叫會丟錯，忽略即可
  }
}
