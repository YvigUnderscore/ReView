// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file: the doubles must be too.
const { findBySg } = vi.hoisted(() => ({ findBySg: vi.fn() }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({ findBySg: (...args: unknown[]) => findBySg(...args) }));

import { importableVersionIds } from './ShotgridSyncService';
import type { PullContext } from './ShotgridPullService';

function contextWith(statusFilter: string[], records: Record<number, unknown>) {
  const journal = { count: vi.fn(), log: vi.fn(async () => undefined) };
  const findById = vi.fn(async (_entity: string, id: number) => records[id] ?? null);
  const ctx = {
    connection: { id: 1, projectId: 42, sgProjectId: 77 },
    settings: { media: { statusFilter } },
    scope: { sgProjectId: 77, sgProjectName: 'ALPHA' },
    journal,
    client: { findById },
  } as unknown as PullContext;
  return { ctx, journal, findById };
}

const version = (id: number, status: string, projectId = 77) => ({
  type: 'Version',
  id,
  sg_status_list: status,
  project: { type: 'Project', id: projectId, name: 'ALPHA' },
});

beforeEach(() => {
  vi.clearAllMocks();
  findBySg.mockResolvedValue(null);
});

/**
 * Passing the targeted identifiers to `pullVersions` makes the studio's status filter fall away — the service reads it as the sign of a manual selection. On a webhook,
 * that would fetch the media of all the WIPs of a site where the studio only follows the versions in review. The filter is therefore replayed here, with the project isolation.
 */
describe('importableVersionIds', () => {
  it('discards a new version outside the status filter', async () => {
    const { ctx, journal } = contextWith(['rev'], { 9: version(9, 'wip') });

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
    expect(journal.count).toHaveBeenCalledWith('versions', 'skipped');
  });

  it('keeps a new version within the filter', async () => {
    const { ctx } = contextWith(['rev'], { 9: version(9, 'rev') });
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
  });

  it('keeps an already linked version whatever its status', async () => {
    // The filter decides what we import, not what we keep following: a version moved from "in review" to "approved" must see its status advance.
    findBySg.mockResolvedValue({ localId: 3, sgId: 9 });
    const { ctx, findById } = contextWith(['rev'], {});

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
    // Already linked: no need to re-read it to decide.
    expect(findById).not.toHaveBeenCalled();
  });

  it('keeps everything when the studio has set no filter', async () => {
    const { ctx } = contextWith([], { 9: version(9, 'wip') });
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
  });

  it('refuses a version belonging to another project of the site', async () => {
    // An identifier received by webhook proves nothing: writing into the wrong project cannot be undone.
    const { ctx, journal } = contextWith([], { 9: version(9, 'rev', 78) });

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.wrongProject',
      expect.objectContaining({ sgType: 'Version', sgId: 9, expected: 77, found: 78 }),
      expect.objectContaining({ sgType: 'Version', sgId: 9 }),
    );
  });

  it('ignores a version that has disappeared from the site', async () => {
    const { ctx } = contextWith([], {});
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
  });

  it('only looks at identifiers of type Version', async () => {
    const { ctx, findById } = contextWith([], { 9: version(9, 'rev') });
    const kept = await importableVersionIds(ctx, [
      { sgType: 'Shot', sgId: 4 },
      { sgType: 'Version', sgId: 9 },
    ]);
    expect(kept).toEqual([9]);
    expect(findById).toHaveBeenCalledTimes(1);
  });
});
