// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: {
    shot: { findMany: vi.fn(), count: vi.fn() },
    task: { findMany: vi.fn() },
    version: { groupBy: vi.fn() },
    department: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));

import {
  buildGridRows,
  cellStatusOf,
  getProjectGrid,
  gridShotWhere,
  gridTaskFilter,
  GRID_DEFAULT_LIMIT,
  GRID_MAX_LIMIT,
  type GridDepartment,
  type GridShotRow,
  type GridTaskRow,
} from './GridService';
import { prisma } from '../lib/prisma';
import { decodeCursor } from '../lib/pagination';
import { TaskStatus } from '@prisma/client';

const departments: GridDepartment[] = [
  { id: 1, key: 'anim', name: 'Animation', color: '#22C55E', order: 0 },
  { id: 2, key: 'comp', name: 'Compositing', color: null, order: 1 },
];

const shot = (over: Partial<GridShotRow> = {}): GridShotRow => ({
  id: 10,
  code: 'SH010',
  name: 'plan A',
  order: 0,
  sequenceId: 3,
  sequence: { code: 'SQ010', episodeId: 5, episode: { code: 'EP01' } },
  pipelineStatus: { id: 90, code: 'ip', name: 'In Progress', color: '#3B82F6' },
  departments: [{ id: 1 }],
  ...over,
});

const task = (over: Partial<GridTaskRow> = {}): GridTaskRow => ({
  id: 100,
  shotId: 10,
  status: TaskStatus.IN_PROGRESS,
  dueDate: null,
  department: 'anim',
  departmentId: 1,
  departmentRef: { key: 'anim' },
  assignee: { id: 7, name: 'Ada' },
  pipelineStatus: null,
  ...over,
});

// ── Filtres ──────────────────────────────────────────────────────────────────

describe('GridService — filtres', () => {
  it('sans filtre de tâche, la grille ne filtre que les plans vivants et visibles', () => {
    expect(gridShotWhere(7, {})).toEqual({ projectId: 7, deletedAt: null, hiddenAt: null });
    expect(gridTaskFilter({})).toBeNull();
  });

  it('cherche le département par sa CLÉ, relation d’abord, colonne dénormalisée ensuite', () => {
    expect(gridTaskFilter({ department: 'comp' })).toEqual({
      AND: [{ OR: [{ departmentRef: { key: 'comp' } }, { department: 'comp' }] }],
    });
  });

  it('filtre sur l’assigné demandé', () => {
    expect(gridTaskFilter({ assigneeId: 7 })).toEqual({ AND: [{ assigneeId: 7 }] });
  });

  it('accepte le code du studio ET la valeur de l’enum pour un studio sans référentiel', () => {
    expect(gridTaskFilter({ status: 'ip' })).toEqual({
      AND: [{ OR: [{ pipelineStatus: { code: 'ip' } }] }],
    });
    // `todo` désigne aussi l'enum figé : la branche locale s'ajoute, elle ne remplace pas.
    expect(gridTaskFilter({ status: 'todo' })).toEqual({
      AND: [
        {
          OR: [{ pipelineStatus: { code: 'todo' } }, { pipelineStatusId: null, status: TaskStatus.TODO }],
        },
      ],
    });
  });

  it('un filtre de tâche garde le plan ENTIER : il décide de la ligne, pas des cases', () => {
    const where = gridShotWhere(7, { assigneeId: 7, sequenceId: 3, episodeId: 5 });
    expect(where.sequenceId).toBe(3);
    expect(where.sequence).toEqual({ episodeId: 5 });
    expect(where.tasks).toEqual({ some: { AND: [{ assigneeId: 7 }] } });
  });
});

// ── Assemblage des lignes ────────────────────────────────────────────────────

