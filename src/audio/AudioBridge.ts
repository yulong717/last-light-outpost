import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { GameEvents } from '../systems/GameEvents';
import { getFirearm } from '../data/weapons';
import { AudioManager } from './AudioManager';

/**
 * 把遊戲事件翻譯成聲音。掛在戰鬥場景上：
 *   attachAudio(this)   // DefenseScene.create()
 * 場景關閉時匯流排會自動清空訂閱。用鏡頭位置算左右聲道與距離衰減。
 *
 * 新增武器時：在 src/data/weapons.ts 的 sound 欄位填 SfxBank 的配方名；
 * 換彈聲依武器的裝填方式（換彈匣／一顆顆塞／左輪／雙管／彈鏈）自動挑。
 */

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
  // 霧屍職業的嗓音高低（職業列表見 src/data/zombies.ts）
  const KIND_PITCH: Record<string, number> = { brute: -5, runner: 3, nurse: 2, firefighter: -2, soldier: -2, prisoner: -1 };
  const kindPitch = (kind: string) => KIND_PITCH[kind] ?? 0;
  const shotName = (id: string) => {
    const snd = getFirearm(id)?.sound;
    return snd && AudioManager.has(snd) ? snd : 'shot_pistol';
  };
  /** 一次裝滿的武器各自的開／合聲 */
  const wholeSounds = (id: string): [string, string] => {
    const d = getFirearm(id);
    if (d?.cls === 'revolver') return ['revolver_out', 'revolver_in'];
    if (d?.cls === 'lmg') return ['belt_open', 'belt_close'];
    return ['break_open', 'break_close'];
  };

  const updateIntensity = () => AudioManager.setIntensity(Math.min(1, alive / 8));

  const bus = GameEvents.of(scene);
  bus
    .on('player:shoot', (e) => {
      play(shotName(e.weaponId), e.x);
      const d = getFirearm(e.weaponId);
      // 泵動／栓動的彈殼在上膛時才掉（player:cycle）；左輪、雙管換彈時才退殼
      if (!d || d.cycleSound || (d.reload === 'whole' && d.cls !== 'lmg')) return;
      play('shell_drop', e.x, { delay: 0.3 + Math.random() * 0.12 });
    })
    .on('player:cycle', (e) => {
      play(e.kind === 'bolt' ? 'bolt' : 'pump', e.x, { delay: e.delay, volume: 0.75 });
      play('shell_drop', e.x, { delay: e.delay + 0.3, semitones: e.kind === 'pump' ? -4 : 0 });
    })
    .on('player:dryfire', () => play('dry_fire'))
    .on('player:reload-start', (e) => {
      if (e.style === 'magazine') play('reload_out');
      else if (e.style === 'whole') {
        const [open, close] = wholeSounds(e.weaponId);
        play(open);
        play(close, undefined, { delay: Math.max(0.2, e.duration - 0.45) });
        if (open === 'break_open') {
          play('shell_drop', undefined, { delay: 0.35, semitones: -4 });
          play('shell_drop', undefined, { delay: 0.42, semitones: -4 });
        }
      }
      // single：每塞一顆由 player:reload-round 發聲
    })
    .on('player:reload-round', (e) => {
      if (e.clip) play('clip_insert');
      else play('shell_insert', undefined, { semitones: getFirearm(e.weaponId)?.cls === 'sniper' ? 4 : 0 });
    })
    .on('player:rack', (e) => {
      const d = getFirearm(e.weaponId);
      play(d?.cycleSound === 'bolt' ? 'bolt' : d?.cycleSound === 'pump' ? 'pump' : 'reload_in');
    })
    .on('player:reload-end', (e) => {
      if (getFirearm(e.weaponId)?.reload === 'magazine') play('reload_in');
    })
    .on('player:melee-swing', (e) => {
      // 刀類連段：越後面揮風聲越高越急；收尾那一下壓低
      const combo = e.combo ?? 1;
      const semi = e.tired ? -3 : e.finisher ? -2 : Math.min(4, (combo - 1) * 1.3);
      play(e.heavy ? 'swing_heavy' : 'swing_light', e.x, { semitones: semi });
    })
    .on('player:melee-hit', (e) => {
      const combo = e.combo ?? 1;
      const semi = e.execute ? -3 : e.finisher ? -2 : e.type === 'blunt' ? 0 : Math.min(4, (combo - 1) * 1.5);
      play(e.type === 'blunt' ? 'melee_blunt' : 'melee_slash', e.x, { semitones: semi });
      // 鈍器每一下都疊上打肉聲，聽起來是打在身體上而不是打空氣
      if (e.type === 'blunt') play('flesh_hit', e.x, { volume: 0.6, semitones: -2 });
      // 收尾重擊與處決：再疊一層更低的悶響，聽得出「這下很重」
      if (e.finisher || e.execute) play('melee_blunt', e.x, { volume: 0.7, semitones: -6 });
    })
    .on('player:exhausted', () => play('exhausted'))
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
    // 打在頭盔／背心上：金屬「鏘」（沿用路障受擊音，拉高音調）；頭盔飛走時更響
    .on('enemy:armor', (e) => play('barricade_hit', e.x, { semitones: e.part === 'helmet' ? 12 : 8, volume: e.broke ? 0.9 : 0.45 }))
    .on('enemy:burst', (e) => {
      play('barricade_break', e.x, { semitones: -7, volume: 0.9 });
      play('flesh_hit', e.x, { semitones: -5 });
    })
    .on('enemy:enrage', (e) => play('zombie_groan', e.x, { semitones: -4, volume: 1 }))
    .on('enemy:heal', (e) => play('ui_confirm', e.x, { semitones: -6, volume: 0.25 }))
    .on('barricade:hit', (e) => play('barricade_hit', e.x))
    .on('barricade:break', (e) => play('barricade_break', e.x))
    .on('base:hit', (e) => play('base_hit', e.x))
    // NPC 夥伴：沿用現有音色，調音高／音量區分（之後可換專屬配方）
    .on('ally:shoot', (e) => {
      if (e.weaponId) play(shotName(e.weaponId), e.x, { volume: 0.55 });
      else play('shot_pistol', e.x, { volume: 0.55, semitones: e.role === 'shooter' ? -1 : 1.5 });
      play('shell_drop', e.x, { delay: 0.3 + Math.random() * 0.12, volume: 0.5 });
    })
    .on('ally:hurt', (e) => play('player_hurt', e.x, { volume: 0.6, semitones: 3 }))
    .on('ally:death', (e) => play('player_death', e.x, { semitones: 2 }))
    .on('ally:heal', (e) => play('ui_confirm', e.x, { volume: 0.4, semitones: 5 }))
    .on('ally:order', () => play('ui_tap'))
    .on('barricade:repair', () => play('barricade_hit', undefined, { volume: 0.3, semitones: 6 }))
    .on('wave:start', () => play('wave_horn'))
    .on('game:over', (e) => {
      AudioManager.setMood('off');
      play(e.survived ? 'stinger_win' : 'stinger_lose', undefined, { delay: 0.3 });
    });

  AudioManager.setIntensity(0);
  AudioManager.setMood('night');
}
