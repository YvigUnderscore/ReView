// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prisma', () => ({
  prisma: {
    setting: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    version: { findMany: vi.fn() },
    mediaObject: { findMany: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('../services/StorageService', () => ({
  storage: { deletePrefix: vi.fn(), deleteObject: vi.fn() },
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeObsoleteDerived, selectObsoleteVersionIds, __testing } from './derivedPurge';
import { prisma } from './prisma';
import { storage } from '../services/StorageService';

const setting = vi.mocked(prisma.setting.findUnique);
const taskFindMany = vi.mocked(prisma.task.findMany);
const assetFindMany = vi.mocked(prisma.asset.findMany);
const versionFindMany = vi.mocked(prisma.version.findMany);
const mediaFindMany = vi.mocked(prisma.mediaObject.findMany);
const mediaUpdate = vi.mocked(prisma.mediaObject.update);
const deletePrefix = vi.mocked(storage.deletePrefix);
const deleteObject = vi.mocked(storage.deleteObject);

type Version = { id: number; taskId: number | null; assetId: number | null };

/**
 * Base de sonde en mémoire : `nbTasks` tâches, `perTask` versions chacune, plus un asset
 * garni. Elle sert à prouver que le balayage par lots rend EXACTEMENT le même ensemble
 * que l'ancien `findMany` global — le point qui ferait de cette optimisation un bogue.
 */
function seed(nbTasks: number, perTask: number, nbAssets = 3, perAsset = 5) {
  const versions: Version[] = [];
  let id = 1;
  for (let t = 1; t <= nbTasks; t += 1)
    for (let v = 0; v < perTask; v += 1) versions.push({ id: id++, taskId: t, assetId: null });
  for (let a = 1; a <= nbAssets; a += 1)
    for (let v = 0; v < perAsset; v += 1) versions.push({ id: id++, taskId: null, assetId: a });
  return versions;
}

/** Branche les mocks Prisma sur la base de sonde, en respectant curseur/`take`/`in`. */
function wire(versions: Version[], mediaFor: (versionId: number) => number[] = () => []) {
  const taskIds = [...new Set(versions.filter((v) => v.taskId != null).map((v) => v.taskId!))].sort(
    (a, b) => a - b,
  );
  const assetIds = [...new Set(versions.filter((v) => v.assetId != null).map((v) => v.assetId!))].sort(
    (a, b) => a - b,
  );
  const page = (ids: number[], args: { take: number; cursor?: { id: number } }) => {
    const from = args.cursor ? ids.findIndex((i) => i === args.cursor!.id) + 1 : 0;
    return ids.slice(from, from + args.take).map((id) => ({ id }));
  };
  // `mockImplementation` attend la signature exacte de Prisma : on la contourne par un cast
  // de l'implémentation entière plutôt que d'annoter le paramètre en `never`, qui ne s'assigne pas.
  taskFindMany.mockImplementation(((args: { take: number; cursor?: { id: number } }) =>
    page(taskIds, args)) as never);
  assetFindMany.mockImplementation(((args: { take: number; cursor?: { id: number } }) =>
    page(assetIds, args)) as never);
  versionFindMany.mockImplementation(((args: unknown) => {
    const w = (args as { where: { taskId?: { in?: number[] } | null; assetId?: { in?: number[] } } }).where;
    const byTask = w.taskId && typeof w.taskId === 'object' ? w.taskId.in : undefined;
    const byAsset = w.assetId?.in;
    // Sans filtre de parent (l'ancienne implémentation), on rend TOUTE la table : c'est
    // exactement ce que le test veut pouvoir constater.
    const rows = byTask
      ? versions.filter((v) => v.taskId != null && byTask.includes(v.taskId))
      : byAsset
        ? versions.filter((v) => v.taskId == null && v.assetId != null && byAsset.includes(v.assetId))
        : versions;
    return rows.map((v) => ({ ...v }));
  }) as never);
  mediaFindMany.mockImplementation(((args: unknown) => {
    const ids = (args as { where: { versionId: { in: number[] } } }).where.versionId.in;
    return ids
      .flatMap((vid) =>
        mediaFor(vid).map((mid) => ({ id: mid, metadata: { hls: { renditions: ['720p'] } } })),
      )
      .sort((a, b) => a.id - b.id);
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setting.mockResolvedValue({ key: 'derived_purge', value: '{"enabled":true,"keepVersions":3}' });
  deletePrefix.mockResolvedValue(undefined);
  deleteObject.mockResolvedValue(undefined);
  mediaUpdate.mockResolvedValue({} as never);
});

describe('purgeObsoleteDerived — équivalence stricte avec le chargement global (PERF-07)', () => {
  it('purge exactement les mêmes médias que l’ancien « toute la table en mémoire »', async () => {
    // 450 tâches > PURGE_PARENT_BATCH (200) : le balayage fait donc plusieurs pages.
    const versions = seed(450, 6, 4, 7);
    // Un média vidéo par version, d'id = id de version (bijection commode pour comparer).
    wire(versions, (vid) => [vid]);

    const { purged } = await purgeObsoleteDerived();

    // La référence : ce que l'ancienne implémentation aurait calculé d'un bloc.
    const expected = selectObsoleteVersionIds(versions, 3).sort((a, b) => a - b);
    const touched = mediaUpdate.mock.calls
      .map((c) => (c[0] as { where: { id: number } }).where.id)
      .sort((a, b) => a - b);
    expect(touched).toEqual(expected);
    expect(purged).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(1000); // la sonde est bien à l'échelle
  });

  it('ne charge jamais toute la table : chaque requête Version est bornée par un lot de parents', async () => {
    const versions = seed(450, 6, 4, 7);
    wire(versions, () => []);

    await purgeObsoleteDerived();

    // C'est la mesure du correctif : le nombre de LIGNES rapatriées par requête.
    const biggest = Math.max(...versionFindMany.mock.results.map((r) => (r.value as Version[]).length));
    expect(biggest).toBeLessThanOrEqual(__testing.PURGE_PARENT_BATCH * 6);
    expect(biggest).toBeLessThan(versions.length); // 2 728 lignes d'un bloc auparavant
    // Aucune requête sans filtre de parent : `where` porte toujours un `in`.
    for (const call of versionFindMany.mock.calls) {
      const w = (call[0] as { where: Record<string, unknown> }).where;
      expect('taskId' in w || 'assetId' in w).toBe(true);
    }
  });

  it('une version portant une tâche n’est comptée qu’une fois (priorité tâche sur asset)', async () => {
    // Cas limite : `selectObsoleteVersionIds` groupe par tâche quand les deux sont posés.
    const versions: Version[] = [
      { id: 1, taskId: 5, assetId: 9 },
      { id: 2, taskId: 5, assetId: 9 },
      { id: 3, taskId: 5, assetId: 9 },
      { id: 4, taskId: null, assetId: 9 },
    ];
    wire(versions, (vid) => [vid]);
    setting.mockResolvedValue({ value: '{"enabled":true,"keepVersions":1}' } as never);

    await purgeObsoleteDerived();

    const touched = mediaUpdate.mock.calls.map((c) => (c[0] as { where: { id: number } }).where.id).sort();
    // Groupe tâche 5 = {1,2,3} → purge 1 et 2 ; groupe asset 9 = {4} seul → rien.
    expect(touched).toEqual(selectObsoleteVersionIds(versions, 1).sort());
    expect(touched).toEqual([1, 2]);
  });

  it('le budget d’une passe borne le travail, et la passe suivante reprend', async () => {
    const versions = seed(50, 10, 0, 0);
    wire(versions, (vid) => [vid]);

    const { purged } = await purgeObsoleteDerived(20);
    expect(purged).toBe(20);
    expect(mediaUpdate).toHaveBeenCalledTimes(20);
    // Deux appels MinIO par média, lancés ensemble et non l'un après l'autre.
    expect(deletePrefix).toHaveBeenCalledTimes(20);
  });

  it('purge désactivée : aucune requête, pas même la liste des parents', async () => {
    setting.mockResolvedValue({ value: '{"enabled":false}' } as never);
    expect(await purgeObsoleteDerived()).toEqual({ purged: 0 });
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(versionFindMany).not.toHaveBeenCalled();
  });

  it('un média déjà allégé n’est ni retouché ni compté', async () => {
    const versions = seed(1, 5, 0, 0);
    wire(versions, () => []);
    mediaFindMany.mockImplementation(
      () =>
        [
          { id: 1, metadata: { hlsPurged: true } },
          { id: 2, metadata: {} },
        ] as never,
    );

    const { purged } = await purgeObsoleteDerived();
    expect(purged).toBe(0);
    expect(mediaUpdate).not.toHaveBeenCalled();
    expect(deletePrefix).not.toHaveBeenCalled();
  });
});