describe('GridService — buildGridRows', () => {
  it('rend une case par département du référentiel, même sans tâche', () => {
    const [row] = buildGridRows([shot()], [], [], departments);
    expect(row!.cells.map((c) => c.departmentKey)).toEqual(['anim', 'comp']);
    expect(row!.cells[1]).toMatchObject({ taskId: null, status: null, versionCount: 0 });
  });

  it('remonte séquence, épisode et statut propre du plan', () => {
    const [row] = buildGridRows([shot()], [], [], departments);
    expect(row).toMatchObject({
      shotId: 10,
      sequenceId: 3,
      sequenceCode: 'SQ010',
      episodeId: 5,
      episodeCode: 'EP01',
      status: { id: 90, code: 'ip', name: 'In Progress', color: '#3B82F6' },
    });
  });

  it('un plan hors séquence n’a ni séquence ni épisode, et garde ses colonnes', () => {
    const [row] = buildGridRows([shot({ sequenceId: null, sequence: null })], [], [], departments);
    expect(row).toMatchObject({ sequenceId: null, sequenceCode: null, episodeId: null, episodeCode: null });
    expect(row!.cells).toHaveLength(2);
  });

  it('joint l’agrégat de versions à la bonne case', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ dueDate: new Date('2026-10-01T00:00:00Z') })],
      [{ taskId: 100, count: 3, lastAt: new Date('2026-09-12T08:00:00Z') }],
      departments,
    );
    expect(row!.cells[0]).toMatchObject({
      taskId: 100,
      versionCount: 3,
      lastActivityAt: '2026-09-12T08:00:00.000Z',
      dueDate: '2026-10-01T00:00:00.000Z',
      assignee: { id: 7, name: 'Ada' },
    });
  });

  it('quand un département porte plusieurs tâches, la case montre la première du pipe', () => {
    // Les tâches arrivent triées par (order, id) : la première gagne la case.
    const [row] = buildGridRows([shot()], [task({ id: 100 }), task({ id: 101 })], [], departments);
    expect(row!.cells[0]!.taskId).toBe(100);
  });

  it('rapproche la clé dénormalisée sans tenir compte de la casse', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ departmentRef: null, department: 'ANIM' })],
      [],
      departments,
    );
    expect(row!.cells[0]!.taskId).toBe(100);
  });

  it('une tâche hors référentiel n’a pas de colonne : elle ne s’invente pas une case', () => {
    const [row] = buildGridRows(
      [shot()],
      [task({ departmentId: 99, departmentRef: { key: 'groom' }, department: 'groom' })],
      [],
      departments,
    );
    expect(row!.cells.every((c) => c.taskId === null)).toBe(true);
    expect(row!.cells.map((c) => c.departmentKey)).toEqual(['anim', 'comp']);
  });

  it('`scheduled` distingue « rien à faire ici » de « à faire, pas commencé »', () => {
    // Le plan est au programme d'`anim` seulement ; `comp` n'a ni tâche ni programme.
    const [row] = buildGridRows([shot({ departments: [{ id: 1 }] })], [], [], departments);
    expect(row!.cells.map((c) => c.scheduled)).toEqual([true, false]);
  });

  it('une tâche existante vaut programme, même hors ShotDepartments', () => {
    const [row] = buildGridRows(
      [shot({ departments: [] })],
      [task({ departmentId: 2, departmentRef: { key: 'comp' }, department: 'comp' })],
      [],
      departments,
    );
    expect(row!.cells.map((c) => c.scheduled)).toEqual([false, true]);
  });

  it('ignore une tâche d’asset égarée dans le lot (shotId nul)', () => {
    const [row] = buildGridRows([shot()], [task({ shotId: null })], [], departments);
    expect(row!.cells[0]!.taskId).toBeNull();
  });
});

describe('GridService — statut d’une case', () => {
  it('sans référentiel, n’écrit AUCUN libellé : le code de l’enum et la famille suffisent', () => {
    expect(cellStatusOf(task())).toEqual({
      id: null,
      code: 'IN_PROGRESS',
      name: '',
      color: null,
      family: 'progress',
    });
  });

  it('avec référentiel, rend le vocabulaire et la teinte du studio', () => {
    const status = cellStatusOf(
      task({
        status: TaskStatus.IN_PROGRESS,
        pipelineStatus: {
          id: 5,
          code: 'fin',
          name: 'Final',
          color: '#16A34A',
          isDone: true,
          isInactive: false,
          legacyStatus: TaskStatus.APPROVED,
        },
      }),
    );
    // `isDone` fait autorité sur « c'est fini », pas l'enum local.
    expect(status).toEqual({ id: 5, code: 'fin', name: 'Final', color: '#16A34A', family: 'done' });
  });

  it('un statut inactif reste inactif : ni à faire, ni fait', () => {
    expect(
      cellStatusOf(
        task({
          pipelineStatus: {
            id: 6,
            code: 'omt',
            name: 'Omitted',
            color: '#71717A',
            isDone: false,
            isInactive: true,
            legacyStatus: null,
          },
        }),
      ).family,
    ).toBe('inactive');
  });
});

