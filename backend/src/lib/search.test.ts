// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cloisonnement de la recherche globale : ce que chaque rôle a le droit de trouver.
 *
 * C'est le seul point du produit où quinze tables sont interrogées d'un coup, sans qu'aucune
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
      episode: delegate(),
      department: delegate(),
      timeline: delegate(),
      board: delegate(),
      entityNote: delegate(),
    },
  };
});
// Mock partiel : seule la requête plein texte est simulée. Le découpage en tokens et le
// fenêtrage d'extrait servent aussi aux fiches d'entité (`searchExtras`) — les remplacer par
// des mocks ferait passer un test sur un extrait que personne ne produit.
vi.mock('./searchComments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./searchComments')>()),
  searchComments: vi.fn().mockResolvedValue([]),
}));

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
        { task: { shot: { deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE } } },
        { task: { asset: { deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE } } },
        { asset: { deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE } },
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
  it('impose une limite à chacun des types', async () => {
    await searchEntities('v012', 1, Role.ADMIN);
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
      episodes: argsOf<{ take: number }>(prisma.episode.findMany).take,
      departments: argsOf<{ take: number }>(prisma.department.findMany).take,
      timelines: argsOf<{ take: number }>(prisma.timeline.findMany).take,
      boards: argsOf<{ take: number }>(prisma.board.findMany).take,
      briefs: argsOf<{ take: number }>(prisma.entityNote.findMany).take,
    };
    for (const [type, take] of Object.entries(takes)) {
      expect(take, type).toBe(SEARCH_LIMITS[type as keyof typeof SEARCH_LIMITS]);
    }
  });

  it('borne chaque famille, sans exception', async () => {
    await searchEntities('v012', 1, Role.ADMIN);
    for (const limit of Object.values(SEARCH_LIMITS)) expect(limit).toBeGreaterThan(0);
  });
});

/**
 * Ce que le produit contient et que la recherche ignorait.
 *
 * Cinq familles ne rendaient rien, quoi qu'on tape : « Modeling » (un département), le code
 * d'un épisode, un montage, un board, et le texte d'une fiche d'entité — c'est-à-dire le
 * brief, le seul endroit où est écrit ce qu'un plan doit devenir. Le cloisonnement de
 * chacune est vérifié ici comme celui des dix premières : sur la clause `where`.
 */
describe('searchEntities — les familles ajoutées', () => {
  beforeEach(async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
  });

  it('cherche les épisodes du projet, ni retirés ni masqués', () => {
    const where = whereOf(prisma.episode.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE });
    expect(where.OR.map((clause) => Object.keys(clause)[0])).toEqual(['code', 'name', 'description']);
  });

  it('écarte le montage d’une séquence masquée ou retirée', () => {
    const where = whereOf(prisma.timeline.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ project: MEMBER_SCOPE });
    expect(where.OR).toEqual([{ sequenceId: null }, { sequence: { deletedAt: null, hiddenAt: null } }]);
  });

  it('ne propose le board que d’un projet accessible ou d’un asset visible', () => {
    const where = whereOf(prisma.board.findMany) as { OR: Record<string, unknown>[] };
    expect(where.OR[0]).toMatchObject({ project: MEMBER_SCOPE });
    expect(where.OR[1]).toMatchObject({
      asset: { deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE },
    });
  });

  it('ne cherche une fiche que sous une entité visible d’un projet accessible', () => {
    const where = whereOf(prisma.entityNote.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ project: MEMBER_SCOPE });
    const visible = { deletedAt: null, hiddenAt: null };
    expect(where.OR).toEqual([
      { episode: visible },
      { sequence: visible },
      { shot: visible },
      { asset: visible },
    ]);
  });

  it('trouve une tâche par son département : « Modeling » ne rendait rien', () => {
    const where = whereOf(prisma.task.findMany) as { AND: { OR: Record<string, unknown>[] }[] };
    const fields = where.AND[0]!.OR.map((clause) => Object.keys(clause)[0]);
    expect(fields).toEqual(['name', 'departmentRef', 'department']);
  });
});

describe('searchEntities — les départements ne s’offrent qu’à qui peut les ouvrir', () => {
  it('les ignore pour un ARTIST et pour un CLIENT — l’écran leur serait refusé', async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
    await searchEntities('modeling', ARTIST_ID, Role.CLIENT);
    expect(prisma.department.findMany).not.toHaveBeenCalled();
  });

  it('rend le référentiel du studio et les étapes des projets accessibles à un ADMIN', async () => {
    await searchEntities('modeling', 1, Role.ADMIN);
    const where = whereOf(prisma.department.findMany) as {
      OR: Record<string, unknown>[];
      AND: { OR: Record<string, unknown>[] }[];
    };
    expect(where).toMatchObject({ deletedAt: null });
    expect(where.OR).toEqual([{ projectId: null }, { project: { deletedAt: null } }]);
    expect(where.AND[0]!.OR.map((clause) => Object.keys(clause)[0])).toEqual(['name', 'key']);
  });
});

