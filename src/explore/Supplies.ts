import Phaser from 'phaser';
import { DEPTH_FX, clampLaneY } from '../config';
import { AudioManager } from '../audio/AudioManager';
import { GRENADE, MEDKIT_HEAL } from '../data/explore';
import type { Zombie } from '../entities/Zombie';
import type { Player } from '../entities/Player';
import { CameraFeel } from '../feel/CameraFeel';
import { rumble } from '../feel/Haptics';
import { Fx } from '../fx/Fx';
import { GameState } from '../state/GameState';

/**
 * 輔助用品在戰鬥中的效果（夜晚防守與探索戰鬥共用）。
 */

/** 丟手榴彈：從主角拋向準星，落地後爆炸。回傳是否真的丟出去 */
export function throwGrenade(
  scene: Phaser.Scene,
  player: Player,
  aimX: number,
  aimY: number,
  zombies: () => Zombie[],
  onKill: (n: number) => void,
): boolean {
  if (!player.alive || !GameState.useSupply('grenade')) return false;
  const sx = player.footX + 6 * player.facing;
  const sy = player.footY - 30;
  // 最遠丟 220 像素，落點夾在地面帶
  const dx = Phaser.Math.Clamp(aimX - player.footX, -220, 220);
  const tx = player.footX + dx;
  const ty = clampLaneY(aimY + 30);
  const nade = scene.add.circle(sx, sy, 2.5, 0x4a5a2a).setStrokeStyle(1, 0x111111).setDepth(DEPTH_FX);
  const dur = GRENADE.fuse * 1000;
  const arc = { t: 0 };
  AudioManager.play('swing_light', { semitones: -4 });
  scene.tweens.add({
    targets: arc,
    t: 1,
    duration: dur,
    onUpdate: () => {
      const t = arc.t;
      nade.x = Phaser.Math.Linear(sx, tx, t);
      nade.y = Phaser.Math.Linear(sy, ty, t) - Math.sin(t * Math.PI) * 50;
    },
    onComplete: () => {
      nade.destroy();
      explode(scene, tx, ty, zombies(), onKill);
    },
  });
  return true;
}

function explode(scene: Phaser.Scene, x: number, y: number, zombies: Zombie[], onKill: (n: number) => void): void {
  const r = GRENADE.radius;
  const flash = scene.add.circle(x, y - 6, 6, 0xfff1a0, 0.95).setDepth(DEPTH_FX + 1);
  scene.tweens.add({ targets: flash, radius: r * 0.8, alpha: 0, duration: 220, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
  const ring = scene.add.ellipse(x, y, 8, 4).setStrokeStyle(2, 0xff9a4a, 0.9).setDepth(DEPTH_FX);
  scene.tweens.add({ targets: ring, width: r * 2, height: r, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
  const fx = Fx.of(scene);
  fx?.dust(x, y, 14);
  fx?.muzzleLight(x, y - 10, 3);
  fx?.stain(x, y, 1.6);
  CameraFeel.of(scene)?.addTrauma(0.55);
  rumble(160, 0.9);
  AudioManager.play('barricade_break', { semitones: -10, volume: 1 });
  AudioManager.play('shot_shotgun', { semitones: -8, volume: 0.9 });
  let kills = 0;
  for (const z of zombies) {
    if (z.dead || !z.active) continue;
    const d = Math.hypot(z.footX - x, (z.footY - y) * 1.6);
    if (d > r) continue;
    const dmg = GRENADE.damage * (1 - (d / r) * 0.5);
    if (z.takeDamage(dmg, 14, { dirX: Math.sign(z.footX - x) || 1, type: 'blast' })) kills++;
  }
  if (kills) onKill(kills);
}

/** 用醫療包；回傳補了多少血 */
export function useMedkit(scene: Phaser.Scene, player: Player): number {
  if (!player.alive || player.hp >= player.maxHp || !GameState.useSupply('medkit')) return 0;
  const n = player.heal(MEDKIT_HEAL);
  Fx.of(scene)?.popText(player.footX, player.footY - 60, `+${n}`, '#9ad17a');
  AudioManager.play('ui_confirm', { semitones: 5 });
  return n;
}
