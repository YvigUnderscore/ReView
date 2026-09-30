// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SgCrewInviteResult, SgCrewPerson } from '../../types/shotgrid';

/**
 * Sélection et résumé de l'invitation d'équipe — logique pure.
 *
 * Ce qui se joue ici : dire à l'utilisateur **avant** de cliquer combien de comptes
 * seront créés. Une invitation envoie un courriel à quelqu'un ; l'annoncer après coup
 * serait trop tard.
 */

/** Seules ces personnes gagnent quelque chose à être invitées. */
export function isInvitable(person: SgCrewPerson): boolean {
  return person.state === 'account' || person.state === 'none';
}

export function invitableOf(crew: SgCrewPerson[]): SgCrewPerson[] {
  return crew.filter(isInvitable);
}

/** Ce que fera la sélection : des créations de comptes, des ajouts au projet. */
export function splitOutcome(
  crew: SgCrewPerson[],
  selected: number[],
): { willCreate: SgCrewPerson[]; willAdd: SgCrewPerson[] } {
  const wanted = new Set(selected);
  const picked = crew.filter((p) => wanted.has(p.sgId));
  return {
    willCreate: picked.filter((p) => p.state === 'none'),
    willAdd: picked.filter((p) => p.state === 'account'),
  };
}

/** Compteurs par issue, pour le retour après coup. */
export function summarize(results: SgCrewInviteResult[]): Record<SgCrewInviteResult['outcome'], number> {
  const counts = { created: 0, added: 0, linked: 0, skipped: 0 };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}
