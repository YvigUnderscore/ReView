// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { playlist, playlistItem, links, touch } = vi.hoisted(() => ({
  playlist: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  playlistItem: { deleteMany: vi.fn(), createMany: vi.fn() },
  links: { mapSgToLocal: vi.fn(), upsertLink: vi.fn(), findByLocal: vi.fn() },
  touch: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { playlist, playlistItem } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./ShotgridPullService', () => ({ touch: (...args: unknown[]) => touch(...args) }));
vi.mock('./shotgridSettings', () => ({ can: () => true }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: (...args: unknown[]) => links.mapSgToLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
}));

import { pullPlaylists } from './ShotgridPlaylistSync';
import type { PullContext } from './ShotgridPullService';

function contextWith(records: unknown[]) {
  const journal = { count: vi.fn(), log: vi.fn(async () => undefined) };
  const search = vi.fn(
    async (_entity: string, _options: { filters: unknown[]; maxRecords: number }) => records,
  );
  const ctx = {
    connection: { id: 1, projectId: 42, sgProjectId: 77 },
    settings: {},
    scope: { sgProjectId: 77, sgProjectName: 'ALPHA' },
    journal,
    client: { search },
  } as unknown as PullContext;
  return { ctx, journal, search };
}

const sgPlaylist = (id: number, projectId = 77) => ({
  type: 'Playlist',
  id,
  code: 'Dailies 12/06',
  versions: [{ type: 'Version', id: 900 }],
  project: { type: 'Project', id: projectId, name: 'ALPHA' },
});

beforeEach(() => {
  vi.clearAllMocks();
  links.mapSgToLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'version' ? new Map([[900, { localId: 31 }]]) : new Map(),
  );
  links.upsertLink.mockResolvedValue(undefined);
  playlist.findUnique.mockResolvedValue(null);
  playlist.create.mockResolvedValue({ id: 60 });
  playlistItem.deleteMany.mockResolvedValue({ count: 0 });
  playlistItem.createMany.mockResolvedValue({ count: 1 });
});

/**
 * Comme les notes, les playlists n'étaient jamais importées : l'événement était accepté
 * puis traité par une passe qui ne les lisait pas.
 */
describe('pullPlaylists', () => {
  it('cumule le filtre d’identifiants avec le filtre de projet', async () => {
    const { ctx, search } = contextWith([]);
    await pullPlaylists(ctx, { onlySgIds: [88] });

    const args = search.mock.calls[0]![1];
    expect(args.filters).toEqual([
      ['project', 'is', { type: 'Project', id: 77 }],
      ['id', 'in', [88]],
    ]);
    expect(args.maxRecords).toBe(1);
  });

  it('balaie le projet quand aucune playlist n’est désignée', async () => {
    const { ctx, search } = contextWith([]);
    await pullPlaylists(ctx);

    const args = search.mock.calls[0]![1];
    expect(args.filters).toEqual([['project', 'is', { type: 'Project', id: 77 }]]);
    expect(args.maxRecords).toBe(200);
  });

  it('écarte une playlist venue d’un autre projet du site', async () => {
    const { ctx, journal } = contextWith([sgPlaylist(88, 78)]);
    await pullPlaylists(ctx, { onlySgIds: [88] });

    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(playlist.create).not.toHaveBeenCalled();
  });

  it('crée la séance et la compte dans le résumé de fin de passe', async () => {
    const { ctx, journal } = contextWith([sgPlaylist(88)]);
    await pullPlaylists(ctx, { onlySgIds: [88] });

    expect(playlist.create).toHaveBeenCalledTimes(1);
    expect(playlistItem.createMany).toHaveBeenCalledWith({
      data: [{ playlistId: 60, versionId: 31, order: 0 }],
      skipDuplicates: true,
    });
    expect(touch).toHaveBeenCalledWith(ctx, 'playlist', 60);
    expect(journal.count).toHaveBeenCalledWith('playlists', 'created');
  });
});
