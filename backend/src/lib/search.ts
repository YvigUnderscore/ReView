// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, MediaKind, MediaStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { bestScore, rankBy } from './searchRank';
import { searchComments, type CommentHit } from './searchComments';
import { EXTRA_LIMITS, searchExtras, type Contains, type ExtraResults } from './searchExtras';

/**
 * Multi-entity global search (Ctrl+K palette).
 *
 * Fifteen types, not five: what a supervisor types most often is a version or media name (`SH0120_comp_v012`), and what they really look for is
 * sometimes a sentence said in review ("remove the reflection") — cf. `searchComments`, Postgres full text. The five families the search used to
 * ignore — episodes, departments, edits, boards, sheets — live in `searchExtras`: they are not filtered like pipeline rows.
 *
 * **Partitioning.** Each type carries its own access filter, written in the `where` clause and never afterwards:
 *  - global ADMIN / SUPERVISOR see the whole studio;
 *  - the others only see the projects they are members of;
 *  - an unpublished media belongs only to its uploader;
 *  - a CLIENT sees neither the drafts of others, nor internal notes, nor the studio directory outside the projects they share.
 * The trash (`deletedAt`) is excluded everywhere.
 */

/**
 * Number of results per type. Types whose volume follows production (shots, versions, media, notes) deserve more than the short reference lists
 * (projects, playlists, people) — the palette nevertheless stays bounded, both while typing and when rendering.
 */
export const SEARCH_LIMITS = {
  projects: 5,
  sequences: 5,
  shots: 8,
  assets: 5,
  tasks: 5,
  versions: 8,
  media: 8,
  playlists: 5,
  comments: 8,
  people: 5,
  ...EXTRA_LIMITS,
} as const;

export interface SearchResults extends ExtraResults {
  projects: { id: number; name: string }[];
  sequences: { id: number; code: string; name: string; projectId: number }[];
  shots: { id: number; code: string; name: string; projectId: number }[];
  assets: { id: number; name: string; type: string; projectId: number }[];
  tasks: {
    id: number;
    name: string;
    type: string;
    /** Department of the step — it is by this that one finds "all my Modeling tasks". */
    departmentName: string | null;
    shotId: number | null;
    assetId: number | null;
  }[];
  versions: {
    id: number;
    name: string;
    /** Most recent visible media — navigation target when it exists. */
    mediaId: number | null;
    taskId: number | null;
    assetId: number | null;
    context: string;
  }[];
  media: { id: number; name: string; kind: MediaKind; context: string }[];
  playlists: { id: number; name: string; projectName: string }[];
  comments: CommentHit[];
  /** `name` is `null` when the account has neither a handle nor a name — the screen takes care of it. */
  people: { id: number; name: string | null; jobTitle: string | null }[];
}

/** Roles that see the whole studio, membership ignored (cf. `lib/projectRoles`). */
const isGlobalRole = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Projects readable by the requester — the building block all the other filters reuse. */
export function projectScope(userId: number, role: Role): Prisma.ProjectWhereInput {
  return isGlobalRole(role) ? { deletedAt: null } : { deletedAt: null, memberships: { some: { userId } } };
}

/** Readable versions: those whose carrying shot or asset is in an accessible project. */
function versionScope(project: Prisma.ProjectWhereInput): Prisma.VersionWhereInput {
  return {
    deletedAt: null,
    OR: [
      { task: { shot: { deletedAt: null, hiddenAt: null, project } } },
      { task: { asset: { deletedAt: null, hiddenAt: null, project } } },
      { asset: { deletedAt: null, hiddenAt: null, project } },
    ],
  };
}

/**
 * Showable media: ready and published — a draft is visible only to its uploader, and never to a CLIENT (who uploads none). This filter says nothing
 * about the project: it serves as much for media search as for selecting the media of an already filtered version.
 */
function mediaVisibility(userId: number, role: Role): Prisma.MediaObjectWhereInput {
  return {
    deletedAt: null,
    status: MediaStatus.READY,
    ...(role === Role.CLIENT
      ? { published: true }
      : { OR: [{ published: true }, { published: false, uploaderId: userId }] }),
  };
}

/** Readable media: showable AND attached to a version of an accessible project. */
function mediaScope(
  project: Prisma.ProjectWhereInput,
  userId: number,
  role: Role,
): Prisma.MediaObjectWhereInput {
  return { ...mediaVisibility(userId, role), version: versionScope(project) };
}

/** Common selection "where this version comes from": shot code, asset name, task. */
const parentSelect = {
  task: {
    select: { name: true, shot: { select: { code: true } }, asset: { select: { name: true } } },
  },
  asset: { select: { name: true } },
} as const;

interface ParentRow {
  task: { name: string; shot: { code: string } | null; asset: { name: string } | null } | null;
  asset: { name: string } | null;
}

