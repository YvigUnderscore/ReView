// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    playlist: { findFirst: vi.fn() },
    version: { findFirst: vi.fn() },
    mediaObject: { findMany: vi.fn() },
  },
}));
vi.mock('./AuditService', () => ({ logAudit: vi.fn() }));

import { ShareScope } from '@prisma/client';
import { candidateLocation, resolveScope, SHARE_SELECTION_LIMIT } from './ShareLinkService';
import { prisma } from '../lib/prisma';

/**
 * `resolveScope` est le dernier endroit où l'on peut empêcher un lien de pointer hors de
 * son projet. Tout ce qui passe ici est ensuite écrit tel quel dans la base et sert de
 * périmètre de lecture à un inconnu muni d'un jeton : ces refus sont la fonctionnalité.
 */
beforeEach(() => vi.clearAllMocks());

describe('resolveScope — la cible appartient au projet, ou rien', () => {
  it('ramène la portée « projet » à une forme sans cible', async () => {
    await expect(resolveScope(7, {})).resolves.toEqual({
      scope: ShareScope.PROJECT,
      playlistId: null,
      versionId: null,
      mediaIds: [],
    });
  });

  it('accepte une playlist du projet', async () => {
    vi.mocked(prisma.playlist.findFirst).mockResolvedValue({ id: 3 } as never);
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST, playlistId: 3 })).resolves.toMatchObject({
      scope: ShareScope.PLAYLIST,
      playlistId: 3,
    });
    expect(vi.mocked(prisma.playlist.findFirst).mock.calls[0]?.[0]).toMatchObject({
      where: { id: 3, projectId: 7 },
    });
  });

  it("refuse une playlist d'un autre projet", async () => {
    vi.mocked(prisma.playlist.findFirst).mockResolvedValue(null);
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST, playlistId: 3 })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_FOREIGN',
    });
  });

  it('refuse une portée restreinte sans cible', async () => {
    await expect(resolveScope(7, { scope: ShareScope.PLAYLIST })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
    await expect(resolveScope(7, { scope: ShareScope.VERSION })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [] })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_MISSING',
    });
  });

  it('accepte une version du projet, quel que soit son rattachement', async () => {
    vi.mocked(prisma.version.findFirst).mockResolvedValue({ id: 42 } as never);
    await expect(resolveScope(7, { scope: ShareScope.VERSION, versionId: 42 })).resolves.toMatchObject({
      scope: ShareScope.VERSION,
      versionId: 42,
    });
    const where = vi.mocked(prisma.version.findFirst).mock.calls[0]?.[0]?.where as { OR: unknown[] };
    expect(where.OR).toHaveLength(3);
  });

  it('dédoublonne la sélection et n’en garde que les médias publiés du projet', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([{ id: 11 }, { id: 12 }] as never);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [11, 12, 11] })).resolves.toMatchObject(
      { scope: ShareScope.MEDIA, mediaIds: [11, 12] },
    );
  });

  // Le média demandé mais non publié deviendrait visible le jour de sa publication, sans
  // qu'on l'ait décidé : on refuse la création plutôt que de l'ignorer en silence.
  it('refuse la sélection si un média n’est pas partageable', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([{ id: 11 }] as never);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: [11, 99] })).rejects.toMatchObject({
      code: 'SCOPE_TARGET_FOREIGN',
    });
  });

  it('refuse une sélection qui n’en est plus une', async () => {
    const tooMany = Array.from({ length: SHARE_SELECTION_LIMIT + 1 }, (_, i) => i + 1);
    await expect(resolveScope(7, { scope: ShareScope.MEDIA, mediaIds: tooMany })).rejects.toMatchObject({
      code: 'SCOPE_SELECTION_TOO_LARGE',
    });
    expect(prisma.mediaObject.findMany).not.toHaveBeenCalled();
  });
});

describe('candidateLocation — reconnaître un média à l’œil dans le sélecteur', () => {
  it('préfère le plan et son étape', () => {
    expect(
      candidateLocation({
        name: 'V03',
        task: { name: 'comp', shot: { code: 'SH020' }, asset: null },
        asset: null,
      }),
    ).toBe('SH020 › comp');
  });

  it("retombe sur l'asset porteur de la tâche", () => {
    expect(
      candidateLocation({
        name: 'V01',
        task: { name: 'lookdev', shot: null, asset: { name: 'Robot' } },
        asset: null,
      }),
    ).toBe('Robot › lookdev');
  });

  it("nomme l'asset quand la version y pend directement", () => {
    expect(candidateLocation({ name: 'V01', task: null, asset: { name: 'Robot' } })).toBe('Robot');
  });

  it('se rabat sur le nom de la version quand rien ne la situe', () => {
    expect(candidateLocation({ name: 'V07', task: null, asset: null })).toBe('V07');
  });
});
