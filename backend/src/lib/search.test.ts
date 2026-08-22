// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cloisonnement de la recherche globale : ce que chaque rôle a le droit de trouver.
 *
 * C'est le seul point du produit où dix tables sont interrogées d'un coup, sans qu'aucune
 * route ne repasse derrière : un filtre manquant sur UN type suffit à publier le pipe entier
 * à un intervenant extérieur. Chaque type est donc vérifié séparément, sur la clause `where`
 * réellement transmise à Prisma — pas sur le résultat, qu'un mock rendrait toujours vide.
 */

vi.mock('./prisma', () => {
  const delegate = () => ({ findMany: vi.fn().mockResolvedValue([]) });
  return {
    prisma: {
      project: delegate(),
      sequence: delegate(),
      shot: delegate(),
      asset: delegate(),
      task: delegate(),
      version: delegate(),
      mediaObject: delegate(),
      playlist: delegate(),
      user: delegate(),
      projectMembership: delegate(),
    },
  };
});
vi.mock('./searchComments', () => ({ searchComments: vi.fn().mockResolvedValue([]) }));

import { Role } from '@prisma/client';
import { searchEntities, projectScope, SEARCH_LIMITS } from './search';
import { searchComments } from './searchComments';
import { prisma } from './prisma';

const ARTIST_ID = 7;
const MEMBER_SCOPE = { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } };

/** Arguments du premier appel simulé — les types génériques de Prisma n'aident pas ici. */
function argsOf<T = Record<string, unknown>>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as T;
}
const whereOf = (fn: unknown): Record<string, unknown> =>
  argsOf<{ where: Record<string, unknown> }>(fn).where;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([
    { projectId: 3 },
    { projectId: 9 },
  ] as never);
});

describe('projectScope', () => {
  it('ouvre le studio entier aux rôles globaux', () => {
    expect(projectScope(1, Role.ADMIN)).toEqual({ deletedAt: null });
    expect(projectScope(1, Role.SUPERVISOR)).toEqual({ deletedAt: null });
  });

  it('borne tous les autres à leurs projets, corbeille exclue', () => {
    expect(projectScope(ARTIST_ID, Role.ARTIST)).toEqual(MEMBER_SCOPE);
    expect(projectScope(ARTIST_ID, Role.CLIENT)).toEqual(MEMBER_SCOPE);
  });
});

describe('searchEntities — un ARTIST ne voit que ses projets', () => {
  beforeEach(async () => {
    await searchEntities('sh0120', ARTIST_ID, Role.ARTIST);
  });

  it('filtre les cinq types du pipe par appartenance', () => {
    expect(whereOf(prisma.project.findMany)).toMatchObject(MEMBER_SCOPE);
    expect(whereOf(prisma.sequence.findMany)).toMatchObject({ project: MEMBER_SCOPE });
    expect(whereOf(prisma.shot.findMany)).toMatchObject({ project: MEMBER_SCOPE });
    expect(whereOf(prisma.asset.findMany)).toMatchObject({ project: MEMBER_SCOPE });
    expect(whereOf(prisma.task.findMany)).toMatchObject({
      OR: [
        { shot: { deletedAt: null, project: MEMBER_SCOPE } },
        { asset: { deletedAt: null, project: MEMBER_SCOPE } },
      ],
    });
  });

  it('filtre les versions par le projet de leur plan ou de leur asset porteur', () => {
    const where = whereOf(prisma.version.findMany) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toEqual({
      deletedAt: null,
      OR: [
        { task: { shot: { deletedAt: null, project: MEMBER_SCOPE } } },
        { task: { asset: { deletedAt: null, project: MEMBER_SCOPE } } },
        { asset: { deletedAt: null, project: MEMBER_SCOPE } },
      ],
    });
  });

  it('ne montre un média non publié qu’à son déposant', () => {
    const where = whereOf(prisma.mediaObject.findMany) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toMatchObject({
      deletedAt: null,
      status: 'READY',
      OR: [{ published: true }, { published: false, uploaderId: ARTIST_ID }],
    });
  });

  it('filtre les playlists par projet', () => {
    expect(whereOf(prisma.playlist.findMany)).toMatchObject({ project: MEMBER_SCOPE });
  });

  it('ne transmet à la recherche plein texte que les projets dont il est membre', () => {
    expect(vi.mocked(searchComments)).toHaveBeenCalledWith('sh0120', {
      userId: ARTIST_ID,
      role: Role.ARTIST,
      projectIds: [3, 9],
      limit: SEARCH_LIMITS.comments,
    });
  });

  it('cherche l’annuaire du studio, adresses comprises, mais sans compte de service ni compte fermé', () => {
    const where = whereOf(prisma.user.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ isService: false, disabledAt: null });
    expect(where).not.toHaveProperty('memberships');
    expect(where.OR.some((c) => 'email' in c)).toBe(true);
  });
});

