// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { SgCrewPerson, SgCrewState } from '../../types/shotgrid';
import { invitableOf, isInvitable, splitOutcome, summarize } from './crewSelection';

const person = (sgId: number, state: SgCrewState): SgCrewPerson => ({
  sgId,
  name: `P${sgId}`,
  login: null,
  email: `p${sgId}@studio.test`,
  sgStatus: 'act',
  state,
  userId: state === 'none' ? null : sgId,
  linkedByHand: false,
  projectRole: null,
  userRole: null,
});

const crew = [person(1, 'none'), person(2, 'account'), person(3, 'member'), person(4, 'ineligible')];

describe('isInvitable', () => {
  it('ne retient que ce qui change quelque chose', () => {
    // Un membre n'a rien à gagner ; un inéligible n'a pas d'adresse ou a quitté le studio.
    expect(invitableOf(crew).map((p) => p.sgId)).toEqual([1, 2]);
    expect(isInvitable(person(3, 'member'))).toBe(false);
  });
});

describe('splitOutcome', () => {
  it('annonce les créations à part des ajouts', () => {
    // Une création envoie un courriel à quelqu'un : il faut le dire avant, pas après.
    const { willCreate, willAdd } = splitOutcome(crew, [1, 2, 3]);
    expect(willCreate.map((p) => p.sgId)).toEqual([1]);
    expect(willAdd.map((p) => p.sgId)).toEqual([2]);
  });

  it('ignore une sélection vide', () => {
    expect(splitOutcome(crew, [])).toEqual({ willCreate: [], willAdd: [] });
  });
});

describe('summarize', () => {
  it('compte chaque issue', () => {
    expect(
      summarize([
        { sgId: 1, outcome: 'created' },
        { sgId: 2, outcome: 'added' },
        { sgId: 3, outcome: 'linked' },
        { sgId: 4, outcome: 'skipped', reason: 'ineligible' },
        { sgId: 5, outcome: 'created' },
      ]),
    ).toEqual({ created: 2, added: 1, linked: 1, skipped: 1 });
  });
});
