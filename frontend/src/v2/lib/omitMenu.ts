// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Omission d'un plan du montage — logique pure, sans React ni réseau.
 *
 * Le drapeau existait en base et dans les montages automatiques (Phase 45), écrit par la
 * seule route `PATCH /api/shots/:id` : la production pouvait *voir* qu'un plan était coupé
 * — la grille de la séquence le marque d'un œil barré — sans jamais pouvoir le décider.
 *
 * Ce module dit ce que vaut le drapeau, quel corps le bascule et quelle séquence rafraîchir.
 */

/**
 * Le plan tel que l'écran l'a sous la main. La liste d'un projet le donne à plat
 * (`sequenceId`), la fiche d'un plan l'imbrique (`sequence`) : les deux caches n'ont pas
 * la même forme, et n'en connaître qu'une laisserait l'œil barré périmé sur l'autre écran.
 */
export interface OmitTarget {
  id: number;
  omitted?: boolean;
  sequenceId?: number | null;
  sequence?: { id: number } | null;
}

/** Un plan sans drapeau est au montage : l'absence de valeur n'est pas une omission. */
export function isOmitted(shot: OmitTarget): boolean {
  return shot.omitted === true;
}

/**
 * Le corps du `PATCH` : la bascule, et rien d'autre.
 *
 * Le plan reste éditable ailleurs — panneau de réglages, statut au clic droit, synchro
 * ShotGrid. Y joindre le moindre champ que personne n'a touché republierait vers le site
 * une valeur qui a pu bouger entre-temps, et l'écraserait au passage.
 */
export function omitBody(shot: OmitTarget): { omitted: boolean } {
  return { omitted: !isOmitted(shot) };
}

/** La séquence porteuse, quelle que soit la forme reçue — `null` pour un plan sans séquence. */
export function sequenceIdOf(shot: OmitTarget): number | null {
  return shot.sequenceId ?? shot.sequence?.id ?? null;
}
