// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Scope of the global search: what each role is allowed to find.
 *
 * It is the only point of the product where fifteen tables are queried at once, with no route going back over the results: a missing filter on ONE
 * type is enough to publish the whole pipe to an external contributor. Each type is therefore checked separately, on the `where` clause actually
 * passed to Prisma — not on the result, which a mock would always return empty.
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
// Partial mock: only the full-text query is simulated. The tokenisation and snippet windowing also serve the entity sheets (`searchExtras`) — replacing
// them with mocks would make a test pass on a snippet nobody produces.
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

/** Arguments of the first simulated call — Prisma's generic types are of no help here. */
function argsOf<T = Record<string, unknown>>(fn: unknown): T {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as T;
}
const whereOf = (fn: unknown): Record<string, unknown> =>
  argsOf<{ where: Record<string, unknown> }>(fn).where;

/** All simulated calls, in order — when a table is queried more than once. */
function callsOf<T = Record<string, unknown>>(fn: unknown): T[] {
  return (fn as { mock: { calls: unknown[][] } }).mock.calls.map((call) => call[0] as T);
}

/**
 * `Department` is now queried TWICE, for two unrelated reasons: `search.ts` resolves the labels to identifiers there before searching the tasks
 * (for every role, returning nothing), and `searchExtras` searches the reference there to offer — to the roles that can open it only. Only the
 * second carries a scope `OR` (studio or project): that is what distinguishes them, and it is the one these tests target.
 */
const departmentReferentialCalls = (): { where: Record<string, unknown>; take?: number }[] =>
  callsOf<{ where: Record<string, unknown>; take?: number }>(prisma.department.findMany).filter(
    (args) => 'OR' in args.where,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.projectMembership.findMany).mockResolvedValue([
    { projectId: 3 },
    { projectId: 9 },
  ] as never);
});

describe('projectScope', () => {
  it('opens the whole studio to global roles', () => {
    expect(projectScope(1, Role.ADMIN)).toEqual({ deletedAt: null });
    expect(projectScope(1, Role.SUPERVISOR)).toEqual({ deletedAt: null });
  });

  it('bounds everyone else to their projects, trash excluded', () => {
    expect(projectScope(ARTIST_ID, Role.ARTIST)).toEqual(MEMBER_SCOPE);
    expect(projectScope(ARTIST_ID, Role.CLIENT)).toEqual(MEMBER_SCOPE);
  });
});

