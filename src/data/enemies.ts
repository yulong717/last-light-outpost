import { PLACEHOLDER_COLORS } from '../config';

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  /** 移動速度（像素 / 秒） */
  speed: number;
  /** 每次攻擊傷害 */
  damage: number;
  /** 攻擊間隔（秒） */
  attackInterval: number;
  /** 佔位圖尺寸 */
  width: number;
  height: number;
  color: number;
  /** 貼圖 key，換成像素圖時沿用同一個名字 */
  texture: string;
  /** 共用貼圖時用色調與縮放做出差異（暫時做法，之後各自有圖） */
  tint?: number;
  scale?: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
  basic: {
    id: 'basic',
    name: '霧屍',
    hp: 30,
    speed: 18,
    damage: 5,
    attackInterval: 1.0,
    width: 20,
    height: 44,
    color: PLACEHOLDER_COLORS.zombieBasic,
    texture: 'zombie_basic',
  },
  runner: {
    id: 'runner',
    name: '疾行霧屍',
    hp: 18,
    speed: 44,
    damage: 3,
    attackInterval: 0.6,
    width: 18,
    height: 40,
    color: PLACEHOLDER_COLORS.zombieRunner,
    texture: 'zombie_basic',
    tint: 0xffc48a,
    scale: 0.9,
  },
  brute: {
    id: 'brute',
    name: '腫脹霧屍',
    hp: 140,
    speed: 10,
    damage: 15,
    attackInterval: 1.6,
    width: 32,
    height: 56,
    color: PLACEHOLDER_COLORS.zombieBrute,
    texture: 'zombie_basic',
    tint: 0xd2b4ff,
    scale: 1.3,
  },
};