describe('searchEntities — un CLIENT est un intervenant extérieur', () => {
  beforeEach(async () => {
    await searchEntities('reflet', ARTIST_ID, Role.CLIENT);
  });

  it('ne voit aucun brouillon, pas même le sien', () => {
    const where = whereOf(prisma.mediaObject.findMany) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toMatchObject({ published: true });
    expect(where.AND[0]).not.toHaveProperty('OR');
  });

  it('ne trouve que les personnes des projets qu’il partage, et jamais par adresse', () => {
    const where = whereOf(prisma.user.findMany) as {
      OR: Record<string, unknown>[];
      memberships: unknown;
    };
    expect(where.memberships).toEqual({
      some: { project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } } },
    });
    expect(where.OR.some((c) => 'email' in c)).toBe(false);
  });

  it('reste borné à ses projets pour les notes de review', () => {
    expect(vi.mocked(searchComments)).toHaveBeenCalledWith(
      'reflet',
      expect.objectContaining({ role: Role.CLIENT, projectIds: [3, 9] }),
    );
  });
});

describe('searchEntities — rôles globaux', () => {
  it('n’exige aucune appartenance et n’interroge pas la table des membres', async () => {
    await searchEntities('comp', 1, Role.SUPERVISOR);
    expect(whereOf(prisma.project.findMany)).toMatchObject({ deletedAt: null });
    expect(whereOf(prisma.project.findMany)).not.toHaveProperty('memberships');
    expect(prisma.projectMembership.findMany).not.toHaveBeenCalled();
    expect(vi.mocked(searchComments)).toHaveBeenCalledWith(
      'comp',
      expect.objectContaining({ projectIds: null }),
    );
  });
});

describe('searchEntities — résultats bornés', () => {
  it('impose une limite à chacun des dix types', async () => {
    await searchEntities('v012', ARTIST_ID, Role.ARTIST);
    const takes = {
      projects: argsOf<{ take: number }>(prisma.project.findMany).take,
      sequences: argsOf<{ take: number }>(prisma.sequence.findMany).take,
      shots: argsOf<{ take: number }>(prisma.shot.findMany).take,
      assets: argsOf<{ take: number }>(prisma.asset.findMany).take,
      tasks: argsOf<{ take: number }>(prisma.task.findMany).take,
      versions: argsOf<{ take: number }>(prisma.version.findMany).take,
      media: argsOf<{ take: number }>(prisma.mediaObject.findMany).take,
      playlists: argsOf<{ take: number }>(prisma.playlist.findMany).take,
      people: argsOf<{ take: number }>(prisma.user.findMany).take,
    };
    for (const [type, take] of Object.entries(takes)) {
      expect(take, type).toBe(SEARCH_LIMITS[type as keyof typeof SEARCH_LIMITS]);
    }
  });
});

describe('searchEntities — mise en forme des résultats', () => {
  it('rend le chemin lisible d’une version et sa cible de navigation', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      {
        id: 12,
        name: 'v012',
        taskId: 4,
        assetId: null,
        task: { name: 'comp', shot: { code: 'SH0120' }, asset: null },
        asset: null,
        media: [{ id: 88 }],
      },
    ] as never);
    const res = await searchEntities('v012', 1, Role.ADMIN);
    expect(res.versions[0]).toEqual({
      id: 12,
      name: 'v012',
      mediaId: 88,
      taskId: 4,
      assetId: null,
      context: 'SH0120 · comp',
    });
  });

  it('rend une version sans média visible sans cible, jamais en erreur', async () => {
    vi.mocked(prisma.version.findMany).mockResolvedValue([
      {
        id: 13,
        name: 'v001',
        taskId: null,
        assetId: 5,
        task: null,
        asset: { name: 'robot' },
        media: [],
      },
    ] as never);
    const res = await searchEntities('v001', 1, Role.ADMIN);
    expect(res.versions[0]).toMatchObject({ mediaId: null, assetId: 5, context: 'robot' });
  });

  it('rend le média avec son plan et son numéro de version', async () => {
    vi.mocked(prisma.mediaObject.findMany).mockResolvedValue([
      {
        id: 88,
        originalName: 'SH0120_comp_v012.mov',
        kind: 'VIDEO',
        version: { name: 'v012', task: { name: 'comp', shot: { code: 'SH0120' }, asset: null }, asset: null },
      },
    ] as never);
    const res = await searchEntities('SH0120', 1, Role.ADMIN);
    expect(res.media[0]).toEqual({
      id: 88,
      name: 'SH0120_comp_v012.mov',
      kind: 'VIDEO',
      context: 'SH0120 · comp · v012',
    });
  });

  it('ne renvoie jamais l’adresse d’une personne, et tolère un compte sans nom', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 2, username: null, name: null, firstName: null, lastName: null, jobTitle: null },
      { id: 3, username: null, name: null, firstName: 'Ana', lastName: 'Roy', jobTitle: 'Comp' },
    ] as never);
    const res = await searchEntities('ana', 1, Role.ADMIN);
    expect(res.people).toEqual([
      { id: 2, name: null, jobTitle: null },
      { id: 3, name: 'Ana Roy', jobTitle: 'Comp' },
    ]);
    expect(JSON.stringify(res.people)).not.toContain('@');
  });
});
