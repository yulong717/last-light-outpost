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
  },
];

/** 爆頭傷害倍率 */
export const HEADSHOT_MULTIPLIER = 2.5;
