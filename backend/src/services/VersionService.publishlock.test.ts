// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    version: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    // The right to publish is read from the project's EFFECTIVE role (38.E): the author is there a member
    // without a local role, hence judged on their global role, as before.
    projectMembership: { findUnique: vi.fn().mockResolvedValue({ role: null }) },
  },
}));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('../lib/trash', () => ({
  softDeleteVersion: vi.fn(),
  restoreVersion: vi.fn(),
  purgeVersion: vi.fn(),
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { update } from './VersionService';
import { prisma } from '../lib/prisma';
import { Role, VersionStatus } from '@prisma/client';

const findUnique = vi.mocked(prisma.version.findUnique);
const updateVersion = vi.mocked(prisma.version.update);

const author = { id: 3, role: Role.ARTIST };
const supervisor = { id: 9, role: Role.SUPERVISOR };

beforeEach(() => {
  vi.clearAllMocks();
  updateVersion.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }) as never);
});

/**
 * The publication lock (Phase 11) only made sense if the transition TO the published state was reserved to supervisors.
 * The author could therefore unpublish their own version, removing it from the client share link, review decisions included,
 * and then edit it freely, since `assertNotPublished` now only saw a draft.
 */
describe('VersionService.update: two-way publication lock', () => {
  it('refuses the author publishing their version', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: false } as never);
    await expect(update(author, 7, 1, { status: VersionStatus.PUBLISHED })).rejects.toThrow(/supervisor/i);
  });

  it('refuses the author UNpublishing their version', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: true } as never);
    await expect(update(author, 7, 1, { status: VersionStatus.DRAFT })).rejects.toThrow(/unpublish/i);
  });

  it('allows a supervisor to unpublish', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: true } as never);
    await expect(update(supervisor, 7, 1, { status: VersionStatus.DRAFT })).resolves.toBeDefined();
  });

  it('lets the author rename an unpublished version', async () => {
    findUnique.mockResolvedValue({ authorId: author.id, published: false } as never);
    await expect(update(author, 7, 1, { name: 'V02' })).resolves.toBeDefined();
  });
});
