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
});

describe('TimelineMarkerService (34.C)', () => {
  it('list : RBAC projet puis vue sérialisée (authorName)', async () => {
    vi.mocked(prisma.timelineMarker.findMany).mockResolvedValue([dbMarker()] as never);
    const out = await list(artist, 9);
    expect(checkProjectAccess).toHaveBeenCalledWith(2, Role.ARTIST, 7);
    expect(out[0]).toMatchObject({ id: 5, frame: 24, name: 'Plan 2', authorName: 'artist' });
  });

  it('list : média introuvable → 404 ; non-membre → 403', async () => {
    vi.mocked(resolveProjectIdForMedia).mockResolvedValue(null);
    await expect(list(artist, 9)).rejects.toMatchObject({ statusCode: 404 });
    vi.mocked(resolveProjectIdForMedia).mockResolvedValue(7);
    vi.mocked(checkProjectAccess).mockResolvedValue(false);
    await expect(list(artist, 9)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('create : refusé aux clients ; couleur validée ; émet markers:changed', async () => {
    await expect(create(client, 9, { frame: 1, name: 'x', color: '#112233' })).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(create(artist, 9, { frame: 1, name: 'x', color: 'red' })).rejects.toMatchObject({
      statusCode: 400,
    });
    vi.mocked(prisma.timelineMarker.count).mockResolvedValue(0);
    vi.mocked(prisma.timelineMarker.create).mockResolvedValue(dbMarker() as never);
    const out = await create(artist, 9, { frame: 24, name: 'Plan 2', color: '#22d3ee' });
    expect(out.name).toBe('Plan 2');
    expect(emitToReview).toHaveBeenCalledWith(9, 'markers:changed', { mediaId: 9 });
  });

  it('update/remove : auteur ou superviseur seulement, marqueur du bon média', async () => {
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker() as never);
    vi.mocked(prisma.timelineMarker.update).mockResolvedValue(dbMarker({ name: 'Plan 2b' }) as never);
    // Un autre artiste (id 4) : refusé.
    await expect(update({ id: 4, role: Role.ARTIST }, 9, 5, { name: 'x' })).rejects.toMatchObject({
      statusCode: 403,
    });
    // L'auteur : OK.
    const out = await update(artist, 9, 5, { name: 'Plan 2b' });
    expect(out.name).toBe('Plan 2b');
    // Marqueur d'un autre média : 404.
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker({ mediaObjectId: 99 }) as never);
    await expect(remove(admin, 9, 5)).rejects.toMatchObject({ statusCode: 404 });
    // Admin sur le bon média : OK + broadcast.
    vi.mocked(prisma.timelineMarker.findUnique).mockResolvedValue(dbMarker() as never);
    await remove(admin, 9, 5);
    expect(prisma.timelineMarker.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(emitToReview).toHaveBeenCalledWith(9, 'markers:changed', { mediaId: 9 });
  });
});
