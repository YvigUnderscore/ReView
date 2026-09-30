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

  /**
   * Le lien survit à la playlist qu'il désigne : quelqu'un l'a supprimée ici, ShotGrid la
   * renvoie, et la création butait alors sur la contrainte `(projectId, name)` — la passe
   * entière s'arrêtait sur une séance effacée des mois plus tôt.
   */
  it('retombe sur le nom quand le lien désigne une séance supprimée', async () => {
    links.mapSgToLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'version' ? new Map([[900, { localId: 31 }]]) : new Map([[88, { localId: 55 }]]),
    );
    playlist.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      'id' in args.where ? null : { id: 61, name: 'Dailies 12/06' },
    );
    playlist.update.mockResolvedValue({ id: 61 });

    const { ctx } = contextWith([sgPlaylist(88)]);
    await pullPlaylists(ctx, { onlySgIds: [88] });

    expect(playlist.create).not.toHaveBeenCalled();
    expect(playlist.update).toHaveBeenCalledWith({ where: { id: 61 }, data: { name: 'Dailies 12/06' } });
  });

  /**
   * Renommage vers un nom déjà pris localement : on garde le nom actuel et on signale le
   * conflit. Fusionner deux séances ou en écraser une ne se décide pas tout seul.
   */
  it('ne renomme pas vers un nom déjà porté par une autre séance', async () => {
    links.mapSgToLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'version' ? new Map([[900, { localId: 31 }]]) : new Map([[88, { localId: 55 }]]),
    );
    playlist.findUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      'id' in args.where ? { id: 55, name: 'Ancien nom' } : { id: 61, name: 'Dailies 12/06' },
    );
    playlist.update.mockResolvedValue({ id: 55 });

    const { ctx, journal } = contextWith([sgPlaylist(88)]);
    await pullPlaylists(ctx, { onlySgIds: [88] });

    expect(playlist.update).toHaveBeenCalledWith({ where: { id: 55 }, data: {} });
    expect(journal.log).toHaveBeenCalledWith(
      'conflict',
      'shotgrid.log.playlistNameTaken',
      { name: 'Dailies 12/06' },
      expect.objectContaining({ localType: 'playlist', localId: 55 }),
    );
  });
});
