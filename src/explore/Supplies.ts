import Phaser from 'phaser';
import { AudioManager } from '../audio/AudioManager';
import { MEDKIT_HEAL } from '../data/explore';
import type { Player } from '../entities/Player';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';

/**
 * 輔助用品在戰鬥中的效果（夜晚防守與探索戰鬥共用）。
 */

/** 用醫療包；回傳補了多少血 */
export function useMedkit(scene: Phaser.Scene, player: Player): number {
  if (!player.alive || player.hp >= player.maxHp || !GameState.useSupply('medkit')) return 0;
  const n = player.heal(MEDKIT_HEAL);
  Fx.of(scene)?.popText(player.footX, player.footY - 60, `+${n}`, '#9ad17a');
  AudioManager.play('ui_confirm', { semitones: 5 });
  return n;
}
