export interface WeaponDef {
  id: string;
  name: string;
  /** 每發傷害 */
  damage: number;
  /** 每秒射擊次數 */
  fireRate: number;
  magazine: number;
  /** 換彈秒數 */
  reloadTime: number;
  /** 散布角度（度） */
  spread: number;
  /** 一次射出幾發（霰彈槍 > 1） */
  pellets: number;
  /** 最多穿透幾隻敵人 */
  pierce: number;
  /** 是否按住連射 */
  automatic: boolean;
  /** 擊退距離（像素） */
  knockback: number;
  // ── 手感（見 src/feel/FeelConfig.ts 的全域設定） ──
  /** 每開一槍散射增加幾度（連射越來越散） */
  bloomPerShot: number;
  /** 連射散射的上限（度） */
  bloomMax: number;
  /** 散射每秒收回幾度 */
  bloomRecover: number;
  /** 全速移動時額外的散射（度） */
  moveSpread: number;
  /** 開槍時鏡頭往後頓幾像素 */
  cameraKick: number;
  /** 開槍時鏡頭震動量（trauma，0..1） */
  trauma: number;
  /** 開槍時主角被往後推的速度（像素 / 秒），0 = 不推 */
  selfKnockback: number;
  /** 手機／手把震動毫秒數，0 = 不震 */
  rumbleMs: number;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'pistol',
    name: '手槍',
    damage: 10,
    fireRate: 4,
    magazine: 12,
    reloadTime: 1.0,
    spread: 1.5,
    pellets: 1,
    pierce: 1,
    automatic: false,
    knockback: 2,
    bloomPerShot: 1.2,
    bloomMax: 5,
    bloomRecover: 9,
    moveSpread: 2.5,
    cameraKick: 2,
    trauma: 0.1,
    selfKnockback: 0,
    rumbleMs: 0,
  },
  {
    id: 'shotgun',
    name: '霰彈槍',
    damage: 7,
    fireRate: 1.2,
    magazine: 6,
    reloadTime: 1.8,
    spread: 9,
    pellets: 6,
    pierce: 1,
    automatic: false,
    knockback: 6,
    bloomPerShot: 3,
    bloomMax: 6,
    bloomRecover: 6,
    moveSpread: 3,
    cameraKick: 5,
    trauma: 0.32,
    selfKnockback: 70,
    rumbleMs: 40,
  },
];

/** 爆頭傷害倍率 */
export const HEADSHOT_MULTIPLIER = 2.5;
