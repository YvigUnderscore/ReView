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

import { listPublished, listReviews } from './MediaService';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { checkProjectAccess } from '../middleware/rbac';
import { MediaKind, MediaStatus, Role } from '@prisma/client';

const findMany = vi.mocked(prisma.mediaObject.findMany);
const count = vi.mocked(prisma.mediaObject.count);
const presign = vi.mocked(storage.getPresignedGetUrl);
const access = vi.mocked(checkProjectAccess);

const artist = { id: 3, role: Role.ARTIST };
const page = { page: 1, pageSize: 500, order: 'desc' as const };

/** Une page de `n` médias, chacun avec sa miniature et sa clé de lecture (2 signatures/média). */
function fakeMedia(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    kind: MediaKind.IMAGE,
    originalName: `plan_${i + 1}.png`,
    published: true,
    createdAt: new Date(2026, 0, 1 + (i % 28)),
    status: MediaStatus.READY,
    storageKey: `projects/p/plan_${i + 1}.png`,
    thumbnailKey: `derived/${i + 1}/thumbnail.jpg`,
    metadata: null,
    versionId: 100 + i,
    uploaderId: 3,
  }));
}

/**
 * Compte les tours de boucle d'événements traversés pendant `run`.
 *
 * C'est LA mesure du défaut PERF-09 : la signature SigV4 se résout en microtâches, donc un
 * `Promise.all` sur toute la page ne rend jamais la main — aucune autre requête du process
 * n'est servie entre le premier et le dernier média. On compte donc des tours de boucle,
 * pas des millisecondes.
 */
async function countEventLoopTurns<T>(run: () => Promise<T>): Promise<{ turns: number; value: T }> {
  let turns = 0;
  let alive = true;
  const beat = (): void => {
    if (!alive) return;
    turns += 1;
    setImmediate(beat);
  };
  setImmediate(beat);
  const value = await run();
  alive = false;
  return { turns, value };
}

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(true);
  presign.mockImplementation(async (k: string) => `https://minio/${k}`);
  count.mockResolvedValue(0);
});

describe('MediaService — la signature des listes rend la main à la boucle (PERF-09)', () => {
  it('listPublished : une page de 500 médias laisse passer les autres requêtes', async () => {
    const media = fakeMedia(500);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns, value } = await countEventLoopTurns(() => listPublished(artist, 7, undefined, page));

    // 500 médias / 25 par tranche = 20 tranches, donc au moins 19 reprises de boucle.
    // Sans le découpage, `Promise.all` sur les 500 en rend exactement 0.
    expect(turns).toBeGreaterThanOrEqual(19);
    // 2 signatures par média, aucune de moins : le correctif ne retire rien de la réponse.
    expect(presign).toHaveBeenCalledTimes(1000);
    expect(value.items).toHaveLength(500);
  });

  it('listPublished : sortie identique à une signature d’un seul bloc (mêmes lignes, même ordre)', async () => {
    const media = fakeMedia(120);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const out = await listPublished(artist, 7, undefined, { ...page, pageSize: 120 });

    // La référence est construite ici exactement comme le faisait l'ancien `Promise.all`.
    const expected = await Promise.all(
      media.map(async (m) => ({
        id: m.id,
        kind: m.kind,
        originalName: m.originalName,
        thumbnailUrl: await storage.getPresignedGetUrl(m.thumbnailKey),
        url: await storage.getPresignedGetUrl(m.storageKey),
      })),
    );
    expect(out.items).toEqual(expected);
    expect(out.total).toBe(120);
  });

  it('petite page : aucun découpage inutile sous le seuil', async () => {
    const media = fakeMedia(10);
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns } = await countEventLoopTurns(() =>
      listPublished(artist, 7, undefined, { ...page, pageSize: 10 }),
    );
    expect(turns).toBe(0);
  });

  it('listReviews : même découpage sur la page Reviews globale', async () => {
    const media = fakeMedia(200).map((m) => ({
      ...m,
      kind: MediaKind.VIDEO,
      metadata: { timelineSprite: { key: `derived/${m.id}/sprite.jpg`, count: 10, cols: 5, rows: 2 } },
      uploader: { id: 3, name: 'Artiste' },
      version: { name: 'V01', reviewStatus: null, task: null, asset: null },
    }));
    findMany.mockResolvedValue(media as never);
    count.mockResolvedValue(media.length);

    const { turns, value } = await countEventLoopTurns(() =>
      listReviews(artist, {}, { ...page, pageSize: 200 }),
    );

    expect(turns).toBeGreaterThanOrEqual(7); // 200 / 25 = 8 tranches
    expect(presign).toHaveBeenCalledTimes(400); // miniature + sprite par média
    expect(value.items).toHaveLength(200);
  });
});
