// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The connector's safety invariants, applied to the Episode entity: the project filter goes with the request, and the entity received
 * is rechecked on arrival. A site hosts all the studio's projects: writing into the wrong one cannot be undone.
 */

const { db } = vi.hoisted(() => ({
  db: {
    project: { findUnique: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
    shotgridLink: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
    episode: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    sequence: { updateMany: vi.fn() },
  },
}));

vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  assertEpisodeCreationAllowed,
  episodeCode,
  linkSequencesToEpisodes,
  pullEpisodes,
  pullSequenceEpisodes,
  type EpisodePullContext,
} from './ShotgridEpisodes';

const journal = {
  count: vi.fn(),
  log: vi.fn().mockResolvedValue(undefined),
  conflict: vi.fn().mockResolvedValue(undefined),
};

const makeCtx = (records: Record<string, unknown>[]): EpisodePullContext =>
  ({
    connection: {
      id: 1,
      projectId: 7,
      sgProjectId: 99,
      sgProjectName: 'SERIE',
      site: { baseUrl: 'https://studio.shotgrid.autodesk.com' },
    },
    client: { search: vi.fn().mockResolvedValue(records), findById: vi.fn() },
    settings: { domains: { hierarchy: { read: true, write: true } } },
    journal,
    scope: { sgProjectId: 99, sgProjectName: 'SERIE' },
  }) as unknown as EpisodePullContext;

const inProject = (over: Record<string, unknown> = {}) => ({
  id: 500,
  type: 'Episode',
  code: 'EP101',
  project: { id: 99, type: 'Project' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.project.findUnique.mockResolvedValue({ episodesEnabled: true });
  db.shotgridLink.findMany.mockResolvedValue([]);
  db.shotgridLink.findFirst.mockResolvedValue(null);
  db.episode.findUnique.mockResolvedValue(null);
  db.episode.create.mockResolvedValue({ id: 11 });
  db.episode.update.mockResolvedValue({ id: 11 });
});

describe('episodeCode', () => {
  it('falls back to a stable code when the site gives none', () => {
    expect(episodeCode({ id: 42, type: 'Episode' })).toBe('EP42');
    expect(episodeCode({ id: 42, type: 'Episode', code: 'EP101' })).toBe('EP101');
  });
});

describe('assertEpisodeCreationAllowed', () => {
  it('allows creation when the project is linked to no site', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    await expect(assertEpisodeCreationAllowed(7)).resolves.toBeUndefined();
  });

  it('points to the site\'s Episode form, not to that of a Sequence', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue({
      active: true,
      settings: {},
      sgProjectId: 99,
      sgProjectName: 'SERIE',
      site: { baseUrl: 'https://studio.shotgrid.autodesk.com' },
    });
    await expect(assertEpisodeCreationAllowed(7)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SHOTGRID_LOCKED',
      sgCreateUrl: 'https://studio.shotgrid.autodesk.com/new/Episode?project=99',
    });
  });
});

