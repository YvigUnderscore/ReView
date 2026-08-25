// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('./ShotgridConfigService', () => ({ openConnection: vi.fn() }));
vi.mock('../UserService', () => ({ createUser: vi.fn() }));
vi.mock('../ProjectService', () => ({ addMember: vi.fn() }));

import { crewState, dedupeCrew, eligibility, planInvites, type CrewPerson } from './ShotgridCrewService';

const person = (over: Partial<CrewPerson> & { sgId: number }): CrewPerson => ({
  name: 'X',
  login: null,
  email: 'x@studio.test',
  sgStatus: 'act',
  state: 'none',
  userId: null,
  linkedByHand: false,
  projectRole: null,
  userRole: null,
  ...over,
});

describe('eligibility', () => {
  it('refuse une personne sans adresse', () => {
    // Il n'y a rien à quoi envoyer l'invitation.
    expect(eligibility({ email: null, sgStatus: 'act' })).toBe(false);
  });

  it('refuse une personne désactivée sur le site', () => {
    // Elle a quitté le studio : lui ouvrir un accès dirait le contraire du site.
    expect(eligibility({ email: 'a@b.c', sgStatus: 'dis' })).toBe(false);
  });

  it('accepte quand le site ne déclare pas de statut', () => {
    expect(eligibility({ email: 'a@b.c', sgStatus: null })).toBe(true);
  });
});

describe('crewState', () => {
  it('distingue les quatre situations', () => {
    const ok = { email: 'a@b.c', sgStatus: 'act' };
    expect(crewState(ok, { userId: 5, isMember: true })).toBe('member');
    expect(crewState(ok, { userId: 5, isMember: false })).toBe('account');
    expect(crewState(ok, { userId: null, isMember: false })).toBe('none');
    expect(crewState({ email: null, sgStatus: 'act' }, { userId: null, isMember: false })).toBe('ineligible');
  });
});

describe('dedupeCrew', () => {
  it('garde l’actif quand deux comptes du site partagent une adresse', () => {
    const kept = dedupeCrew([
      { email: 'a@b.c', sgStatus: 'dis', sgId: 1 },
      { email: 'a@b.c', sgStatus: 'act', sgId: 2 },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.sgId).toBe(2);
  });

  it('ne fusionne jamais deux personnes sans adresse', () => {
    expect(
      dedupeCrew([
        { email: null, sgStatus: 'act', sgId: 1 },
        { email: null, sgStatus: 'act', sgId: 2 },
      ]),
    ).toHaveLength(2);
  });
});

describe('planInvites', () => {
  const crew = [
    person({ sgId: 1, state: 'none' }),
    person({ sgId: 2, state: 'account', userId: 20 }),
    person({ sgId: 3, state: 'member', userId: 30 }),
  ];

  it('sépare créations, ajouts et sans-effet', () => {
    const plan = planInvites(crew, [1, 2, 3], { canCreateAccounts: true });
    expect(plan.create.map((p) => p.sgId)).toEqual([1]);
    expect(plan.add.map((p) => p.sgId)).toEqual([2]);
    expect(plan.skip.map((p) => p.sgId)).toEqual([3]);
  });

  it('refuse le lot entier quand l’acteur ne peut pas créer de compte', () => {
    // Refuser d'emblée plutôt que d'en créer trois puis d'échouer au quatrième.
    expect(() => planInvites(crew, [1, 2], { canCreateAccounts: false })).toThrow();
  });

  it('laisse passer les seuls ajouts pour un superviseur de projet', () => {
    const plan = planInvites(crew, [2, 3], { canCreateAccounts: false });
    expect(plan.add.map((p) => p.sgId)).toEqual([2]);
  });
});
