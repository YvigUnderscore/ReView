import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    comment: { findMany: vi.fn(), count: vi.fn() },
    version: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn() },
    project: { count: vi.fn() },
  },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));

import { getDashboard } from './DashboardService';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

const comments = vi.mocked(prisma.comment.findMany);
const versions = vi.mocked(prisma.version.findMany);
const media = vi.mocked(prisma.mediaObject.findMany);
const tasks = vi.mocked(prisma.task.findMany);

const artist = { id: 3, role: Role.ARTIST };

function stubEmpty() {
  comments.mockResolvedValue([] as never);
  versions.mockResolvedValue([] as never);
  media.mockResolvedValue([] as never);
  tasks.mockResolvedValue([] as never);
  vi.mocked(prisma.project.count).mockResolvedValue(2 as never);
  vi.mocked(prisma.mediaObject.count).mockResolvedValue(5 as never);
  vi.mocked(prisma.comment.count).mockResolvedValue(11 as never);
}

describe('DashboardService.getDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubEmpty();
  });

  it('borne les requêtes aux projets du membre (filtre membership pour un ARTIST)', async () => {
    await getDashboard(artist);
    const projectWhere = vi.mocked(prisma.project.count).mock.calls[0]![0]!.where;
    expect(projectWhere).toEqual({ deletedAt: null, memberships: { some: { userId: 3 } } });
  });

  it('ne filtre pas par membership pour un ADMIN', async () => {
    await getDashboard({ id: 1, role: Role.ADMIN });
    const projectWhere = vi.mocked(prisma.project.count).mock.calls[0]![0]!.where;
    expect(projectWhere).toEqual({ deletedAt: null });
  });

  it('renvoie les stats agrégées', async () => {
    const { stats } = await getDashboard(artist);
    expect(stats).toEqual({ projects: 2, publishedMedia: 5, comments: 11 });
  });

  it('mappe les dernières reviews avec miniature présignée et dernier commentaire', async () => {
    comments.mockResolvedValue([
      {
        content: 'À reprendre sur le raccord',
        timestamp: 4.2,
        createdAt: new Date('2026-07-12T10:00:00Z'),
        author: { id: 2, name: 'Ana' },
        guestName: null,
        media: {
          id: 9,
          kind: 'VIDEO',
          originalName: 'sh010_comp.mov',
          thumbnailKey: 'thumbs/9.jpg',
          version: {
            name: 'V02',
            task: { id: 4, name: 'Compositing', shot: { code: 'SH010', sequence: { code: 'SQ01' } } },
            asset: null,
          },
        },
      },
    ] as never);
    const { latestReviews } = await getDashboard(artist);
    expect(latestReviews).toEqual([
      {
        mediaId: 9,
        kind: 'VIDEO',
        name: 'sh010_comp.mov',
        thumbnailUrl: 'https://minio/thumbs/9.jpg',
        location: 'SQ01 · SH010',
        versionName: 'V02',
        lastComment: {
          content: 'À reprendre sur le raccord',
          author: 'Ana',
          timestamp: 4.2,
          createdAt: new Date('2026-07-12T10:00:00Z'),
        },
      },
    ]);
  });

  it('fusionne versions + médias dans le flux, triés du plus récent au plus ancien', async () => {
    versions.mockResolvedValue([
      {
        name: 'V03',
        createdAt: new Date('2026-07-12T08:00:00Z'),
        author: { id: 2, name: 'Ana' },
        task: { id: 4, name: 'Comp', shot: { code: 'SH010', sequence: null } },
        asset: null,
      },
    ] as never);
    media.mockResolvedValue([
      {
        id: 9,
        originalName: 'plan.mp4',
        createdAt: new Date('2026-07-12T09:00:00Z'),
        uploader: { id: 3, name: 'Bob' },
        version: { name: 'V01', task: null, asset: { name: 'Vaisseau' } },
      },
    ] as never);
    const { activity } = await getDashboard(artist);
    expect(activity.map((a) => a.type)).toEqual(['media', 'version']);
    expect(activity[0]).toMatchObject({ label: 'plan.mp4', location: 'Vaisseau', mediaId: 9 });
    expect(activity[1]).toMatchObject({ label: 'V03 — Comp', location: 'SH010', taskId: 4 });
  });

  it('trie mes tâches par priorité de statut (RETAKE avant TODO) et borne à 8', async () => {
    tasks.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => ({
        id: 10 + i,
        name: `t${i}`,
        type: 'OTHER',
        status: 'TODO',
        shot: { projectId: 1, code: 'SH001', sequence: null },
        asset: null,
      })),
      {
        id: 1,
        name: 'retake',
        type: 'FX',
        status: 'RETAKE',
        shot: null,
        asset: { projectId: 2, name: 'Robot' },
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 20 + i,
        name: `p${i}`,
        type: 'OTHER',
        status: 'PENDING_REVIEW',
        shot: { projectId: 1, code: 'SH002', sequence: null },
        asset: null,
      })),
    ] as never);
    const { myTasks } = await getDashboard(artist);
    expect(myTasks).toHaveLength(8);
    expect(myTasks[0]).toMatchObject({ id: 1, status: 'RETAKE', location: 'Robot', projectId: 2 });
    expect(myTasks.slice(1, 5).every((t) => t.status === 'PENDING_REVIEW')).toBe(true);
  });
});