describe('pullEpisodes', () => {
  it('reads nothing while the level is off on the ReView side', async () => {
        // Importing into a project that does not show the level would create rows that
        // nobody can see or correct.
    db.project.findUnique.mockResolvedValue({ episodesEnabled: false });
    const ctx = makeCtx([inProject()]);
    await pullEpisodes(ctx);
    expect(ctx.client.search).not.toHaveBeenCalled();
    expect(db.episode.create).not.toHaveBeenCalled();
  });

  it('reads nothing when the hierarchy domain is closed for reading', async () => {
    const ctx = makeCtx([]);
    (ctx.settings as unknown as { domains: Record<string, unknown> }).domains = {
      hierarchy: { read: false, write: false },
    };
    await pullEpisodes(ctx);
    expect(ctx.client.search).not.toHaveBeenCalled();
  });

  it('attaches the project filter to the query', async () => {
    const ctx = makeCtx([]);
    await pullEpisodes(ctx);
    expect(ctx.client.search).toHaveBeenCalledWith(
      'Episode',
      expect.objectContaining({
        filters: [['project', 'is', { type: 'Project', id: 99 }]],
      }),
    );
  });

  it('discards an entity from another project and shouts it to the log', async () => {
    const ctx = makeCtx([inProject({ project: { id: 1234, type: 'Project' } })]);
    await pullEpisodes(ctx);
    expect(db.episode.create).not.toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.wrongProject',
      expect.objectContaining({ expected: 99, found: 1234 }),
      expect.anything(),
    );
  });

  it('creates the episode and sets the match', async () => {
    const ctx = makeCtx([inProject({ updated_at: '2026-08-01T10:00:00Z' })]);
    await pullEpisodes(ctx);
    expect(db.episode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'EP101', name: 'EP101', projectId: 7, order: 0 }),
    });
    expect(db.shotgridLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId_sgType_sgId: { connectionId: 1, sgType: 'Episode', sgId: 500 } },
      }),
    );
    expect(journal.count).toHaveBeenCalledWith('episodes', 'created');
  });

  it('does not renumber the order on a targeted re-read', async () => {
        // Otherwise processing a single event would bring the episode to the top of the list.
    const ctx = makeCtx([]);
    (ctx.client.findById as ReturnType<typeof vi.fn>).mockResolvedValue(inProject());
    await pullEpisodes(ctx, new Map(), { onlySgIds: [{ sgType: 'Episode', sgId: 500 }] });
    const data = db.episode.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.data.order).toBeUndefined();
  });
});

describe('linkSequencesToEpisodes', () => {
  const sequenceLinks = new Map([[300, { localId: 30 } as never]]);

  it('leaves the sequence detached when its remote episode is not linked', async () => {
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    const ctx = makeCtx([]);
    await linkSequencesToEpisodes(
      ctx,
      [{ id: 300, type: 'Sequence', sg_episode: { id: 777, type: 'Episode' } }],
      sequenceLinks,
    );
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: 30, projectId: 7 },
      data: { episodeId: null },
    });
  });

  it('attaches when both sides are linked, bounding to the project', async () => {
    db.shotgridLink.findMany.mockResolvedValue([
      { sgId: 777, localId: 11, localType: 'episode', sgType: 'Episode' },
    ]);
    db.sequence.updateMany.mockResolvedValue({ count: 1 });
    const ctx = makeCtx([]);
    const updated = await linkSequencesToEpisodes(
      ctx,
      [{ id: 300, type: 'Sequence', sg_episode: { id: 777, type: 'Episode' } }],
      sequenceLinks,
    );
    expect(updated).toBe(1);
    expect(db.sequence.updateMany).toHaveBeenCalledWith({
      where: { id: 30, projectId: 7 },
      data: { episodeId: 11 },
    });
  });

  it('ignores a sequence that has no local counterpart', async () => {
    const ctx = makeCtx([]);
    await linkSequencesToEpisodes(ctx, [{ id: 999, type: 'Sequence' }], sequenceLinks);
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
  });
});

describe('pullSequenceEpisodes', () => {
  it('does not ask the site for `sg_episode` while the level is off', async () => {
        // A studio without a series does not necessarily have this field: claiming it would make the synchronization
        // fail for everyone, for a level nobody has enabled.
    db.project.findUnique.mockResolvedValue({ episodesEnabled: false });
    const ctx = makeCtx([]);
    expect(await pullSequenceEpisodes(ctx)).toBe(0);
    expect(ctx.client.search).not.toHaveBeenCalled();
  });

  it('queries the linked project\'s sequences on the episode field alone', async () => {
    const ctx = makeCtx([]);
    await pullSequenceEpisodes(ctx);
    expect(ctx.client.search).toHaveBeenCalledWith(
      'Sequence',
      expect.objectContaining({
        fields: ['project', 'updated_at', 'sg_episode'],
        filters: [['project', 'is', { type: 'Project', id: 99 }]],
      }),
    );
  });

  it('discards a sequence from another project before any write', async () => {
    const ctx = makeCtx([
      { id: 300, type: 'Sequence', project: { id: 1234, type: 'Project' }, sg_episode: null },
    ]);
    expect(await pullSequenceEpisodes(ctx)).toBe(0);
    expect(db.sequence.updateMany).not.toHaveBeenCalled();
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
  });
});
