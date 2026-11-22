import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { GameEvents } from '../systems/GameEvents';
import { AudioManager } from './AudioManager';

/**
 * 把遊戲事件翻譯成聲音。掛在戰鬥場景上：
 *   attachAudio(this)   // DefenseScene.create()
 * 場景關閉時匯流排會自動清空訂閱。用鏡頭位置算左右聲道與距離衰減。
 *
 * 新增武器時：在 SfxBank 加一個 `shot_<武器id>` 配方就會自動使用；
 * 沒有的話用 WEAPON_FALLBACK 對應的聲音。
 */
const WEAPON_FALLBACK: Record<string, string> = { pistol: 'shot_pistol', shotgun: 'shot_shotgun' };
/** 用「泵動」換彈的武器（其他用彈匣） */
const PUMP_WEAPONS = new Set(['shotgun']);

export function attachAudio(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  let alive = 0;

  /** 世界 x → 左右聲道；畫面外的聲音偏到最邊並變小聲 */
  const spatial = (x?: number) => {
    if (x === undefined) return { pan: 0, volume: 1 };
    const rel = (x - (cam.scrollX + GAME_WIDTH / 2)) / (GAME_WIDTH / 2);
    const off = Math.max(0, Math.abs(rel) - 1);
    return { pan: Phaser.Math.Clamp(rel * 0.75, -0.9, 0.9), volume: 1 / (1 + off * 1.5) };
  };
  const play = (name: string, x?: number, extra: { volume?: number; semitones?: number; delay?: number } = {}) => {
    const s = spatial(x);
    AudioManager.play(name, { pan: s.pan, volume: s.volume * (extra.volume ?? 1), semitones: extra.semitones, delay: extra.delay });
  };
  /** 大型霧屍聲音低一點 */
  const kindPitch = (kind: string) => (kind === 'brute' ? -5 : kind === 'runner' ? 3 : 0);
  const shotName = (id: string) => (AudioManager.has(`shot_${id}`) ? `shot_${id}` : (WEAPON_FALLBACK[id] ?? 'shot_pistol'));

  const updateIntensity = () => AudioManager.setIntensity(Math.min(1, alive / 8));

  const bus = GameEvents.of(scene);
  bus
    .on('player:shoot', (e) => {
      play(shotName(e.weaponId), e.x);
      if (PUMP_WEAPONS.has(e.weaponId)) {
        // 霰彈槍：開完槍拉一下泵動，彈殼才掉出來（彈匣打空時改在換彈結束才拉）
        if (e.ammoLeft > 0) {
          play('pump', e.x, { delay: 0.32, volume: 0.7 });
          play('shell_drop', e.x, { delay: 0.62, semitones: -4 });
        }
      } else {
        // 彈殼落地：拋殼後約 0.3 秒
        play('shell_drop', e.x, { delay: 0.3 + Math.random() * 0.12 });
      }
    })
    .on('player:dryfire', () => play('dry_fire'))
    .on('player:reload-start', (e) => {
      if (PUMP_WEAPONS.has(e.weaponId)) {
        // 一顆一顆塞子彈的節奏，平均分配在換彈時間裡
        const n = 3;
        for (let i = 0; i < n; i++) play('shell_insert', undefined, { delay: (e.duration * (i + 0.6)) / (n + 0.6) - 0.15 });
      } else play('reload_out');
    })
    .on('player:reload-end', (e) => {
      if (PUMP_WEAPONS.has(e.weaponId)) {
        play('pump');
        play('shell_drop', undefined, { delay: 0.35, volume: 0.8, semitones: -4 });
      } else play('reload_in');
    })
    .on('player:weapon-switch', () => play('weapon_switch'))
    .on('player:step', (e) => play('footstep', e.x, { volume: 0.5 + 0.5 * e.speed, semitones: e.foot ? 0.7 : -0.7 }))
    .on('player:hurt', () => play('player_hurt'))
    .on('player:heartbeat', () => play('heartbeat'))
    .on('player:death', (e) => play('player_death', e.x))
    .on('enemy:spawn', () => {
      alive++;
      updateIntensity();
    })
    .on('enemy:groan', (e) => play('zombie_groan', e.x, { semitones: kindPitch(e.enemyId), volume: 0.8 }))
    .on('enemy:attack', (e) => play('zombie_attack', e.x, { semitones: kindPitch(e.enemyId) }))
    .on('enemy:hit', (e) => {
      play('flesh_hit', e.x);
      if (e.headshot) play('headshot', e.x, { volume: e.killed ? 1 : 0.7 });
    })
    .on('enemy:death', (e) => {
      alive = Math.max(0, alive - 1);
      updateIntensity();
      play('zombie_death', e.x, { semitones: kindPitch(e.enemyId) });
    })
    .on('barricade:hit', (e) => play('barricade_hit', e.x))
    .on('barricade:break', (e) => play('barricade_break', e.x))
    .on('base:hit', (e) => play('base_hit', e.x))
    .on('wave:start', () => play('wave_horn'))
    .on('game:over', (e) => {
      AudioManager.setMood('off');
      play(e.survived ? 'stinger_win' : 'stinger_lose', undefined, { delay: 0.3 });
    });

  AudioManager.setIntensity(0);
  AudioManager.setMood('night');
}
