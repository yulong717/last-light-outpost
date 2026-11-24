import Phaser from 'phaser';
import { HORDE, type WaveDef } from '../data/waves';
import { GameEvents } from './GameEvents';

/**
 * 依波次資料排程出怪。只負責「什麼時候生哪種敵人」，
 * 實際建立敵人交給 spawn 回呼。
 */
export class WaveSpawner {
  waveIndex = -1;
  private pending = 0;
  private finishedScheduling = false;
  private waitingNext = false;

  constructor(
    private scene: Phaser.Scene,
    private waves: WaveDef[],
    private spawn: (enemyId: string) => void,
  ) {}

  get totalWaves(): number {
    return this.waves.length;
  }

  /** 所有波次都已出完怪 */
  get done(): boolean {
    return this.finishedScheduling;
  }

  start(): void {
    this.queueNextWave();
  }

  /** 每幀呼叫：場上清空且這波出完，就排下一波 */
  update(aliveCount: number): void {
    if (this.finishedScheduling || this.waitingNext) return;
    if (this.pending === 0 && aliveCount === 0) this.queueNextWave();
  }

  private queueNextWave(): void {
    const next = this.waveIndex + 1;
    if (next >= this.waves.length) {
      this.finishedScheduling = true;
      return;
    }
    const wave = this.waves[next];
    this.waitingNext = true;
    if (wave.horde) {
      // 屍潮預警：遠方的嘶吼，給玩家幾秒補彈、退回路障後
      const warn = Math.min(HORDE.warn, wave.delayBefore - 0.5);
      this.scene.time.delayedCall((wave.delayBefore - warn) * 1000, () => {
        this.scene.events.emit('horde-warning', warn);
        GameEvents.of(this.scene).emit('wave:horde-warning', { seconds: warn });
      });
    }
    this.scene.time.delayedCall(wave.delayBefore * 1000, () => {
      this.waitingNext = false;
      this.waveIndex = next;
      this.scene.events.emit('wave-start', next + 1, this.waves.length, !!wave.horde);
      GameEvents.of(this.scene).emit('wave:start', { wave: next + 1, total: this.waves.length, horde: !!wave.horde });
      for (const g of wave.groups) {
        this.pending += g.count;
        for (let i = 0; i < g.count; i++) {
          this.scene.time.delayedCall(((g.startDelay ?? 0) + i * g.interval) * 1000 + Phaser.Math.Between(0, 300), () => {
            this.pending--;
            this.spawn(g.enemy);
          });
        }
      }
    });
  }
}
