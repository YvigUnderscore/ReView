import type { UsdBakedVariant } from '../../../types/usd';

/**
 * Disponibilité d'une option de variante en review (46.P).
 *
 * La bascule instantanée repose sur la **cuisson** : seule une option présente dans le GLB
 * peut être montrée sans reconversion. Le menu grise les autres au lieu de proposer un choix
 * sans effet — c'était le symptôme « les variantes de texture ne fonctionnent pas ».
 */
export function variantOptionAvailable(
  baked: readonly UsdBakedVariant[] | null | undefined,
  prim: string,
  set: string,
  option: string,
  selected: string,
): boolean {
  // L'option composée à la conversion est déjà la scène de base : toujours montrable.
  if (option === selected) return true;
  // Média converti avant que la liste des options cuites soit exposée : on ne sait pas —
  // ne pas bloquer (les fixtures d'avant 46.P fonctionnent sans cette information).
  if (!baked) return true;
  return baked.some((b) => b.prim === prim && b.set === set && b.option === option);
}
