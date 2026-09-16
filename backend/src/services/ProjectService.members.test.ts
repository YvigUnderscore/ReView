// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A5-03 — accorder ou retirer l'accès à un projet laisse une trace nominative.
 *
 * C'est exactement le geste d'escalade du constat A1-03 : un superviseur *local* ajoute
 * — ou rétrograde en CLIENT — un compte qu'il contrôle, qui lit dès lors tous les médias
 * publiés du projet. L'écran d'audit ne montrait rien : `addMember`/`removeMember`
 * écrivaient dans `projectMembership` sans jamais appeler `logAudit`.
 *
 * Le cas qui compte n'est pas l'arrivée mais le CHANGEMENT DE RÔLE d'un membre déjà là :
 * l'`upsert` couvrait les deux sans les distinguer, donc sans jamais dire depuis quel rôle.
 */
vi.mock('../lib/prisma', () => ({
  prisma: {
    projectMembership: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteProject: vi.fn(),
  restoreProject: vi.fn(),
  purgeProject: vi.fn(),
}));
vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn(),
  firstMediaThumbKeysForProjects: vi.fn(),
}));
vi.mock('./DepartmentService', () => ({ syncFromSettings: vi.fn() }));

import { addMember, removeMember } from './ProjectService';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';

const SUPERVISOR = { id: 5, role: 'SUPERVISOR' as const };
const audited = vi.mocked(logAudit);
const findUnique = vi.mocked(prisma.projectMembership.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  vi.mocked(prisma.projectMembership.upsert).mockResolvedValue({ id: 1 } as never);
  vi.mocked(prisma.projectMembership.delete).mockResolvedValue({ id: 1, role: null } as never);
});

describe('addMember', () => {
  it("consigne l'arrivée d'un membre avec son acteur et sa cible", async () => {
    await addMember(7, 42, undefined, SUPERVISOR);
    expect(audited).toHaveBeenCalledWith({
      userId: 5,
      action: 'PROJECT_MEMBER_ADD',
      entityType: 'Project',
      entityId: 7,
      metadata: { targetUserId: 42, role: null, previousRole: null },
    });
  });

  it('distingue le changement de rôle et dit depuis quel rôle', async () => {
    findUnique.mockResolvedValue({ role: 'SUPERVISOR' } as never);
    await addMember(7, 42, 'CLIENT', SUPERVISOR);
    expect(audited).toHaveBeenCalledWith({
      userId: 5,
      action: 'PROJECT_MEMBER_UPDATE',
      entityType: 'Project',
      entityId: 7,
      metadata: { targetUserId: 42, role: 'CLIENT', previousRole: 'SUPERVISOR' },
    });
  });

  it('consigne quand même sans acteur — la synchronisation ShotGrid n’en a pas', async () => {
    await addMember(7, 42);
    expect(audited).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("rend bien le membership, la lecture préalable n'en change pas le retour", async () => {
    vi.mocked(prisma.projectMembership.upsert).mockResolvedValue({ id: 99 } as never);
    await expect(addMember(7, 42, undefined, SUPERVISOR)).resolves.toEqual({ id: 99 });
  });
});

describe('removeMember', () => {
  it("consigne le retrait d'accès avec le rôle perdu", async () => {
    vi.mocked(prisma.projectMembership.delete).mockResolvedValue({ role: 'SUPERVISOR' } as never);
    await removeMember(7, 42, SUPERVISOR);
    expect(audited).toHaveBeenCalledWith({
      userId: 5,
      action: 'PROJECT_MEMBER_REMOVE',
      entityType: 'Project',
      entityId: 7,
      metadata: { targetUserId: 42, role: 'SUPERVISOR' },
    });
  });

  it('ne consigne rien si la suppression échoue', async () => {
    vi.mocked(prisma.projectMembership.delete).mockRejectedValue(new Error('absent'));
    await expect(removeMember(7, 42, SUPERVISOR)).rejects.toThrow();
    expect(audited).not.toHaveBeenCalled();
  });
});
