// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';
import { bestScore, rankBy } from './searchRank';
import { excerptAround, searchTokens } from './searchComments';

/**
 * What the global search did not find.
 *
 * `searchEntities` queried ten types — the pipeline, versions, media, review notes, people — and nothing else. The product contains more: typing the
 * name of a department ("Modeling") or of an episode returned nothing at all, and edits, boards and entity sheets (the brief, where what a shot must become
 * lives) were reachable only by already knowing where to click.
 *
 * These five families live here rather than in `search.ts` for two reasons: the original file already carried its own weight, and above all these types
 * do not filter like the others — a department may belong to no project, an edit may have no name, a sheet belongs to its carrying entity more than to itself.
 *
 * **Partitioning.** Same rule as in `search.ts`: the access filter is written in the `where` clause, never applied afterwards. The trash (`deletedAt`) and the
 * hiding (`hiddenAt`) exclude everywhere, including when they bear on the **carrying** entity — the sheet of a hidden shot is not a result, it is a leak.
 */

/**
 * Number of results per type. Deliberately shorter than for shots or media: these are reference lists or unique screens, not lists that follow production,
 * and the palette must stay readable at a glance.
 */
export const EXTRA_LIMITS = {
  episodes: 5,
  departments: 5,
  timelines: 4,
  boards: 3,
  briefs: 5,
} as const;

/** Carrying entity of a sheet — it is this that decides the page to open. */
export type BriefHolder = 'episode' | 'sequence' | 'shot' | 'asset';

export interface ExtraResults {
  episodes: { id: number; code: string; name: string; projectId: number }[];
  /** `projectId` `null` = studio reference, inherited by all projects. */
  departments: { id: number; name: string; key: string; projectId: number | null }[];
  /** `name` `null` when no one has renamed the edit: the screen displays its translated label. */
  timelines: { id: number; name: string | null; projectName: string; sequenceCode: string | null }[];
  boards: { id: number; projectId: number | null; assetId: number | null; name: string }[];
  briefs: { id: number; holder: BriefHolder; holderId: number; label: string; excerpt: string }[];
}

/** Common textual filter, mounted once per `searchEntities`. */
export type Contains = { contains: string; mode: 'insensitive' };

export interface ExtraScope {
  /** Projects readable by the requester (cf. `projectScope`). */
  project: Prisma.ProjectWhereInput;
  role: Role;
}

/**
 * Departments only lead to the screens where they are configured — the studio reference (`/admin/defaults`) or the "Settings" tab of a project. Offering
 * them to someone who cannot open them promises a closed door; the artist who types "Modeling", for their part, finds their tasks of that department (cf.
 * the task search in `search.ts`).
 */
const canOpenDepartments = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** A visible production entity: neither in the trash nor hidden. */
const VISIBLE = { deletedAt: null, hiddenAt: null } as const;

/** Episodes — same sheet as a sequence: code, name, description. */
async function searchEpisodes(
  contains: Contains,
  { project }: ExtraScope,
): Promise<ExtraResults['episodes']> {
  const rows = await prisma.episode.findMany({
    where: {
      ...VISIBLE,
      project,
      OR: [{ code: contains }, { name: contains }, { description: contains }],
    },
    select: { id: true, code: true, name: true, description: true, projectId: true },
    orderBy: { id: 'desc' },
    take: EXTRA_LIMITS.episodes,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.code, field: 'code' },
      { value: row.name, field: 'name' },
      { value: row.description, field: 'description' },
    ]),
  ).map(({ id, code, name, projectId }) => ({ id, code, name, projectId }));
}

/**
 * Departments of the pipe. Two origins in the same table: the studio reference (`projectId` null, inherited everywhere) and the steps specific to a
 * project, which follow that project's access.
 */
async function searchDepartments(
  contains: Contains,
  scope: ExtraScope,
): Promise<ExtraResults['departments']> {
  if (!canOpenDepartments(scope.role)) return [];
  const rows = await prisma.department.findMany({
    where: {
      deletedAt: null,
      OR: [{ projectId: null }, { project: scope.project }],
      AND: [{ OR: [{ name: contains }, { key: contains }] }],
    },
    select: { id: true, name: true, key: true, projectId: true },
    orderBy: [{ projectId: 'asc' }, { order: 'asc' }],
    take: EXTRA_LIMITS.departments,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.name, field: 'name' },
      { value: row.key, field: 'code' },
    ]),
  );
}

/**
 * Edits. Most have no name — they are designated by what they edit: the sequence, or the whole project. So that is where the search bears, failing which
 * only the edits renamed by hand would be findable.
 */
