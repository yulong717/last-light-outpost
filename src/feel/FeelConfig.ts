/**
 * 手感數值集中在這裡：射擊、移動、受擊的回饋強度。調手感只改這個檔案。
 * 每把武器自己的後座力、散射在 src/data/weapons.ts。
 */
export const FEEL = {
  move: {
    /** 左右／前後最高速度（像素 / 秒）；前後較慢，做出縱深感 */
    speedX: 78,
    speedY: 54,
    /** 起步與煞車的快慢（越大越跟手）；煞車比起步快一點，停得乾脆 */
    accel: 16,
    decel: 22,
    /** 倒退走（移動方向與瞄準方向相反）的速度倍率 */
    backpedal: 0.85,
    /** 走路時身體往前傾的角度（度） */
    lean: 3,
    /** 每秒幾步（腳步揚塵、腳步聲） */
    stepsPerSecond: 4.4,
  },
  aim: {
    /** 移動中的額外散射倍率（乘上每把武器的 moveSpread）：輕度代價 */
    movePenalty: 1,
  },
  camera: {
    /** 震動最大位移（像素），實際位移 = max × trauma² */
    maxShake: 6,
    /** trauma 每秒消退量 */
    traumaDecay: 1.8,
    /** 開槍鏡頭後頓的回彈速度 */
    kickReturn: 18,
  },
  hurt: {
    /** 被打後的無敵時間（秒），期間角色閃爍 */
    iframes: 0.55,
    /** 被打退的初速度（像素 / 秒） */
    knockback: 150,
    /** 被打時的卡肉（毫秒） */
    hitStop: 45,
    trauma: 0.5,
    /** 低於這個比例算低血量：畫面紅邊跟著心跳 */
    lowHpRatio: 0.3,
  },
  /** 手機震動與手把震動 */
  haptics: true,
} as const;
