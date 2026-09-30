// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Shot } from '../../types/api';

/**
 * Rattacher des plans à la séquence qu'on regarde : ce que la liste propose, et ce que le
 * geste va réellement faire.
 *
 * Un plan ne porte qu'une séquence (`sequenceId`) : « rattacher » n'ajoute donc rien, cela
 * **déplace**. La nuance compte selon la provenance — un plan hors séquence entre sans que
 * personne ne le perde, un plan pris à SQ020 en sort. La séparation est faite ici, en
 * données, pour que l'écran l'énonce au lieu de la laisser deviner.
 */

/** Ce dont le rattachement a besoin d'un plan (la liste du projet en porte bien plus). */
export type AttachableShot = Pick<Shot, 'id' | 'code' | 'name' | 'sequenceId'> & {
  thumbnailUrl?: string | null;
};

/** Les deux provenances possibles, jamais mélangées à l'écran. */
export interface AttachGroups<T extends AttachableShot> {
  /** Plans qu'aucune séquence ne revendique : les rattacher ne retire rien à personne. */
  free: T[];
  /** Plans déjà rangés ailleurs : les rattacher les sort de leur séquence actuelle. */
  elsewhere: T[];
}

const byCode = (a: AttachableShot, b: AttachableShot) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/**
 * Plans proposables au rattachement, groupés par provenance.
 *
 * Ceux qui sont **déjà dans la séquence** en sont exclus : les proposer laisserait croire
 * qu'il reste un geste à faire, et les cocher n'aurait aucun effet. La recherche porte sur
 * le code et le nom, insensible à la casse.
 */
export function attachableShots<T extends AttachableShot>(
  shots: T[],
  sequenceId: number,
  query = '',
): AttachGroups<T> {
  const needle = query.trim().toLocaleLowerCase();
  const candidates = shots.filter((shot) => {
    if (shot.sequenceId === sequenceId) return false;
    if (!needle) return true;
    return `${shot.code} ${shot.name}`.toLocaleLowerCase().includes(needle);
  });
  return {
    free: candidates.filter((s) => s.sequenceId === null).sort(byCode),
    elsewhere: candidates.filter((s) => s.sequenceId !== null).sort(byCode),
  };
}

/**
 * Combien de plans retenus quitteraient une autre séquence.
 *
 * C'est le seul chiffre qui mérite un avertissement : rattacher un plan libre est sans
 * conséquence, le prendre à une autre séquence défait le montage de celle-ci.
 */
export function movedFromOtherSequence(shots: AttachableShot[], picked: Set<number>): number {
  return shots.filter((s) => picked.has(s.id) && s.sequenceId !== null).length;
}

/** Ce qui empêche de valider — `null` quand le geste peut partir. */
export type AttachRefusal = 'forbidden' | 'empty';

/**
 * Garde du rattachement, avant l'appel réseau.
 *
 * Le serveur refuse déjà un non-gestionnaire (403), mais l'écran ne doit pas laisser
 * composer une sélection entière pour l'apprendre au dernier clic.
 */
export function attachRefusal(canManage: boolean, pickedCount: number): AttachRefusal | null {
  if (!canManage) return 'forbidden';
  if (pickedCount === 0) return 'empty';
  return null;
}