describe('searchEntities — mise en forme des familles ajoutées', () => {
  it('rend un montage sans nom tel quel : son libellé se traduit à l’écran', async () => {
    vi.mocked(prisma.timeline.findMany).mockResolvedValue([
      { id: 4, name: null, project: { name: 'Alpha' }, sequence: { code: 'SQ010' } },
      { id: 5, name: 'Montage client', project: { name: 'Alpha' }, sequence: null },
    ] as never);
    const res = await searchEntities('SQ010', 1, Role.ADMIN);
    expect(res.timelines).toEqual([
      { id: 4, name: null, projectName: 'Alpha', sequenceCode: 'SQ010' },
      { id: 5, name: 'Montage client', projectName: 'Alpha', sequenceCode: null },
    ]);
  });

  it('rend un board avec le nom de ce qu’il illustre, projet ou asset', async () => {
    vi.mocked(prisma.board.findMany).mockResolvedValue([
      { id: 1, projectId: 3, assetId: null, project: { name: 'Alpha' }, asset: null },
      { id: 2, projectId: null, assetId: 9, project: null, asset: { name: 'Robot' } },
    ] as never);
    const res = await searchEntities('alpha', 1, Role.ADMIN);
    expect(res.boards).toEqual([
      { id: 1, projectId: 3, assetId: null, name: 'Alpha' },
      { id: 2, projectId: null, assetId: 9, name: 'Robot' },
    ]);
  });

  it('rend la fiche avec son porteur et un extrait autour du terme cherché', async () => {
    vi.mocked(prisma.entityNote.findMany).mockResolvedValue([
      {
        id: 7,
        body: `${'x'.repeat(300)} le watermark reste visible ${'y'.repeat(300)}`,
        episode: null,
        sequence: null,
        shot: { id: 12, code: 'SH0120' },
        asset: null,
      },
    ] as never);
    const res = await searchEntities('watermark', 1, Role.ADMIN);
    expect(res.briefs[0]).toMatchObject({ id: 7, holder: 'shot', holderId: 12, label: 'SH0120' });
    expect(res.briefs[0]!.excerpt).toContain('watermark');
    expect(res.briefs[0]!.excerpt.length).toBeLessThan(200);
  });

  it('ne rend pas une fiche sans entité porteuse — elle n’ouvrirait aucune page', async () => {
    vi.mocked(prisma.entityNote.findMany).mockResolvedValue([
      { id: 8, body: 'fiche de projet', episode: null, sequence: null, shot: null, asset: null },
    ] as never);
    const res = await searchEntities('fiche', 1, Role.ADMIN);
    expect(res.briefs).toEqual([]);
  });

  it('rend le département d’une tâche, sa clé à défaut de la relation', async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      {
        id: 1,
        name: 'main',
        type: 'MODELING',
        shotId: 3,
        assetId: null,
        department: 'modeling',
        departmentRef: { name: 'Modeling' },
      },
      {
        id: 2,
        name: 'main',
        type: 'OTHER',
        shotId: 4,
        assetId: null,
        department: 'setdress',
        departmentRef: null,
      },
      { id: 3, name: 'main', type: 'OTHER', shotId: 5, assetId: null, department: null, departmentRef: null },
    ] as never);
    const res = await searchEntities('modeling', 1, Role.ADMIN);
    expect(res.tasks.map((task) => task.departmentName)).toEqual(['Modeling', 'setdress', null]);
  });

  it('place la tâche NOMMÉE comp avant les tâches de l’étape Compositing', async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      {
        id: 1,
        name: 'cleanup',
        type: 'OTHER',
        shotId: 3,
        assetId: null,
        department: 'comp',
        departmentRef: { name: 'comp' },
      },
      {
        id: 2,
        name: 'comp',
        type: 'COMP',
        shotId: 4,
        assetId: null,
        department: 'comp',
        departmentRef: { name: 'comp' },
      },
    ] as never);
    const res = await searchEntities('comp', 1, Role.ADMIN);
    expect(res.tasks.map((task) => task.id)).toEqual([2, 1]);
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

/**
 * Ce que la recherche trouve, et dans quel ordre.
 *
 * Deux promesses distinctes : chercher **au-delà du nom** (un plan se retrouve par ce qu'il
 * raconte, pas seulement par son code), et **classer** — chaque liste sortait dans l'ordre
 * de la base, si bien que taper « SH0120 » plaçait le plan SH0120 après trois médias dont
 * le nom de fichier le contient.
 */
describe('searchEntities — portée et classement', () => {
  it('cherche aussi dans la description d’un plan, d’une séquence et d’un asset', async () => {
    await searchEntities('pluie', ARTIST_ID, Role.ARTIST);
    for (const delegate of [prisma.shot, prisma.sequence, prisma.asset]) {
      const where = whereOf(delegate.findMany) as { OR: Record<string, unknown>[] };
      expect(where.OR.some((clause) => 'description' in clause)).toBe(true);
    }
  });

  it('remonte la correspondance la plus nette, pas la plus récente', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValueOnce([
      // Ordre de la base : le plus récent d'abord. Le second est pourtant ce qu'on cherche.
      { id: 1, code: 'SH0121', name: 'SH0121', description: null, projectId: 1 },
      { id: 2, code: 'SH0120', name: 'SH0120', description: null, projectId: 1 },
      { id: 3, code: 'EP01_SH0120_old', name: 'x', description: null, projectId: 1 },
    ] as never);

    const results = await searchEntities('SH0120', ARTIST_ID, Role.ARTIST);

    expect(results.shots.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('préfère une description exacte à un fragment perdu dans un code', async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValueOnce([
      { id: 1, name: 'xpluiex', description: null, type: 'PROP', projectId: 1 },
      { id: 2, name: 'Robot', description: 'pluie', type: 'PROP', projectId: 1 },
    ] as never);

    const results = await searchEntities('pluie', ARTIST_ID, Role.ARTIST);

    expect(results.assets[0]!.id).toBe(2);
  });

  it('ne perd aucun résultat en classant', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValueOnce([
      { id: 1, code: 'A', name: 'A', description: null, projectId: 1 },
      { id: 2, code: 'B', name: 'B', description: null, projectId: 1 },
    ] as never);

    const results = await searchEntities('néant', ARTIST_ID, Role.ARTIST);

    expect(results.shots).toHaveLength(2);
  });
});
