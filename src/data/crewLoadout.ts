import { COMPANION_ROLES, type CrewMember } from './companions';
import { canWield } from './crewBody';
import { resolveCrewStats, type CrewStats } from './crewTraits';

/** 沒碰過槍的人、沒配發近戰武器時手上的隨身小刀（不佔軍械庫） */
export const IMPROVISED_MELEE = 'knife';

/** 隊員實際拿的武器：配發的（會用才拿）> 隨身手槍（undefined）> 不會用手槍的人拿隨身小刀 */
export function crewWeapon(m: CrewMember): string | undefined {
  if (m.weaponId && canWield(m, m.weaponId).ok) return m.weaponId;
  return (m.prof?.handgun ?? 2) > 0 ? undefined : IMPROVISED_MELEE;
}

/** 隊員現在的完整數值（戰鬥、探索、介面共用） */
export function crewStats(m: CrewMember, weaponId: string | undefined = crewWeapon(m)): CrewStats {
  return resolveCrewStats(COMPANION_ROLES[m.role], m, weaponId);
}
