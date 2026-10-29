// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A5-03 — granting or removing access to a project leaves a named trace.
 *
 * This is exactly the escalation gesture of finding A1-03: a *local* supervisor adds — or demotes to CLIENT —
 * an account they control, which then reads all the published media of the project. The audit screen showed
 * nothing: `addMember`/`removeMember` wrote into `projectMembership` without ever calling `logAudit`.
 *
 * The case that matters is not the arrival but the ROLE CHANGE of a member already there: the `upsert`
 * covered both without distinguishing them, hence never saying from which role.
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
  it("logs the arrival of a member with its actor and its target", async () => {
    await addMember(7, 42, undefined, SUPERVISOR);
    expect(audited).toHaveBeenCalledWith({
      userId: 5,
      action: 'PROJECT_MEMBER_ADD',
      entityType: 'Project',
      entityId: 7,
      metadata: { targetUserId: 42, role: null, previousRole: null },
    });
  });

  it('distinguishes a role change and says from which role', async () => {
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

  it('logs even without an actor — the ShotGrid sync has none', async () => {
    await addMember(7, 42);
    expect(audited).toHaveBeenCalledWith(expect.objectContaining({ userId: null }));
  });

  it("returns the membership as usual, the prior read does not change the return value", async () => {
    vi.mocked(prisma.projectMembership.upsert).mockResolvedValue({ id: 99 } as never);
    await expect(addMember(7, 42, undefined, SUPERVISOR)).resolves.toEqual({ id: 99 });
  });
});

describe('removeMember', () => {
  it("logs the removal of access with the role that was lost", async () => {
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

  it('logs nothing if the deletion fails', async () => {
    vi.mocked(prisma.projectMembership.delete).mockRejectedValue(new Error('absent'));
    await expect(removeMember(7, 42, SUPERVISOR)).rejects.toThrow();
    expect(audited).not.toHaveBeenCalled();
  });
});
