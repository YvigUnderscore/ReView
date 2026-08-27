// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    comment: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    version: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn(), count: vi.fn() },
    project: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('./StorageService', () => ({
  storage: { getPresignedGetUrl: vi.fn(async (k: string) => `https://minio/${k}`) },
}));
// L'accueil montre la même image qu'ailleurs : la vignette du projet, sinon celle de son
// premier média publié. L'élection groupée est testée dans `lib/thumbnails`.
vi.mock('../lib/thumbnails', () => ({
  effectiveThumbnailUrl: vi.fn(async (key: string | null, fallback: string | null) => {
    const chosen = key ?? fallback;
    return chosen ? `https://minio/${chosen}` : null;
  }),
  firstMediaThumbKeysForProjects: vi.fn(async () => new Map<number, string>()),
}));

import { getDashboard } from './DashboardService';
import { prisma } from '../lib/prisma';
import { firstMediaThumbKeysForProjects } from '../lib/thumbnails';
import { Role, TaskStatus } from '@prisma/client';

const comments = vi.mocked(prisma.comment.findMany);
const versions = vi.mocked(prisma.version.findMany);
const media = vi.mocked(prisma.mediaObject.findMany);
const tasks = vi.mocked(prisma.task.findMany);
const queryRaw = vi.mocked(prisma.$queryRaw);

const artist = { id: 3, role: Role.ARTIST };