async function searchTimelines(
  contains: Contains,
  { project }: ExtraScope,
): Promise<ExtraResults['timelines']> {
  const rows = await prisma.timeline.findMany({
    where: {
      project,
      // An edit of a removed or hidden sequence leads nowhere.
      OR: [{ sequenceId: null }, { sequence: VISIBLE }],
      AND: [
        {
          OR: [
            { name: contains },
            { sequence: { code: contains } },
            { sequence: { name: contains } },
            { project: { name: contains } },
          ],
        },
      ],
    },
    select: {
      id: true,
      name: true,
      project: { select: { name: true } },
      sequence: { select: { code: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.timelines,
  });
  return rankBy(rows, (row) =>
    bestScore(contains.contains, [
      { value: row.name, field: 'name' },
      { value: row.sequence?.code, field: 'code' },
      { value: row.project.name, field: 'description' },
    ]),
  ).map((row) => ({
    id: row.id,
    name: row.name,
    projectName: row.project.name,
    sequenceCode: row.sequence?.code ?? null,
  }));
}

/**
 * Boards. A board has no name of its own: it is that of a project or an asset, and it is that name one types. The result exists for the destination —
 * until now the palette only offered the board of the **current** project.
 */
async function searchBoards(contains: Contains, { project }: ExtraScope): Promise<ExtraResults['boards']> {
  const rows = await prisma.board.findMany({
    where: {
      OR: [{ project: { ...project, name: contains } }, { asset: { ...VISIBLE, project, name: contains } }],
    },
    select: {
      id: true,
      projectId: true,
      assetId: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.boards,
  });
  return rankBy(
    rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      assetId: row.assetId,
      name: row.project?.name ?? row.asset?.name ?? '',
    })),
    (row) => bestScore(contains.contains, [{ value: row.name, field: 'name' }]),
  );
}

/** The carrier of a sheet: only one column is filled in (CHECK `EntityNote_target_xor`). */
function holderOf(row: {
  episode: { id: number; code: string } | null;
  sequence: { id: number; code: string } | null;
  shot: { id: number; code: string } | null;
  asset: { id: number; name: string } | null;
}): { holder: BriefHolder; holderId: number; label: string } | null {
  if (row.episode) return { holder: 'episode', holderId: row.episode.id, label: row.episode.code };
  if (row.sequence) return { holder: 'sequence', holderId: row.sequence.id, label: row.sequence.code };
  if (row.shot) return { holder: 'shot', holderId: row.shot.id, label: row.shot.code };
  if (row.asset) return { holder: 'asset', holderId: row.asset.id, label: row.asset.name };
  return null;
}

/**
 * Entity sheets (the brief). This is the only place where what a shot must become lives, and it was searchable nowhere — not even from the page carrying it.
 *
 * Substring search, unlike review notes: the sheet is markdown written in one block, without a full-text index (cf. the phase report). The rendered excerpt
 * reuses the windowing of the review notes, so that the palette line shows the passage found rather than the beginning of the document.
 */
async function searchBriefs(contains: Contains, { project }: ExtraScope): Promise<ExtraResults['briefs']> {
  const rows = await prisma.entityNote.findMany({
    where: {
      body: contains,
      project,
      // A sheet without a visible carrier has no page to open: it is not a result.
      OR: [{ episode: VISIBLE }, { sequence: VISIBLE }, { shot: VISIBLE }, { asset: VISIBLE }],
    },
    select: {
      id: true,
      body: true,
      episode: { select: { id: true, code: true } },
      sequence: { select: { id: true, code: true } },
      shot: { select: { id: true, code: true } },
      asset: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: EXTRA_LIMITS.briefs,
  });
  const tokens = searchTokens(contains.contains);
  const ranked = rankBy(rows, (row) => bestScore(contains.contains, [{ value: row.body, field: 'body' }]));
  return ranked.flatMap((row) => {
    const target = holderOf(row);
    if (!target) return [];
    return [{ id: row.id, ...target, excerpt: excerptAround(row.body, tokens) }];
  });
}

/** The five families absent from `searchEntities`, queried in parallel. */
export async function searchExtras(contains: Contains, scope: ExtraScope): Promise<ExtraResults> {
  const [episodes, departments, timelines, boards, briefs] = await Promise.all([
    searchEpisodes(contains, scope),
    searchDepartments(contains, scope),
    searchTimelines(contains, scope),
    searchBoards(contains, scope),
    searchBriefs(contains, scope),
  ]);
  return { episodes, departments, timelines, boards, briefs };
}