/** Readable path of a version: "SH0120 · comp" or "robot · lookdev". */
function contextOf(row: ParentRow): string {
  const holder = row.task?.shot?.code ?? row.task?.asset?.name ?? row.asset?.name ?? null;
  return [holder, row.task?.name].filter(Boolean).join(' · ');
}

/** Identifiers of the projects the requester is a member of (raw full-text query). */
async function memberProjectIds(userId: number): Promise<number[]> {
  const rows = await prisma.projectMembership.findMany({
    where: { userId, project: { deletedAt: null } },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/**
 * Departments whose label matches, resolved to identifiers BEFORE the task search.
 *
 * A task is searched by its name, by the denormalised key of its step (`lookdev`) and by the LABEL of that step ("Look Dev"), which lives in
 * `Department`. Writing all three in the same `OR` made the join cross into the third branch — and a `BitmapOr` does not cross a table: the plan
 * fell back on a full scan of `Task`, indexed or not (measured at 60,000 tasks: 775 blocks read, 25.6 ms, for a term that matches nothing).
 * Resolving the departments first brings the `OR` back onto the `Task` columns alone, which the trigrams cover (21 blocks, 1.2 ms).
 *
 * The result set is the same, term for term: `departmentRef: { deletedAt: null, name }` selected nothing other than the tasks whose `departmentId`
 * designates a live department with the matching label. The reference is deliberately not filtered by project — it was not before either — and leaks
 * nothing: it only serves to filter tasks the requester already sees. No count bound: a studio has dozens of steps, not thousands, and keeping only part of them
 * would change the results.
 */
async function matchingDepartmentIds(contains: Contains): Promise<number[]> {
  const rows = await prisma.department.findMany({
    where: { deletedAt: null, name: contains },
    select: { id: true },
  });
  return rows.map((d) => d.id);
}

export async function searchEntities(q: string, userId: number, role: Role): Promise<SearchResults> {
  const project = projectScope(userId, role);
  const version = versionScope(project);
  const media = mediaScope(project, userId, role);
  const contains: Contains = { contains: q, mode: 'insensitive' };
  // Only the task search waits on this reference: it hooks onto it, the other four start at the same time (same set-up as `commentsPromise` below).
  const departmentIdsPromise = matchingDepartmentIds(contains);

  const [projects, sequences, shots, assets, tasks] = await Promise.all([
    prisma.project.findMany({
      where: { ...project, name: contains },
      select: { id: true, name: true },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMITS.projects,
    }),
    prisma.sequence.findMany({
      // The description goes into the search field: that is where what a shot is about lives, and searching it by its code presupposes already knowing it.
      where: {
        deletedAt: null,
        hiddenAt: null,
        project,
        OR: [{ name: contains }, { code: contains }, { description: contains }],
      },
      select: { id: true, code: true, name: true, description: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.sequences,
    }),
    prisma.shot.findMany({
      where: {
        deletedAt: null,
        hiddenAt: null,
        project,
        OR: [{ name: contains }, { code: contains }, { description: contains }],
      },
      select: { id: true, code: true, name: true, description: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.shots,
    }),
    prisma.asset.findMany({
      where: {
        deletedAt: null,
        hiddenAt: null,
        project,
        OR: [{ name: contains }, { description: contains }],
      },
      select: { id: true, name: true, description: true, type: true, projectId: true },
      orderBy: { id: 'desc' },
      take: SEARCH_LIMITS.assets,
    }),
    departmentIdsPromise.then((departmentIds) =>
      prisma.task.findMany({
        // A task is also searched by its **department**: typing "Modeling" returned nothing, whereas it is the word an artist uses to designate their work.
        // The access filter stays in `OR` (Prisma joins the top-level fields with AND), the text match goes through `AND` — the two do not mix.
        where: {
          OR: [
            { shot: { deletedAt: null, hiddenAt: null, project } },
            { asset: { deletedAt: null, hiddenAt: null, project } },
          ],
          AND: [
            {
              OR: [
                { name: contains },
                // `department` is the denormalised key: a studio names its step "Look Dev" and the key stays `lookdev`, both get typed.
                { department: contains },
                // The label, for its part, was resolved to identifiers by `matchingDepartmentIds`: the `OR` thus bears only on `Task` columns,
                // the only form its indexes know how to serve. No matching department ⇒ no branch at all, rather than a useless `IN ()`.
                ...(departmentIds.length > 0 ? [{ departmentId: { in: departmentIds } }] : []),
              ],
            },
          ],
        },
        select: {
          id: true,
          name: true,
          type: true,
          shotId: true,
          assetId: true,
          department: true,
          departmentRef: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: SEARCH_LIMITS.tasks,
      }),
    ),
  ]);

  // The project identifiers only serve the full-text query (raw SQL): the string is assembled in advance so that all the searches start in parallel.
  const commentsPromise = (isGlobalRole(role) ? Promise.resolve(null) : memberProjectIds(userId)).then(
    (projectIds) => searchComments(q, { userId, role, projectIds, limit: SEARCH_LIMITS.comments }),
  );

  const [versions, mediaRows, playlists, comments, people, extras] = await Promise.all([
    prisma.version.findMany({
      where: { AND: [version, { name: contains }] },
      select: {
        id: true,
        name: true,
        taskId: true,
        assetId: true,
        ...parentSelect,
        // The project is already filtered through `version`: no need to recheck it on the media.
        media: {
          where: mediaVisibility(userId, role),
          select: { id: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMITS.versions,
    }),
    prisma.mediaObject.findMany({
      where: { AND: [media, { originalName: contains }] },
      select: {
        id: true,
        originalName: true,
        kind: true,
        version: { select: { name: true, ...parentSelect } },
      },
      orderBy: { createdAt: 'desc' },
      take: SEARCH_LIMITS.media,
    }),
    prisma.playlist.findMany({
      where: { project, name: contains },
      select: { id: true, name: true, project: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMITS.playlists,
    }),
    commentsPromise,
    searchPeople(userId, role, contains),
    searchExtras(contains, { project, role }),
  ]);

  // Ranking: each list came out in database order — most recent first — so that typing "SH0120" placed the shot SH0120 after three media whose file
  // name contains it. The score answers "how much is this what was typed?".
  return {
    projects: rankBy(projects, (p) => bestScore(q, [{ value: p.name, field: 'name' }])),
    sequences: rankBy(sequences, (row) =>
      bestScore(q, [
        { value: row.code, field: 'code' },
        { value: row.name, field: 'name' },
        { value: row.description, field: 'description' },
      ]),
    ),
    shots: rankBy(shots, (row) =>
      bestScore(q, [
        { value: row.code, field: 'code' },
        { value: row.name, field: 'name' },
        { value: row.description, field: 'description' },
      ]),
    ),
    assets: rankBy(assets, (row) =>
      bestScore(q, [
        { value: row.name, field: 'name' },
        { value: row.description, field: 'description' },
      ]),
    ),
    // The name of the task takes precedence over its department: typing "comp" must return the task named comp before the twelve tasks of the
    // Compositing step (the field weight breaks ties, the match quality comes first — cf. `searchRank`).
    tasks: rankBy(tasks, (row) =>
      bestScore(q, [
        { value: row.name, field: 'name' },
        { value: row.departmentRef?.name ?? row.department, field: 'description' },
      ]),
    ).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      departmentName: row.departmentRef?.name ?? row.department,
      shotId: row.shotId,
      assetId: row.assetId,
    })),
    versions: rankBy(versions, (v) => bestScore(q, [{ value: v.name, field: 'code' }])).map((v) => ({
      id: v.id,
      name: v.name,
      mediaId: v.media[0]?.id ?? null,
      taskId: v.taskId,
      assetId: v.assetId,
      context: contextOf(v),
    })),
    media: rankBy(mediaRows, (m) => bestScore(q, [{ value: m.originalName, field: 'name' }])).map((m) => ({
      id: m.id,
      name: m.originalName,
      kind: m.kind,
      context: [contextOf(m.version), m.version.name].filter(Boolean).join(' · '),
    })),
    playlists: playlists.map((p) => ({ id: p.id, name: p.name, projectName: p.project.name })),
    comments,
    people,
    ...extras,
  };
}

/**
 * People findable. A CLIENT is an external contributor: they only see the people of the projects they share (same rule as `UserService.listPresence`)
 * and cannot search by address — the studio directory is not theirs. Service accounts and disabled accounts are nobody to talk to.
 */
async function searchPeople(
  userId: number,
  role: Role,
  contains: { contains: string; mode: 'insensitive' },
): Promise<SearchResults['people']> {
  const isClient = role === Role.CLIENT;
  const rows = await prisma.user.findMany({
    where: {
      isService: false,
      disabledAt: null,
      ...(isClient
        ? { memberships: { some: { project: { deletedAt: null, memberships: { some: { userId } } } } } }
        : {}),
      OR: [
        { username: contains },
        { name: contains },
        { firstName: contains },
        { lastName: contains },
        ...(isClient ? [] : [{ email: contains }]),
      ],
    },
    select: { id: true, username: true, name: true, firstName: true, lastName: true, jobTitle: true },
    orderBy: { id: 'asc' },
    take: SEARCH_LIMITS.people,
  });
  return rows.map((u) => {
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return {
      id: u.id,
      // Deliberately fallback without email (cf. `searchComments.authorNameOf`): a missing name is caught on screen, a disclosed address is not.
      name: u.username ?? u.name ?? (full || null),
      jobTitle: u.jobTitle,
    };
  });
}
