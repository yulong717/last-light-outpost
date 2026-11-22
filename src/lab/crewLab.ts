import { paintCrewSheet, type Pixels } from '../art/crewPaint';
import { COMPANION_ROLES, makeCrewMember, type CompanionRole } from '../data/companions';
import { BODY_GEAR, FACE_GEAR, HAIR_STYLES, HEAD_GEAR } from '../data/crewLooks';
import { ATTRS, TRAIT_BY_ID, resolveCrewStats } from '../data/crewTraits';
import { randomSeed } from '../utils/rng';
import { BACKGROUND_BY_ID, BODIES, PROF_NAMES, WEAPON_GROUPS } from '../data/crewBody';

/** 開發用：一次產生一批隨機倖存者，檢查換裝與數值。網址加 ?seed=123 可固定結果。 */
async function loadPixels(url: string): Promise<Pixels> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height);
  return { width: d.width, height: d.height, data: d.data };
}

const nameOf = <T extends { id: string; name: string }>(list: T[], id: string | null): string => list.find((g) => g.id === id)?.name ?? '';

async function main(): Promise<void> {
  const src = await loadPixels('assets/sprites/player_shoot.png');
  const mask = await loadPixels('assets/sprites/player_shoot_regions.png');
  const grid = document.getElementById('grid')!;
  const params = new URLSearchParams(location.search);
  const count = Number(params.get('n') ?? 24);
  const frame = Number(params.get('frame') ?? 0);
  let base = Number(params.get('seed') ?? randomSeed());

  const render = (): void => {
    grid.innerHTML = '';
    const roles: CompanionRole[] = ['shooter', 'medic', 'engineer'];
    for (let i = 0; i < count; i++) {
      const role = roles[i % 3];
      const m = makeCrewMember(`lab-${i}`, role, base + i * 7919);
      const out = paintCrewSheet(src, mask, m.look);
      const card = document.createElement('div');
      card.className = 'card';
      const cv = document.createElement('canvas');
      const S = 3;
      cv.width = 64 * S;
      cv.height = 64 * S;
      const tmp = document.createElement('canvas');
      tmp.width = out.width;
      tmp.height = out.height;
      tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), 0, 0);
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const w = 64 * S * m.look.build.w;
      const h = 64 * S * m.look.build.h;
      ctx.drawImage(tmp, frame * 64, 0, 64, 64, (64 * S - w) / 2, 64 * S - h, w, h);
      card.appendChild(cv);
      const st = resolveCrewStats(COMPANION_ROLES[role], m);
      const traits = m.traits
        .map((t) => `<span class="${TRAIT_BY_ID[t].kind}">${TRAIT_BY_ID[t].name}</span>`)
        .join('、');
      const stars = ATTRS.map((a) => `${a.name} ${'★'.repeat(m.attrs[a.key])}${'☆'.repeat(5 - m.attrs[a.key])}`).join('\n');
      const gear = [
        nameOf(HAIR_STYLES, m.look.hairStyle),
        nameOf(HEAD_GEAR, m.look.head),
        ...m.look.face.map((f) => nameOf(FACE_GEAR, f)),
        ...m.look.body.map((b) => nameOf(BODY_GEAR, b)),
      ]
        .filter(Boolean)
        .join('・');
      card.insertAdjacentHTML(
        'beforeend',
        `<div class="name">${m.name}<span class="role">${COMPANION_ROLES[role].title}</span></div>
         <div>${traits}</div>
         <div style="color:#ffe082">${BODIES[m.body].name}・${BACKGROUND_BY_ID[m.background].name}</div>
         <div class="gear">${WEAPON_GROUPS.map((g) => `${g.name}${m.prof[g.id] ? PROF_NAMES[m.prof[g.id]].slice(0, 2) : '✗'}`).join(' ')}</div>
         <div class="attrs">${stars}</div>
         <div class="gear">${gear}</div>
         <div class="gear">血 ${st.maxHp}・速 ${st.speed.toFixed(0)}・傷 ${st.gun.damage.toFixed(1)}・射速 ${st.gun.fireRate.toFixed(2)}・彈匣 ${st.gun.magazine}</div>`,
      );
      grid.appendChild(card);
    }
  };
  document.getElementById('again')!.onclick = () => {
    base = randomSeed();
    render();
  };
  render();
}

void main();
