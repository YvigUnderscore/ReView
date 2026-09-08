// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { playlist, links } = vi.hoisted(() => ({
  playlist: { findUnique: vi.fn() },
  links: { findByLocal: vi.fn(), upsertLink: vi.fn(), mapLocalToSg: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: { playlist } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  mapLocalToSg: (...args: unknown[]) => links.mapLocalToSg(...args),
  mapSgToLocal: vi.fn(),
}));

import { mergePlaylistVersions, pushPlaylist, type PlaylistPushContext } from './ShotgridPlaylistSync';
import type { SgRecord } from './shotgridMapper';

type MockedClient = {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findById: ReturnType<typeof vi.fn>;
};

function contextWith(remote: SgRecord | null = null): PlaylistPushContext & { client: MockedClient } {
  return {
    connectionId: 1,
    sgProjectId: 42,
    sgProjectName: 'ALPHA',
    asUserLogin: 'lea@studio.fr',
    client: {
      create: vi.fn(async () => ({ id: 900 })),
      update: vi.fn(async () => ({})),
      findById: vi.fn(async () => remote),
    },
  };
}

const version = (id: number) => ({ type: 'Version', id });

/** Playlist telle que le site la renvoie avant écriture. */
const sgRemote = (
  versions: Array<{ type: string; id: number }>,
  over: Record<string, unknown> = {},
): SgRecord => ({
  type: 'Playlist',
  id: 777,
  code: 'Dailies',
  project: { type: 'Project', id: 42, name: 'ALPHA' },
  versions,
  ...over,
});

/** Correspondances version locale → version ShotGrid, telles que `mapLocalToSg` les rend. */
const versionLinks = (pairs: Array<[number, number]>) =>
  new Map(pairs.map(([localId, sgId]) => [localId, { localId, sgId, sgType: 'Version' }]));

/** Playlist locale liée à la playlist distante 777. */
function localPlaylist(versionIds: number[]) {
  playlist.findUnique.mockResolvedValue({
    id: 5,
    name: 'Dailies',
    items: versionIds.map((versionId) => ({ versionId })),
  });
  links.findByLocal.mockImplementation(async (_c: number, type: string) =>
    type === 'playlist' ? { sgId: 777, sgType: 'Playlist' } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  links.upsertLink.mockResolvedValue(undefined);
  // 11, 12, 13 sont importées de ShotGrid ; 99 n'y existe pas.
  links.mapLocalToSg.mockResolvedValue(
    versionLinks([
      [11, 111],
      [12, 112],
      [13, 113],
    ]),
  );
});

describe('pushPlaylist — création', () => {
  it("envoie les versions dans l'ordre de la séance", async () => {
    // Une playlist est un déroulé : l'ordre compte autant que le contenu.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies 12/06',
      items: [{ versionId: 11 }, { versionId: 12 }, { versionId: 13 }],
    });
    links.findByLocal.mockResolvedValue(null);

    const ctx = contextWith();
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(900);
    expect(ctx.client.create).toHaveBeenCalledWith('Playlist', {
      project: { type: 'Project', id: 42 },
      code: 'Dailies 12/06',
      versions: [version(111), version(112), version(113)],
    });
  });

  it('ignore les versions que ShotGrid ne connaît pas', async () => {
    // Les inventer fabriquerait des entrées qui ne mènent nulle part.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies',
      items: [{ versionId: 11 }, { versionId: 99 }],
    });
    links.findByLocal.mockResolvedValue(null);

    const ctx = contextWith();
    await pushPlaylist(ctx, 5);

    expect(ctx.client.create.mock.calls[0]![1]).toMatchObject({ versions: [version(111)] });
  });

  it('ne touche à rien quand la playlist locale a disparu', async () => {
    playlist.findUnique.mockResolvedValue(null);

    const ctx = contextWith();
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.client.create).not.toHaveBeenCalled();
    expect(ctx.client.update).not.toHaveBeenCalled();
  });
});

/**
 * Le contenu distant était reconstruit à partir du seul état ReView puis écrasé : toute
 * version posée sur le site et non importée ici disparaissait de la séance du studio.
 * Une écriture destructive sur un système tiers de production ne se rattrape pas — d'où
 * la relecture préalable et la fusion.
 */
