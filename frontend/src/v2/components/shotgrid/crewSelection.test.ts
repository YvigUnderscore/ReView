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
  // The department from the site (batch 10) does not count toward who can be invited: these
  // cases therefore carry nothing, and the selection must ignore it.
  sgDepartment: null,
  department: null,
  state,
  userId: state === 'none' ? null : sgId,
  linkedByHand: false,
  projectRole: null,
  userRole: null,
});

const crew = [person(1, 'none'), person(2, 'account'), person(3, 'member'), person(4, 'ineligible')];

describe('isInvitable', () => {
  it('only keeps what changes something', () => {
    // A member has nothing to gain; an ineligible person has no address or has left the studio.
    expect(invitableOf(crew).map((p) => p.sgId)).toEqual([1, 2]);
    expect(isInvitable(person(3, 'member'))).toBe(false);
  });
});

describe('splitOutcome', () => {
  it('announces creations separately from additions', () => {
    // A creation sends an email to someone: say so before, not after.
    const { willCreate, willAdd } = splitOutcome(crew, [1, 2, 3]);
    expect(willCreate.map((p) => p.sgId)).toEqual([1]);
    expect(willAdd.map((p) => p.sgId)).toEqual([2]);
  });

  it('ignores an empty selection', () => {
    expect(splitOutcome(crew, [])).toEqual({ willCreate: [], willAdd: [] });
  });
});

describe('summarize', () => {
  it('counts each outcome', () => {
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
