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
}

export const ENEMIES: Record<string, EnemyDef> = {
  basic: {
    id: 'basic',
    name: '霧屍',
    hp: 30,
    speed: 14,
    damage: 5,
    attackInterval: 1.0,
    width: 14,
    height: 24,
    color: PLACEHOLDER_COLORS.zombieBasic,
    texture: 'zombie_basic',
  },
  runner: {
    id: 'runner',
    name: '疾行霧屍',
    hp: 18,
    speed: 34,
    damage: 3,
    attackInterval: 0.6,
    width: 12,
    height: 22,
    color: PLACEHOLDER_COLORS.zombieRunner,
    texture: 'zombie_runner',
  },
  brute: {
    id: 'brute',
    name: '腫脹霧屍',
    hp: 140,
    speed: 8,
    damage: 15,
    attackInterval: 1.6,
    width: 22,
    height: 32,
    color: PLACEHOLDER_COLORS.zombieBrute,
    texture: 'zombie_brute',
  },
};