// ── Lecture paginée ──────────────────────────────────────────────────────────

const shots = (count: number): GridShotRow[] =>
  Array.from({ length: count }, (_, i) => shot({ id: i + 1, order: i, code: `SH${i + 1}` }));

describe('GridService — getProjectGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.shot.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shot.count).mockResolvedValue(0);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.version.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.department.findMany).mockResolvedValue(departments as never);
  });

  it('pagine PAR PLAN : take sur les plans, tri de l’index, jamais de take sur les tâches', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(3) as never);
    await getProjectGrid(7);
    const call = vi.mocked(prisma.shot.findMany).mock.calls[0]![0]!;
    expect(call.take).toBe(GRID_DEFAULT_LIMIT);
    expect(call.orderBy).toEqual([{ order: 'asc' }, { id: 'asc' }]);
    // Une ligne de grille est un plan avec toutes ses cases : borner les tâches
    // couperait une ligne en deux.
    expect(vi.mocked(prisma.task.findMany).mock.calls[0]![0]!.take).toBeUndefined();
  });

  it('plafonne la page et refuse les valeurs absurdes', async () => {
    await getProjectGrid(7, { limit: 5000 });
    expect(vi.mocked(prisma.shot.findMany).mock.calls[0]![0]!.take).toBe(GRID_MAX_LIMIT);
    await getProjectGrid(7, { limit: 0 });
    expect(vi.mocked(prisma.shot.findMany).mock.calls[1]![0]!.take).toBe(1);
  });

  it('ne lit que quatre fois la base par page, plus le total et le référentiel', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([task()] as never);
    await getProjectGrid(7);
    expect(vi.mocked(prisma.shot.findMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.task.findMany)).toHaveBeenCalledTimes(1);
    // Comptes ET dernière activité en une seule agrégation, pas une requête par tâche.
    expect(vi.mocked(prisma.version.groupBy)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.shot.count)).toHaveBeenCalledTimes(1);
  });

  it('ne demande ni tâches ni versions quand la page est vide', async () => {
    await getProjectGrid(7);
    expect(vi.mocked(prisma.task.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.version.groupBy)).not.toHaveBeenCalled();
  });

  it('compte le total sans le curseur — sinon il rétrécirait de page en page', async () => {
    vi.mocked(prisma.shot.count).mockResolvedValue(2000);
    const out = await getProjectGrid(7, { cursor: 'nawak', limit: 10 });
    expect(out.total).toBe(2000);
    expect(vi.mocked(prisma.shot.count).mock.calls[0]![0]!.where).toEqual(gridShotWhere(7, {}));
  });

  it('rend un curseur sur (order, id) quand la page est pleine', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    const out = await getProjectGrid(7, { limit: 2 });
    expect(decodeCursor(out.nextCursor!)).toEqual({ value: 1, id: 2 });
  });

  it('ferme la liste sur une page incomplète', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(2) as never);
    expect((await getProjectGrid(7, { limit: 10 })).nextCursor).toBeNull();
  });

  it('empile le curseur dans AND, sans écraser les clauses de relation', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValue(shots(1) as never);
    const page = await getProjectGrid(7, { limit: 1 });
    await getProjectGrid(7, { limit: 1, cursor: page.nextCursor!, assigneeId: 7 });
    const where = vi.mocked(prisma.shot.findMany).mock.calls[1]![0]!.where as Record<string, unknown>;
    // Le filtre de tâche survit au curseur : étalé à la racine, il serait écrasé et la
    // page rendrait tout le projet.
    expect(where.tasks).toEqual({ some: { AND: [{ assigneeId: 7 }] } });
    expect(where.AND).toEqual([{ OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 1 } }] }] }]);
  });

  it('retombe sur le référentiel du studio quand le projet n’a pas le sien', async () => {
    vi.mocked(prisma.department.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce(departments as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ studioId: 4 } as never);
    const out = await getProjectGrid(7);
    expect(out.departments).toEqual(departments);
    expect(vi.mocked(prisma.department.findMany).mock.calls[1]![0]!.where).toEqual({
      studioId: 4,
      projectId: null,
      deletedAt: null,
    });
  });

  it('ne rend aucune colonne pour un projet qui n’existe plus', async () => {
    vi.mocked(prisma.department.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect((await getProjectGrid(7)).departments).toEqual([]);
  });
});