describe('pushPlaylist — mise à jour non destructive', () => {
  it('met à jour la playlist déjà liée au lieu d’en créer une seconde', async () => {
    // Sans cela, chaque réordonnancement laisserait une séance de plus dans le studio.
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(112)]));
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(777);
    expect(ctx.client.create).not.toHaveBeenCalled();
    expect(ctx.client.update).toHaveBeenCalledWith(
      'Playlist',
      777,
      { code: 'Dailies', versions: [version(111)] },
      { asUserLogin: 'lea@studio.fr' },
    );
  });

  it('préserve une version distante que ReView ne connaît pas, à sa place', async () => {
    localPlaylist([11, 13]);

    const ctx = contextWith(sgRemote([version(500), version(111), version(112)]));
    await pushPlaylist(ctx, 5);

    // 500 reste en tête ; l'emplacement de 112, connue et retirée ici, revient à 113.
    expect(ctx.client.update.mock.calls[0]![2]).toEqual({
      code: 'Dailies',
      versions: [version(500), version(111), version(113)],
    });
  });

  it('ajoute la version ajoutée côté ReView', async () => {
    localPlaylist([11, 12]);

    const ctx = contextWith(sgRemote([version(111)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.client.update.mock.calls[0]![2]).toMatchObject({
      versions: [version(111), version(112)],
    });
  });

  it('retire la version que ReView connaissait et a retirée', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(111), version(112)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.client.update.mock.calls[0]![2]).toMatchObject({ versions: [version(111)] });
  });

  it('ne retire ni ne déplace une version d’un autre projet du site', async () => {
    // Aucune correspondance pour cette connexion : elle n'est pas de ce projet, ReView
    // n'a rien à en dire — même quand la séance locale se vide.
    localPlaylist([]);

    const ctx = contextWith(sgRemote([version(111), version(600), version(112)]));
    await pushPlaylist(ctx, 5);

    expect(ctx.client.update.mock.calls[0]![2]).toMatchObject({ versions: [version(600)] });
  });

  it('propage l’ordre de la séance sans bouger les versions inconnues', async () => {
    localPlaylist([12, 11]);

    const ctx = contextWith(sgRemote([version(111), version(700), version(112)]));
    await pushPlaylist(ctx, 5);

    // 700 garde son rang ; les deux emplacements gouvernés par ReView sont recomposés.
    expect(ctx.client.update.mock.calls[0]![2]).toMatchObject({
      versions: [version(112), version(700), version(111)],
    });
  });

  it('n’écrit rien quand le distant dit déjà la même chose', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(500), version(111)]));
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(777);
    expect(ctx.client.update).not.toHaveBeenCalled();
  });

  it('écrit quand seul le nom a changé', async () => {
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(111)], { code: 'Ancien nom' }));
    await pushPlaylist(ctx, 5);

    expect(ctx.client.update.mock.calls[0]![2]).toMatchObject({ code: 'Dailies' });
  });

  it('abandonne quand la playlist distante appartient à un autre projet', async () => {
    // Un identifiant réattribué suffirait à écrire dans la séance du voisin.
    localPlaylist([11]);

    const ctx = contextWith(sgRemote([version(111)], { project: { type: 'Project', id: 43, name: 'BETA' } }));
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.client.update).not.toHaveBeenCalled();
  });

  it('abandonne quand la cible est dans un projet modèle', async () => {
    localPlaylist([11]);

    const ctx = contextWith(
      sgRemote([version(111)], { project: { type: 'Project', id: 42, name: 'Template Project' } }),
    );
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.client.update).not.toHaveBeenCalled();
  });

  it('abandonne sans rien recréer quand la playlist distante a disparu', async () => {
    // La recréer remettrait dans le studio une séance supprimée à la main.
    localPlaylist([11]);

    const ctx = contextWith(null);
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.client.update).not.toHaveBeenCalled();
    expect(ctx.client.create).not.toHaveBeenCalled();
  });
});

describe('mergePlaylistVersions', () => {
  const known = new Set([111, 112, 113]);

  it('préserve une entrée qui n’est pas une version', () => {
    // Un site peut poser autre chose dans le champ : on ne l'interprète pas, on le garde.
    const merged = mergePlaylistVersions({
      remote: [
        { type: 'Shot', id: 42 },
        { type: 'Version', id: 111 },
      ],
      local: [111],
      known,
    });
    expect(merged).toEqual([
      { type: 'Shot', id: 42 },
      { type: 'Version', id: 111 },
    ]);
  });

  it('ne duplique pas une version déjà présente à distance', () => {
    const merged = mergePlaylistVersions({ remote: [{ type: 'Version', id: 111 }], local: [111], known });
    expect(merged).toEqual([{ type: 'Version', id: 111 }]);
  });

  it('laisse le distant intact quand ReView n’a rien à dire', () => {
    const remote = [
      { type: 'Version', id: 500 },
      { type: 'Version', id: 501 },
    ];
    expect(mergePlaylistVersions({ remote, local: [], known })).toEqual(remote);
  });
});