describe('searchEntities — an ARTIST only sees their projects', () => {
  beforeEach(async () => {
    await searchEntities('sh0120', ARTIST_ID, Role.ARTIST);
  });

  it('filters the five pipeline types by membership', () => {
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

  it('filters versions by the project of their shot or carrying asset', () => {
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

  it('shows an unpublished media only to its uploader', () => {
    const where = whereOf(prisma.mediaObject.findMany) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toMatchObject({
      deletedAt: null,
      status: 'READY',
      OR: [{ published: true }, { published: false, uploaderId: ARTIST_ID }],
    });
  });

  it('filters playlists by project', () => {
    expect(whereOf(prisma.playlist.findMany)).toMatchObject({ project: MEMBER_SCOPE });
  });

  it('passes to the full-text search only the projects they are a member of', () => {
    expect(vi.mocked(searchComments)).toHaveBeenCalledWith('sh0120', {
      userId: ARTIST_ID,
      role: Role.ARTIST,
      projectIds: [3, 9],
      limit: SEARCH_LIMITS.comments,
    });
  });

  it('searches the studio directory, addresses included, but without service accounts or closed accounts', () => {
    const where = whereOf(prisma.user.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ isService: false, disabledAt: null });
    expect(where).not.toHaveProperty('memberships');
    expect(where.OR.some((c) => 'email' in c)).toBe(true);
  });
});

describe('searchEntities — a CLIENT is an external contributor', () => {
  beforeEach(async () => {
    await searchEntities('reflet', ARTIST_ID, Role.CLIENT);
  });

  it('sees no draft, not even their own', () => {
    const where = whereOf(prisma.mediaObject.findMany) as { AND: Record<string, unknown>[] };
    expect(where.AND[0]).toMatchObject({ published: true });
    expect(where.AND[0]).not.toHaveProperty('OR');
  });

  it('finds only the people of the projects they share, and never by address', () => {
    const where = whereOf(prisma.user.findMany) as {
      OR: Record<string, unknown>[];
      memberships: unknown;
    };
    expect(where.memberships).toEqual({
      some: { project: { deletedAt: null, memberships: { some: { userId: ARTIST_ID } } } },
    });
    expect(where.OR.some((c) => 'email' in c)).toBe(false);
  });

  it('stays bounded to their projects for review notes', () => {
    expect(vi.mocked(searchComments)).toHaveBeenCalledWith(
      'reflet',
      expect.objectContaining({ role: Role.CLIENT, projectIds: [3, 9] }),
    );
  });
});

describe('searchEntities — global roles', () => {
  it('requires no membership and does not query the members table', async () => {
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

describe('searchEntities — bounded results', () => {
  it('imposes a limit on each of the types', async () => {
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
      departments: departmentReferentialCalls()[0]!.take,
      timelines: argsOf<{ take: number }>(prisma.timeline.findMany).take,
      boards: argsOf<{ take: number }>(prisma.board.findMany).take,
      briefs: argsOf<{ take: number }>(prisma.entityNote.findMany).take,
    };
    for (const [type, take] of Object.entries(takes)) {
      expect(take, type).toBe(SEARCH_LIMITS[type as keyof typeof SEARCH_LIMITS]);
    }
  });

  it('bounds each family, without exception', async () => {
    await searchEntities('v012', 1, Role.ADMIN);
    for (const limit of Object.values(SEARCH_LIMITS)) expect(limit).toBeGreaterThan(0);
  });
});

/**
 * What the product contains and the search ignored.
 *
 * Five families returned nothing, whatever was typed: "Modeling" (a department), the code of an episode, an edit, a board, and the text of an
 * entity sheet — that is, the brief, the only place where what a shot must become is written. The scoping of each is checked here as the first ten
 * were: on the `where` clause.
 */
describe('searchEntities — the families added', () => {
  beforeEach(async () => {
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
  });

  it('searches the episodes of the project, neither removed nor hidden', () => {
    const where = whereOf(prisma.episode.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE });
    expect(where.OR.map((clause) => Object.keys(clause)[0])).toEqual(['code', 'name', 'description']);
  });

  it('discards the edit of a hidden or removed sequence', () => {
    const where = whereOf(prisma.timeline.findMany) as { OR: Record<string, unknown>[] };
    expect(where).toMatchObject({ project: MEMBER_SCOPE });
    expect(where.OR).toEqual([{ sequenceId: null }, { sequence: { deletedAt: null, hiddenAt: null } }]);
  });

  it('only offers the board of an accessible project or a visible asset', () => {
    const where = whereOf(prisma.board.findMany) as { OR: Record<string, unknown>[] };
    expect(where.OR[0]).toMatchObject({ project: MEMBER_SCOPE });
    expect(where.OR[1]).toMatchObject({
      asset: { deletedAt: null, hiddenAt: null, project: MEMBER_SCOPE },
    });
  });

  it('searches a sheet only under a visible entity of an accessible project', () => {
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

  it('finds a task by its department: "Modeling" returned nothing', async () => {
    // The label of the step does not live in `Task`: it is resolved to identifiers first
    // (cf. `matchingDepartmentIds`), then applied as a column of `Task`.
    vi.mocked(prisma.department.findMany).mockResolvedValueOnce([{ id: 4 }] as never);
    await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    const where = callsOf<{ where: { AND: { OR: Record<string, unknown>[] }[] } }>(prisma.task.findMany).at(
      -1,
    )!.where;
    const fields = where.AND[0]!.OR.map((clause) => Object.keys(clause)[0]);
    expect(fields).toEqual(['name', 'department', 'departmentId']);
    expect(where.AND[0]!.OR[2]).toEqual({ departmentId: { in: [4] } });
  });
});

describe('searchEntities — departments are only offered to those who can open them', () => {
  it('ignores them for an ARTIST and for a CLIENT — the screen would be refused to them', async () => {
    const artist = await searchEntities('modeling', ARTIST_ID, Role.ARTIST);
    expect(departmentReferentialCalls()).toHaveLength(0);
    expect(artist.departments).toEqual([]);
    const client = await searchEntities('modeling', ARTIST_ID, Role.CLIENT);
    expect(departmentReferentialCalls()).toHaveLength(0);
    expect(client.departments).toEqual([]);
  });

  it('returns the studio reference and the steps of accessible projects to an ADMIN', async () => {
    await searchEntities('modeling', 1, Role.ADMIN);
    const where = departmentReferentialCalls()[0]!.where as {
      OR: Record<string, unknown>[];
      AND: { OR: Record<string, unknown>[] }[];
    };
    expect(where).toMatchObject({ deletedAt: null });
    expect(where.OR).toEqual([{ projectId: null }, { project: { deletedAt: null } }]);
    expect(where.AND[0]!.OR.map((clause) => Object.keys(clause)[0])).toEqual(['name', 'key']);
  });
});

describe('searchEntities — formatting of the families added', () => {
  it('returns an unnamed edit as-is: its label is translated on screen', async () => {
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

  it('returns a board with the name of what it illustrates, project or asset', async () => {
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

  it('returns the sheet with its carrier and an excerpt around the searched term', async () => {
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

  it('does not return a sheet without a carrying entity — it would open no page', async () => {
    vi.mocked(prisma.entityNote.findMany).mockResolvedValue([
      { id: 8, body: 'fiche de projet', episode: null, sequence: null, shot: null, asset: null },
    ] as never);
    const res = await searchEntities('fiche', 1, Role.ADMIN);
    expect(res.briefs).toEqual([]);
  });

  it('returns the department of a task, its key in default of the relation', async () => {
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

  it('places the task NAMED comp before the tasks of the Compositing step', async () => {
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

describe('searchEntities — formatting of the results', () => {
  it('returns the readable path of a version and its navigation target', async () => {
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

  it('returns a version without a visible media with no target, never an error', async () => {
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

  it('returns the media with its shot and its version number', async () => {
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

  it('never returns a person\'s address, and tolerates an account without a name', async () => {
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
 * What the search finds, and in which order.
 *
 * Two distinct promises: searching **beyond the name** (a shot is found by what it is about, not only by its code), and **ranking** — each list came
 * out in database order, so typing "SH0120" placed the shot SH0120 after three media whose file name contains it.
 */
describe('searchEntities — scope and ranking', () => {
  it('also searches the description of a shot, a sequence and an asset', async () => {
    await searchEntities('pluie', ARTIST_ID, Role.ARTIST);
    for (const delegate of [prisma.shot, prisma.sequence, prisma.asset]) {
      const where = whereOf(delegate.findMany) as { OR: Record<string, unknown>[] };
      expect(where.OR.some((clause) => 'description' in clause)).toBe(true);
    }
  });

  it('brings up the sharpest match, not the most recent', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValueOnce([
      // Database order: most recent first. The second one is nevertheless what is sought.
      { id: 1, code: 'SH0121', name: 'SH0121', description: null, projectId: 1 },
      { id: 2, code: 'SH0120', name: 'SH0120', description: null, projectId: 1 },
      { id: 3, code: 'EP01_SH0120_old', name: 'x', description: null, projectId: 1 },
    ] as never);

    const results = await searchEntities('SH0120', ARTIST_ID, Role.ARTIST);

    expect(results.shots.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('prefers an exact description to a fragment lost in a code', async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValueOnce([
      { id: 1, name: 'xpluiex', description: null, type: 'PROP', projectId: 1 },
      { id: 2, name: 'Robot', description: 'pluie', type: 'PROP', projectId: 1 },
    ] as never);

    const results = await searchEntities('pluie', ARTIST_ID, Role.ARTIST);

    expect(results.assets[0]!.id).toBe(2);
  });

  it('loses no result while ranking', async () => {
    vi.mocked(prisma.shot.findMany).mockResolvedValueOnce([
      { id: 1, code: 'A', name: 'A', description: null, projectId: 1 },
      { id: 2, code: 'B', name: 'B', description: null, projectId: 1 },
    ] as never);

    const results = await searchEntities('néant', ARTIST_ID, Role.ARTIST);

    expect(results.shots).toHaveLength(2);
  });
});
