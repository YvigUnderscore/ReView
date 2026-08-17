// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { mediaObject: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
  StorageService: { mediaKey: vi.fn(), thumbnailKey: vi.fn() },
}));
vi.mock('./JobService', () => ({ enqueueMediaJob: vi.fn() }));
vi.mock('./SocketService', () => ({ emitToProject: vi.fn() }));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));
vi.mock('../lib/settings', () => ({ getNumericSetting: vi.fn(), SETTING_KEYS: {} }));
vi.mock('../lib/trash', () => ({ softDeleteMedia: vi.fn(), restoreMedia: vi.fn(), purgeMedia: vi.fn() }));
vi.mock('../middleware/rbac', () => ({ checkProjectAccess: vi.fn() }));

import { listReviews } from './MediaService';
import { prisma } from '../lib/prisma';
import { Role, type Prisma } from '@prisma/client';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const count = vi.mocked(prisma.mediaObject.count);
const page = { page: 1, pageSize: 100, order: 'desc' as const };
const artist = { id: 3, role: Role.ARTIST };

function lastWhere(): Prisma.MediaObjectWhereInput {
  return findMany.mock.calls[0]![0]!.where!;
}

describe('MediaService.listReviews — page Reviews globale (12.C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([] as never);
    count.mockResolvedValue(0);
  });

  it('par défaut : publiés de mes projets + mes brouillons (membership pour un ARTIST)', async () => {
    await listReviews(artist, {}, page);
    const where = lastWhere();
    expect(where.AND).toEqual([{ OR: [{ published: true }, { published: false, uploaderId: 3 }] }]);
    const version = where.version as { OR: { task?: { shot?: { project: unknown } } }[] };
    expect(version.OR[0]!.task!.shot!.project).toMatchObject({
      memberships: { some: { userId: 3 } },
    });
  });

  it('status=draft : uniquement mes brouillons ; ADMIN sans filtre membership', async () => {
    await listReviews({ id: 1, role: Role.ADMIN }, { status: 'draft', projectId: 7 }, page);
    const where = lastWhere();
    expect(where.AND).toEqual([{ published: false, uploaderId: 1 }]);
    const version = where.version as { OR: { asset?: { project: unknown } }[] };
    expect(version.OR[2]!.asset!.project).toEqual({ deletedAt: null, id: 7 });
  });

  it('mappe les items : miniature présignée, localisation, projet', async () => {
    findMany.mockResolvedValue([
      {
        id: 5,
        kind: 'VIDEO',
        originalName: 'plan.mp4',
        published: true,
        createdAt: new Date('2026-07-12T10:00:00Z'),
        thumbnailKey: 'thumbs/5.jpg',
        uploader: { id: 2, name: 'Ana' },
        version: {
          name: 'V02',
          task: {
            name: 'Comp',
            shot: { code: 'SH010', sequence: { code: 'SQ01' }, project: { id: 7, name: 'Film' } },
            asset: null,
          },
          asset: null,
        },
      },
    ] as never);
    count.mockResolvedValue(1);
    const { items, total } = await listReviews(artist, {}, page);
    expect(total).toBe(1);
    expect(items[0]).toEqual({
      id: 5,
      kind: 'VIDEO',
      name: 'plan.mp4',
      published: true,
      createdAt: new Date('2026-07-12T10:00:00Z'),
      thumbnailUrl: 'https://minio/thumbs/5.jpg',
      hoverSprite: null,
      location: 'SQ01 · SH010 › Comp',
      versionName: 'V02',
      reviewStatus: null,
      project: { id: 7, name: 'Film' },
      uploader: 'Ana',
    });
  });

  it('expose le sprite de survol pour une vidéo qui en a un (42.A — №78)', async () => {
    findMany.mockResolvedValue([
      {
        id: 6,
        kind: 'VIDEO',
        originalName: 'plan2.mp4',
        published: true,
        createdAt: new Date('2026-07-12T11:00:00Z'),
        thumbnailKey: 'thumbs/6.jpg',
        metadata: { timelineSprite: { key: 'sprites/6.jpg', count: 20, cols: 5, rows: 4 } },
        uploader: null,
        version: { name: 'V01', task: null, asset: { name: 'Hero', project: { id: 7, name: 'Film' } } },
      },
    ] as never);
    count.mockResolvedValue(1);
    const { items } = await listReviews(artist, {}, page);
    expect((items[0] as { hoverSprite: unknown }).hoverSprite).toEqual({
      url: 'https://minio/sprites/6.jpg',
      count: 20,
      cols: 5,
      rows: 4,
    });
  });

  it('pas de sprite de survol pour une image même avec metadata (42.A — №78)', async () => {
    findMany.mockResolvedValue([
      {
        id: 7,
        kind: 'IMAGE',
        originalName: 'ref.png',
        published: true,
        createdAt: new Date('2026-07-12T12:00:00Z'),
        thumbnailKey: null,
        metadata: { timelineSprite: { key: 'sprites/7.jpg', count: 10, cols: 5, rows: 2 } },
        uploader: null,
        version: { name: 'V01', task: null, asset: { name: 'Hero', project: { id: 7, name: 'Film' } } },
      },
    ] as never);
    count.mockResolvedValue(1);
    const { items } = await listReviews(artist, {}, page);
    expect((items[0] as { hoverSprite: unknown }).hoverSprite).toBeNull();
  });
});
