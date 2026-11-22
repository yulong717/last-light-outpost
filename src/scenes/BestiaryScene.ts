import Phaser from 'phaser';
import { GAME_WIDTH } from '../config';
import { ANIMALS, PROFESSIONS, type MutationId, MUTATIONS } from '../data/zombies';
import { Zombie } from '../entities/Zombie';
import { Fx } from '../fx/Fx';
import { rollZombie } from '../systems/ZombieFactory';
import { pixelText } from '../utils/text';

/**
 * 霧屍圖鑑：第 1 頁是人形職業（每種擲三隻，最下排帶隨機變異），第 2 頁是動物。
 * 可以點擊開槍測試護甲。主選單按 B 進入；R 重擲、Tab 換頁、Esc 返回。
 */
export class BestiaryScene extends Phaser.Scene {
  private zombies: Zombie[] = [];
  private info!: Phaser.GameObjects.Text;
  private page = 0;

  constructor() {
    super('Bestiary');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#20242c');
    this.add.rectangle(0, 72, GAME_WIDTH, 300, 0x2b2f36).setOrigin(0);
    Fx.attach(this);
    pixelText(this, GAME_WIDTH / 2, 10, '霧屍圖鑑', 12, '#f5d76e').setOrigin(0.5, 0);
    pixelText(this, GAME_WIDTH / 2, 28, '點頭部＝爆頭（25）、點身體＝一般射擊（10）　R 重擲　Tab 換頁　Esc 返回', 8, '#9aa3ad').setOrigin(0.5, 0);
    this.info = pixelText(this, GAME_WIDTH / 2, 42, '', 8, '#e0e0e0').setOrigin(0.5, 0);
    this.roll();

    this.input.keyboard?.on('keydown-R', () => this.roll());
    this.input.keyboard?.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.page = 1 - this.page;
      this.roll();
    });
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.shoot(p.worldX, p.worldY));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.hover(p.worldX, p.worldY));
  }

  private roll(): void {
    for (const z of this.zombies) z.destroy();
    this.zombies = [];
    this.children.list.filter((c) => c.getData?.('label')).forEach((c) => c.destroy());
    if (this.page === 1) {
      this.rollAnimals();
      return;
    }
    const ids = Object.keys(PROFESSIONS).filter((id) => !ANIMALS[id]);
    const colW = GAME_WIDTH / ids.length;
    const mutIds = Object.keys(MUTATIONS) as MutationId[];
    ids.forEach((id, i) => {
      const x = colW * (i + 0.5);
      const label = pixelText(this, x, 58, PROFESSIONS[id].name.replace('霧屍', ''), 8, '#ffffff').setOrigin(0.5, 0);
      label.setData('label', true);
      [150, 245, 340].forEach((y, row) => {
        const muts = row === 2 ? [mutIds[(i + Math.floor(Math.random() * mutIds.length)) % mutIds.length]] : [];
        const spec = rollZombie(this, id, 9, muts);
        const z = new Zombie(this, x, y, spec);
        // 圖鑑不受地面帶限制
        z.footY = y;
        this.zombies.push(z);
      });
    });
  }

  /** 動物頁：三群屍犬、一排屍鴉在空中、一頭屍熊 */
  private rollAnimals(): void {
    const mutIds = Object.keys(MUTATIONS) as MutationId[];
    const place = (id: string, x: number, y: number, muts: MutationId[] = []) => {
      const z = new Zombie(this, x, y, rollZombie(this, id, 9, muts));
      z.footY = y;
      this.zombies.push(z);
      return z;
    };
    const label = (x: number, text: string) => pixelText(this, x, 58, text, 8, '#ffffff').setOrigin(0.5, 0).setData('label', true);
    label(110, `${ANIMALS.dog.name}／${ANIMALS.crow.name}`);
    label(470, ANIMALS.bear.name);
    [40, 110, 180].forEach((x, i) => place('dog', x, 330, i === 2 ? [mutIds[Math.floor(Math.random() * mutIds.length)]] : []));
    [50, 110, 170, 230].forEach((x, i) => {
      const c = place('crow', x, 330, i === 3 ? ['frenzied'] : []);
      c.alt = 215 + (i % 2) * 18;
    });
    [40, 110, 180].forEach((x) => place('dog', x, 220));
    place('bear', 470, 300);
  }

  private pick(x: number, y: number): Zombie | null {
    for (const z of this.zombies) if (!z.dead && z.getHitRect().contains(x, y)) return z;
    return null;
  }

  private hover(x: number, y: number): void {
    const z = this.pick(x, y);
    if (!z) return;
    const s = z.spec;
    const parts = [
      s.displayName,
      `血 ${Math.ceil(z.hp)}/${z.maxHp}`,
      `速 ${Math.round(z.def.speed)}`,
      z.helmet ? `頭盔 ${Math.round(z.helmet.armor * 100)}%` : '',
      z.vest ? `背心 ${Math.round(z.vest.armor * 100)}%` : '',
      s.bodyArmor ? `體甲 ${Math.round(s.bodyArmor * 100)}%` : '',
      s.structureMul > 1 ? `拆牆 ×${s.structureMul}` : '',
    ].filter(Boolean);
    this.info.setText(parts.join('　'));
  }

  private shoot(x: number, y: number): void {
    const z = this.pick(x, y);
    if (!z) return;
    const head = z.isHeadshot(y);
    z.takeDamage(head ? 25 : 10, 0, { headshot: head, dirX: 1 });
    if (head) Fx.of(this)?.popText(x, y - 8, '爆頭', '#ffd24a');
    this.hover(x, y);
  }

  update(_t: number, dms: number): void {
    const dt = Math.min(dms / 1000, 0.05);
    this.zombies = this.zombies.filter((z) => z.active && !z.dead);
    for (const z of this.zombies) z.idle(dt);
  }
}
