// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Role } from '@prisma/client';

vi.mock('../lib/prisma', () => ({
  prisma: {
    timelineMarker: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    // The per-project role (38.E) is read from the database by `lib/projectRoles`, left REAL here:
    // mocking the guard under test would make the test blind to the A1-03 bypass.
    projectMembership: { findUnique: vi.fn() },
  },
}));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));
vi.mock('../lib/pipeline', () => ({ resolveProjectIdForMedia: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToReview: vi.fn() }));

import { list, create, update, remove } from './TimelineMarkerService';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { emitToReview } from './SocketService';

const admin = { id: 1, role: Role.ADMIN };
const artist = { id: 2, role: Role.ARTIST };
const client = { id: 3, role: Role.CLIENT };

const dbMarker = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 5,
  mediaObjectId: 9,
  frame: 24,
  name: 'Plan 2',
  color: '#22d3ee',
  authorId: 2,
  createdAt: new Date('2026-07-19'),
  author: { id: 2, email: 'a@a', name: null, firstName: null, lastName: null, username: 'artist' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveProjectIdForMedia).mockResolvedValue(7);
  vi.mocked(checkProjectAccess).mockResolvedValue(true);
  // Member without a local role: the effective role falls back on the global role.
  vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({
    userId: 2,
    projectId: 7,
    role: null,
  } as never);
});

describe('TimelineMarkerService (34.C)', () => {
  it('list: project RBAC, then serialized view (authorName)', async () => {
    vi.mocked(prisma.timelineMarker.findMany).mockResolvedValue([dbMarker()] as never);
    const out = await list(artist, 9);
    expect(checkProjectAccess).toHaveBeenCalledWith(2, Role.ARTIST, 7);
    expect(out[0]).toMatchObject({ id: 5, frame: 24, name: 'Plan 2', authorName: 'artist' });
  });

  it('list: media not found → 404; non-member → 403', async () => {
    vi.mocked(resolveProjectIdForMedia).mockResolvedValue(null);
    await expect(list(artist, 9)).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(resolveProjectIdForMedia).mockResolvedValue(7);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);
    await expect(list(artist, 9)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('create: refused to clients; colour validated; emits markers:changed', async () => {
    await expect(create(client, 9, { frame: 1, name: 'x', color: '#112233' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(create(artist, 9, { frame: 1, name: 'x', color: 'red' })).rejects.toMatchObject({
      statusCode: 400,
    });
    vi.mocked(prisma.timelineMarker.count).mockResolvedValue(0);
    vi.mocked(prisma.timelineMarker.create).mockResolvedValue(dbMarker());
    const out = await create(artist, 9, { frame: 24, name: 'Plan 2', color: '#22d3ee' });
    expect(out.name).toBe('Plan 2');
    expect(emitToReview).toHaveBeenCalledWith(9, 'markers:changed', { mediaId: 9 });
  });

  it('update/remove: author or supervisor only, marker of the right media', async () => {
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker());
    vi.mocked(prisma.timelineMarker.update).mockResolvedValue(dbMarker({ name: 'Plan 2b' }));
    // Another artist (id 4): refused.
    await expect(update({ id: 4, role: Role.ARTIST }, 9, 5, { name: 'x' })).rejects.toMatchObject({
      statusCode: 403,
    });
    // The author: OK.
    const out = await update(artist, 9, 5, { name: 'Plan 2b' });
    expect(out.name).toBe('Plan 2b');
    // Marker of another media: 404.
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker({ mediaObjectId: 99 }));
    await expect(remove(admin, 9, 5)).rejects.toMatchObject({ statusCode: 404 });
    // Admin on the right media: OK + broadcast.
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker());
    await remove(admin, 9, 5);
    expect(prisma.timelineMarker.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(emitToReview).toHaveBeenCalledWith(9, 'markers:changed', { mediaId: 9 });
  });
});

/**
 * A1-03: the service read the GLOBAL role after having only checked membership: an ARTIST demoted to CLIENT on the project kept their `ProjectMembership`,
 * so `checkProjectAccess` said yes, and they still wrote the shared markers.
 */
describe('TimelineMarkerService: effective role per project (38.E)', () => {
  /** Global ARTIST, demoted to CLIENT on project 7; author of marker 5. */
  const demoted = { id: 2, role: Role.ARTIST };

  beforeEach(() => {
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({
      userId: 2,
      projectId: 7,
      role: Role.CLIENT,
    } as never);
  });

  it('create: demoted to CLIENT on the project → 403 ROLE_FORBIDDEN, nothing is written', async () => {
    vi.mocked(prisma.timelineMarker.count).mockResolvedValue(0);
    await expect(create(demoted, 9, { frame: 24, name: 'x', color: '#22d3ee' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN',
    });
    expect(prisma.timelineMarker.create).not.toHaveBeenCalled();
  });

  it('update/remove: they no longer touch their own markers either', async () => {
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker()); // authorId: 2
    await expect(update(demoted, 9, 5, { name: 'x' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(remove(demoted, 9, 5)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.timelineMarker.update).not.toHaveBeenCalled();
    expect(prisma.timelineMarker.delete).not.toHaveBeenCalled();
  });

  it("conversely: an ARTIST promoted to SUPERVISOR locally manages another person's marker", async () => {
    vi.mocked(prisma.projectMembership.findUnique).mockResolvedValue({
      userId: 4,
      projectId: 7,
      role: Role.SUPERVISOR,
    } as never);
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker()); // authorId: 2
    vi.mocked(prisma.timelineMarker.update).mockResolvedValue(dbMarker({ name: 'Plan 3' }));
    const out = await update({ id: 4, role: Role.ARTIST }, 9, 5, { name: 'Plan 3' });
    expect(out.name).toBe('Plan 3');
  });
});
