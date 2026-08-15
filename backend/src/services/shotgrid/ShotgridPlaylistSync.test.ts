// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { playlist, links } = vi.hoisted(() => ({
  playlist: { findUnique: vi.fn() },
  links: { findByLocal: vi.fn(), upsertLink: vi.fn() },
}));

vi.mock('../../lib/prisma', () => ({ prisma: { playlist } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  findByLocal: (...args: unknown[]) => links.findByLocal(...args),
  upsertLink: (...args: unknown[]) => links.upsertLink(...args),
  mapSgToLocal: vi.fn(),
}));

import { pushPlaylist, type PlaylistPushContext } from './ShotgridPlaylistSync';

function contextWith(): PlaylistPushContext & {
  client: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
} {
  return {
    connectionId: 1,
    sgProjectId: 42,
    asUserLogin: 'lea@studio.fr',
    client: {
      create: vi.fn(async () => ({ id: 900 })),
      update: vi.fn(async () => ({})),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  links.upsertLink.mockResolvedValue(undefined);
});

describe('pushPlaylist', () => {
  it("envoie les versions dans l'ordre de la séance", async () => {
    // Une playlist est un déroulé : l'ordre compte autant que le contenu.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies 12/06',
      items: [{ versionId: 11 }, { versionId: 12 }, { versionId: 13 }],
    });
    links.findByLocal.mockImplementation(async (_c: number, type: string, id: number) =>
      type === 'playlist' ? null : { sgId: 100 + id },
    );

    const ctx = contextWith();
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(900);
    expect(ctx.client.create).toHaveBeenCalledWith('Playlist', {
      project: { type: 'Project', id: 42 },
      code: 'Dailies 12/06',
      versions: [
        { type: 'Version', id: 111 },
        { type: 'Version', id: 112 },
        { type: 'Version', id: 113 },
      ],
    });
  });

  it('met à jour la playlist déjà liée au lieu d’en créer une seconde', async () => {
    // Sans cela, chaque réordonnancement laisserait une séance de plus dans le studio.
    playlist.findUnique.mockResolvedValue({ id: 5, name: 'Dailies', items: [{ versionId: 11 }] });
    links.findByLocal.mockImplementation(async (_c: number, type: string) =>
      type === 'playlist' ? { sgId: 777 } : { sgId: 111 },
    );

    const ctx = contextWith();
    const sgId = await pushPlaylist(ctx, 5);

    expect(sgId).toBe(777);
    expect(ctx.client.create).not.toHaveBeenCalled();
    expect(ctx.client.update).toHaveBeenCalledWith(
      'Playlist',
      777,
      { code: 'Dailies', versions: [{ type: 'Version', id: 111 }] },
      { asUserLogin: 'lea@studio.fr' },
    );
  });

  it('ignore les versions que ShotGrid ne connaît pas', async () => {
    // Les inventer fabriquerait des entrées qui ne mènent nulle part.
    playlist.findUnique.mockResolvedValue({
      id: 5,
      name: 'Dailies',
      items: [{ versionId: 11 }, { versionId: 99 }],
    });
    links.findByLocal.mockImplementation(async (_c: number, type: string, id: number) => {
      if (type === 'playlist') return null;
      return id === 11 ? { sgId: 111 } : null;
    });

    const ctx = contextWith();
    await pushPlaylist(ctx, 5);

    expect(ctx.client.create.mock.calls[0][1]).toMatchObject({
      versions: [{ type: 'Version', id: 111 }],
    });
  });

  it('ne touche à rien quand la playlist locale a disparu', async () => {
    playlist.findUnique.mockResolvedValue(null);

    const ctx = contextWith();
    expect(await pushPlaylist(ctx, 5)).toBeNull();
    expect(ctx.client.create).not.toHaveBeenCalled();
    expect(ctx.client.update).not.toHaveBeenCalled();
  });
});
