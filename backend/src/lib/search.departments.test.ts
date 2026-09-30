// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Recherche de tâches : le libellé du département sort de la jointure.
 *
 * La palette laisse chercher une tâche par son nom, par la clé dénormalisée de son étape
 * (`lookdev`) et par le libellé de celle-ci (« Look Dev »), qui vit dans `Department`. Écrire
 * les trois branches dans un même `OR` faisait traverser la jointure à la troisième : un
 * `BitmapOr` ne franchit pas une table, si bien qu'AUCUN index de `Task` ne pouvait
 * s'appliquer et que chaque frappe balayait la table entière (mesuré à 60 000 tâches :
 * 775 blocs lus et 25,6 ms pour un terme qui ne correspond à rien, contre 21 blocs et 1,2 ms
 * une fois le `OR` ramené aux seules colonnes de `Task`).
 *
 * Ce fichier vérifie la seule chose qu'un test unitaire puisse établir ici, et c'est la
 * bonne : **la forme de la requête** — combien de tables le `OR` traverse, et si le jeu
 * sélectionné reste le même. Le gain en blocs lus, lui, se mesure par `EXPLAIN` sur une base
 * à volumétrie réelle ; il est consigné dans la migration `20260916091000_trigrammes_pipe`.
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
vi.mock('./searchComments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./searchComments')>()),
  searchComments: vi.fn().mockResolvedValue([]),
}));

import { Role } from '@prisma/client';
import { searchEntities } from './search';
import { prisma } from './prisma';

const ARTIST_ID = 7;

function callsOf<T = Record<string, unknown>>(fn: unknown): T[] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0] as T);
}

/** Les branches du `OR` textuel de la recherche de tâches, dans l'ordre. */
function taskTextBranches(): Record<string, unknown>[] {
  const args = callsOf<{ where: { AND: { OR: Record<string, unknown>[] }[] } }>(prisma.task.findMany).at(-1)!;
  return args.where.AND[0]!.OR;
}

/** Nom des tables qu'une clause de `where` fait traverser, en plus de `Task` elle-même. */
function joinedTables(branches: Record<string, unknown>[]): string[] {
  const relations = ['departmentRef', 'shot', 'asset', 'version'];
  return branches.flatMap((branch) => Object.keys(branch).filter((key) => relations.includes(key)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([{ projectId: 3 }] as never);
});

describe('searchEntities — la recherche de tâches ne traverse plus qu’une table', () => {
  it('résout le libellé du département en identifiants, au lieu de joindre la table', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([{ id: 4 }, { id: 9 }] as never);
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);

    const branches = taskTextBranches();
    // Le cœur du correctif : zéro table jointe dans le `OR` textuel. Avec l'ancienne forme,
    // `departmentRef` y figurait et ce tableau valait `['departmentRef']`.
    expect(joinedTables(branches)).toEqual([]);
    expect(branches).toEqual([
      { name: { contains: 'modeling', mode: 'insensitive' } },
      { department: { contains: 'modeling', mode: 'insensitive' } },
      { departmentId: { in: [4, 9] } },
    ]);
  });

  it('sélectionne exactement ce que la jointure sélectionnait : étape vivante, libellé correspondant', async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    // L'ancienne branche s'écrivait `departmentRef: { deletedAt: null, name: contains }`.
    // La requête de résolution porte le même filtre, mot pour mot — c'est ce qui garantit
    // que le jeu de tâches retenu ne bouge pas.
    const resolution = callsOf<{ where: Record<string, unknown>; select: unknown }>(
      prisma.department.findMany,
    )[0]!;
    expect(resolution.where).toEqual({
      deletedAt: null,
      name: { contains: 'modeling', mode: 'insensitive' },
    });
    expect(resolution.select).toEqual({ id: true });
  });

  it('omet la branche quand aucune étape ne correspond, sans toucher aux deux autres', async () => {
    // Le mock rend `[]` par défaut. Un `departmentId: { in: [] }` serait une clause que
    // Postgres doit tout de même évaluer ; l'absence de branche dit la même chose et se lit.
    await searchEntities('sh0120', ARTIST_ID, Role.ARTIST);
    expect(taskTextBranches().map((branch) => Object.keys(branch)[0])).toEqual(['name', 'department']);
  });

  it('ne coûte qu’une requête de résolution, quel que soit le rôle', async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    // Un ARTIST ne se voit pas proposer le référentiel des départements (`searchExtras`) :
    // le seul appel est donc celui de la résolution. Le compte est la mesure qui compte —
    // une requête de plus sur une table de dizaines de lignes, une jointure de moins sur
    // une table qui suit la production.
    expect(prisma.department.findMany).toHaveBeenCalledTimes(1);
  });

  it('n’élargit pas ce qu’un CLIENT peut atteindre : le filtre d’accès reste sur les tâches', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([{ id: 4 }] as never);
    await searchEntities('modeling', ARTIST_ID, Role.CLIENT);
    // Les identifiants d'étapes ne sont pas filtrés par projet — ils ne l'étaient pas non
    // plus dans la jointure. Ils ne servent qu'à filtrer des tâches déjà bornées par
    // l'appartenance, et c'est cette borne-là qu'il faut vérifier.
    const where = callsOf<{ where: { OR: Record<string, unknown>[] } }>(prisma.task.findMany).at(-1)!.where;
    expect(where.OR).toEqual([
      {
        shot: {
          deletedAt: null,
          hiddenAt: null,
          project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } },
        },
      },
      {
        asset: {
          deletedAt: null,
          hiddenAt: null,
          project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } },
        },
      },
    ]);
  });
});
