// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SgCrewInviteResult, SgCrewPerson } from '../../types/shotgrid';

/**
 * Invitation selection and summary for the team: pure logic.
 *
 * The point here is to tell the user **before** they click how many accounts will be
 * created. An invitation sends an email to someone; announcing it afterwards would be too late.
 */

/** Only these people gain anything from being invited. */
export function isInvitable(person: SgCrewPerson): boolean {
  return person.state === 'account' || person.state === 'none';
}

export function invitableOf(crew: SgCrewPerson[]): SgCrewPerson[] {
  return crew.filter(isInvitable);
}

/** What the selection will do: account creations and additions to the project. */
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

/** Counters per outcome, for reporting afterwards. */
export function summarize(results: SgCrewInviteResult[]): Record<SgCrewInviteResult['outcome'], number> {
  const counts = { created: 0, added: 0, linked: 0, skipped: 0 };
  for (const r of results) counts[r.outcome] += 1;
  return counts;
}