function stubEmpty() {
  comments.mockResolvedValue([] as never);
  versions.mockResolvedValue([] as never);
  media.mockResolvedValue([] as never);
  tasks.mockResolvedValue([] as never);
  queryRaw.mockResolvedValue([] as never);
  vi.mocked(prisma.project.count).mockResolvedValue(2);
  vi.mocked(prisma.project.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.mediaObject.count).mockResolvedValue(5);
  // Le compteur global (5) puis la fenêtre 7 jours (1) — l'ordre des appels de getDashboard.
  vi.mocked(prisma.mediaObject.count).mockResolvedValueOnce(5).mockResolvedValueOnce(1);
  vi.mocked(prisma.comment.count).mockResolvedValue(11);
  vi.mocked(prisma.comment.count).mockResolvedValueOnce(11).mockResolvedValueOnce(3);
  vi.mocked(prisma.comment.groupBy).mockResolvedValue([] as never);
  // Mes retakes (1) puis verdicts attendus (4) — l'ordre des appels de getDashboard.
  vi.mocked(prisma.task.count).mockResolvedValueOnce(1).mockResolvedValueOnce(4);
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

  it('renvoie les stats agrégées, tendances 7 jours et compteurs personnels compris', async () => {
    const { stats } = await getDashboard(artist);
    expect(stats).toEqual({
      projects: 2,
      publishedMedia: 5,
      comments: 11,
      publishedMedia7d: 1,
      comments7d: 3,
      myRetakes: 1,
      pendingReview: 4,
    });
  });

  it('calcule la progression des projets récents (tâches approuvées / total)', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: 'thumbs/p7.jpg' },
    ] as never);
    // Un seul agrégat remplace les deux `count` par projet : 6 approuvées sur 10.
    queryRaw.mockResolvedValue([
      {
        projectId: 7,
        status: TaskStatus.APPROVED,
        isDone: null,
        isInactive: null,
        legacyStatus: null,
        count: 6,
      },
      { projectId: 7, status: TaskStatus.TODO, isDone: null, isInactive: null, legacyStatus: null, count: 4 },
    ] as never);
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects).toEqual([
      { id: 7, name: 'Dock', thumbnailUrl: 'https://minio/thumbs/p7.jpg', totalTasks: 10, approvedTasks: 6 },
    ]);
  });

  it('montre le premier média du projet quand aucune vignette n’a été choisie', async () => {
    // L'accueil s'en tenait à `thumbnailKey` : un projet plein de travail livré y restait
    // sans image, alors que sa carte en portait une dans la liste des projets.
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: null },
    ] as never);
    vi.mocked(firstMediaThumbKeysForProjects).mockResolvedValue(new Map([[7, 'derived/9/thumb.webp']]));
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects[0]!.thumbnailUrl).toBe('https://minio/derived/9/thumb.webp');
  });

  it('ne pose plus deux comptes par projet récent : un seul agrégat, cinq projets', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `P${i}`, thumbnailKey: null })) as never,
    );
    await getDashboard(artist);
    // Deux `task.count` en tout (mes retakes, verdicts attendus) — plus aucun par projet.
    expect(vi.mocked(prisma.task.count)).toHaveBeenCalledTimes(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // Les cinq identifiants voyagent en paramètres du même agrégat.
    expect(JSON.stringify(queryRaw.mock.calls[0]!.slice(1))).toContain('5');
  });

  it('n’interroge pas la base quand aucun projet récent n’est à afficher', async () => {
    await getDashboard(artist);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('lit le référentiel du studio : terminal compte comme fait, inactif ne compte pas', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: 7, name: 'Dock', thumbnailKey: null },
    ] as never);
    queryRaw.mockResolvedValue([
      // « fin » : terminal côté site, l'enum local dit encore IN_PROGRESS.
      {
        projectId: 7,
        status: TaskStatus.IN_PROGRESS,
        isDone: true,
        isInactive: false,
        legacyStatus: TaskStatus.APPROVED,
        count: 3,
      },
      // « omt » : omis — hors de toute jauge, ni au numérateur ni au dénominateur.
      {
        projectId: 7,
        status: TaskStatus.REJECTED,
        isDone: false,
        isInactive: true,
        legacyStatus: TaskStatus.REJECTED,
        count: 5,
      },
      {
        projectId: 7,
        status: TaskStatus.TODO,
        isDone: false,
        isInactive: false,
        legacyStatus: TaskStatus.TODO,
        count: 1,
      },
    ] as never);
    const { recentProjects } = await getDashboard(artist);
    expect(recentProjects[0]).toMatchObject({ totalTasks: 4, approvedTasks: 3 });
  });

  it('exclut de « mes tâches » et des compteurs ce que le studio tient pour terminé ou inactif', async () => {
    await getDashboard(artist);
    const myTasksWhere = JSON.stringify(tasks.mock.calls[0]![0]!.where);
    expect(myTasksWhere).toContain('"isDone":false');
    expect(myTasksWhere).toContain('"isInactive":false');
    for (const call of vi.mocked(prisma.task.count).mock.calls) {
      expect(JSON.stringify(call[0]!.where)).toContain('"isInactive":false');
    }
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
        commentCount: 0,
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
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH001', sequence: null },
        asset: null,
      })),
      {
        id: 1,
        name: 'retake',
        type: 'FX',
        status: 'RETAKE',
        pipelineStatus: null,
        shot: null,
        asset: { projectId: 2, name: 'Robot' },
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 20 + i,
        name: `p${i}`,
        type: 'OTHER',
        status: 'PENDING_REVIEW',
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH002', sequence: null },
        asset: null,
      })),
    ] as never);
    const { myTasks } = await getDashboard(artist);
    expect(myTasks).toHaveLength(8);
    expect(myTasks[0]).toMatchObject({ id: 1, status: 'RETAKE', location: 'Robot', projectId: 2 });
    expect(myTasks.slice(1, 5).every((t) => t.status === 'PENDING_REVIEW')).toBe(true);
  });

  it('ordonne mes tâches sur la famille du statut personnalisé, pas sur l’enum local', async () => {
    tasks.mockResolvedValue([
      {
        id: 10,
        name: 'à faire',
        type: 'OTHER',
        status: 'TODO',
        pipelineStatus: null,
        shot: { projectId: 1, code: 'SH001', sequence: null },
        asset: null,
      },
      {
        // Statut « rtk » du site : l'enum local dit IN_PROGRESS, la famille dit « bloqué ».
        id: 11,
        name: 'retake du site',
        type: 'OTHER',
        status: 'IN_PROGRESS',
        pipelineStatus: { isDone: false, isInactive: false, legacyStatus: 'RETAKE' },
        shot: { projectId: 1, code: 'SH002', sequence: null },
        asset: null,
      },
    ] as never);
    const { myTasks } = await getDashboard(artist);
    expect(myTasks.map((t) => t.id)).toEqual([11, 10]);
  });
});
