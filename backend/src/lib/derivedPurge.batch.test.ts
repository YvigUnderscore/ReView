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
vi.mock('./storage', () => ({
  storage: { deletePrefix: vi.fn(), deleteObject: vi.fn() },
}));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { purgeObsoleteDerived, selectObsoleteVersionIds, __testing } from './derivedPurge';
import { prisma } from './prisma';
import { storage } from './storage';

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
 * In-memory probe database: `nbTasks` tasks, `perTask` versions each, plus a stocked asset. It proves
 * that the batched sweep returns EXACTLY the same set as the former global `findMany` — the point that
 * would make this optimisation a bug.
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

/** Wires the Prisma mocks to the probe database, honouring cursor / `take` / `in`. */
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
  // `mockImplementation` expects Prisma's exact signature: the whole implementation is cast rather than
  // annotating the parameter as `never`, which does not assign.
  taskFindMany.mockImplementation(((args: { take: number; cursor?: { id: number } }) =>
    page(taskIds, args)) as never);
  assetFindMany.mockImplementation(((args: { take: number; cursor?: { id: number } }) =>
    page(assetIds, args)) as never);
  versionFindMany.mockImplementation(((args: unknown) => {
    const w = (args as { where: { taskId?: { in?: number[] } | null; assetId?: { in?: number[] } } }).where;
    const byTask = w.taskId && typeof w.taskId === 'object' ? w.taskId.in : undefined;
    const byAsset = w.assetId?.in;
    // Without a parent filter (the former implementation), the WHOLE table is returned: exactly what the
    // test must be able to observe.
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

describe('purgeObsoleteDerived — strict equivalence with the global load (PERF-07)', () => {
  it('purges exactly the same media as the former "whole table in memory"', async () => {
    // 450 tasks > PURGE_PARENT_BATCH (200): the sweep therefore takes several pages.
    const versions = seed(450, 6, 4, 7);
    // One video media per version, id = version id (a convenient bijection for comparison).
    wire(versions, (vid) => [vid]);

    const { purged } = await purgeObsoleteDerived();

    // The reference: what the former implementation would have computed in one block.
    const expected = selectObsoleteVersionIds(versions, 3).sort((a, b) => a - b);
    const touched = mediaUpdate.mock.calls
      .map((c) => (c[0] as { where: { id: number } }).where.id)
      .sort((a, b) => a - b);
    expect(touched).toEqual(expected);
    expect(purged).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(1000); // the probe is indeed at scale
  });

  it('never loads the whole table: each Version query is bounded by a batch of parents', async () => {
    const versions = seed(450, 6, 4, 7);
    wire(versions, () => []);

    await purgeObsoleteDerived();

    // This is the measure of the fix: the number of ROWS fetched per query.
    const biggest = Math.max(...versionFindMany.mock.results.map((r) => (r.value as Version[]).length));
    expect(biggest).toBeLessThanOrEqual(__testing.PURGE_PARENT_BATCH * 6);
    expect(biggest).toBeLessThan(versions.length); // 2,728 rows in one block before
    // No query without a parent filter: `where` always carries an `in`.
    for (const call of versionFindMany.mock.calls) {
      const w = (call[0] as { where: Record<string, unknown> }).where;
      expect('taskId' in w || 'assetId' in w).toBe(true);
    }
  });

  it('a version carrying a task is counted only once (task priority over asset)', async () => {
    // Edge case: `selectObsoleteVersionIds` groups by task when both are set.
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
    // Task group 5 = {1,2,3} → purge 1 and 2; asset group 9 = {4} alone → nothing.
    expect(touched).toEqual(selectObsoleteVersionIds(versions, 1).sort());
    expect(touched).toEqual([1, 2]);
  });

  it('one pass budget bounds the work, and the next pass resumes', async () => {
    const versions = seed(50, 10, 0, 0);
    wire(versions, (vid) => [vid]);

    const { purged } = await purgeObsoleteDerived(20);
    expect(purged).toBe(20);
    expect(mediaUpdate).toHaveBeenCalledTimes(20);
    // Two MinIO calls per media, launched together rather than one after the other.
    expect(deletePrefix).toHaveBeenCalledTimes(20);
  });

  it('purge disabled: no query, not even the list of parents', async () => {
    setting.mockResolvedValue({ value: '{"enabled":false}' } as never);
    expect(await purgeObsoleteDerived()).toEqual({ purged: 0 });
    expect(taskFindMany).not.toHaveBeenCalled();
    expect(versionFindMany).not.toHaveBeenCalled();
  });

  it('a media already slimmed is neither touched nor counted', async () => {
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
