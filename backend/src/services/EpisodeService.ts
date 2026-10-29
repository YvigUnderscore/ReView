// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeyForEpisode,
  firstMediaThumbKeysForEpisodes,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';
import { pageArgs, paginate, type PaginationParams } from '../lib/pagination';

/**
 * The Episode level — business logic.
 *
 * An episode groups sequences; it carries no shot or version of its own. It is an **optional level per
 * project**: as long as `Project.episodesEnabled` is false — which is the default — the server refuses any
 * episode write and the screens show no trace of it. A feature film therefore sees nothing change.
 *
 * Disabling the setting on a project that already has episodes destroys NOTHING: the rows remain, so do the
 * attachments, and everything reappears intact on reactivation. This is the only defensible behaviour — the
 * alternative (detaching or deleting) would turn a display switch into an irreversible destructive operation,
 * on data nobody asked to lose. In return, episode reads answer 409 while the setting is off: nothing must be
 * readable or writable through a guessed URL while the interface pretends the level does not exist.
 */

/**
 * Sequences and shots returned by an episode's record. Same reason as for a sequence's record: the page is
 * not paginated, but it cannot be unbounded. A series episode carries 100 to 300 shots; the cap does not bite
 * on them.
 */
const DETAIL_LIMIT = 500;

// ───────────────────────────── The setting ─────────────────────────────

/** Is the Episode level enabled on this project? False for an unknown project. */
export async function isEnabled(projectId: number): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { episodesEnabled: true },
  });
  return project?.episodesEnabled ?? false;
}

/**
 * Refuses the operation when the level is switched off.
 *
 * 409 rather than 403: this is not a matter of rights but of the project's state — the same request will
 * succeed as soon as the studio enables the level.
 */
export async function assertEnabled(projectId: number): Promise<void> {
  if (!(await isEnabled(projectId))) {
    throw conflict('The Episode level is disabled on this project', 'EPISODES_DISABLED');
  }
}

/** What the settings screen needs to know in order to offer the switch. */
export interface EpisodeSettings {
  enabled: boolean;
  /** Live episodes — what deactivation is going to hide, and nothing more. */
  episodeCount: number;
  /** Sequences already attached: the count the warning displays. */
  linkedSequenceCount: number;
}

export async function readSettings(projectId: number): Promise<EpisodeSettings> {
  const [project, episodeCount, linkedSequenceCount] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { episodesEnabled: true } }),
    prisma.episode.count({ where: { projectId, deletedAt: null, hiddenAt: null } }),
    prisma.sequence.count({
      where: { projectId, deletedAt: null, hiddenAt: null, episodeId: { not: null } },
    }),
  ]);
  if (!project) throw notFound('Project not found');
  return { enabled: project.episodesEnabled, episodeCount, linkedSequenceCount };
}

/** Toggles the setting. No episode is touched — see the file header. */
export async function setEnabled(projectId: number, enabled: boolean): Promise<EpisodeSettings> {
  await prisma.project.update({ where: { id: projectId }, data: { episodesEnabled: enabled } });
  return readSettings(projectId);
}

// ───────────────────────────── Reading ─────────────────────────────

/** Paginated list of a project's episodes, sorted like sequences (`order`, then `id`). */
export async function list(projectId: number, p: PaginationParams) {
  // `hiddenAt`: a hidden episode disappears from lists — see ShotService.list.
  const where = { projectId, deletedAt: null, hiddenAt: null };
  const [episodes, total] = await Promise.all([
    prisma.episode.findMany({
      where,
      // Tie-break on `id`: an import leaves all episodes at `order = 0`, and without a tie-break page 2 would
      // redisplay rows from page 1.
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { sequences: { where: { deletedAt: null, hiddenAt: null } } } },
      },
    }),
    prisma.episode.count({ where }),
  ]);
  const { pageCount, hasMore } = paginate(episodes, total, p);
  // Effective thumbnail of each episode, in one pass: its own if one was chosen, otherwise the first image
  // found among its shots. Without this, the list returned the storage
  // key and no URL — the episode cards could not display anything.
  const withThumbs = await signEpisodeThumbnails(episodes);
  // Project sequences that no episode claims: an ongoing split always leaves some, and hiding them would make
  // the project look empty.
  const unassignedSequences = await prisma.sequence.count({
    where: { projectId, deletedAt: null, hiddenAt: null, episodeId: null },
  });
  return {
    episodes: withThumbs,
    unassignedSequences,
    total,
    page: p.page,
    pageSize: p.pageSize,
    pageCount,
    hasMore,
  };
}

/** Effective thumbnail of a list of episodes, in one pass (project list). */
export async function signEpisodeThumbnails<T extends { id: number; thumbnailKey: string | null }>(
  rows: T[],
): Promise<(T & { thumbnailUrl: string | null })[]> {
  const fallbacks = await firstMediaThumbKeysForEpisodes(rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      thumbnailUrl: await effectiveThumbnailUrl(row.thumbnailKey, fallbacks.get(row.id) ?? null),
    })),
  );
}

/** Full record: the episode's sequences, and the shots of those sequences. */
export async function getDetail(id: number) {
  const episode = await prisma.episode.findUnique({
    where: { id },
    include: {
      sequences: {
        where: { deletedAt: null, hiddenAt: null },
        orderBy: [{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: {
          _count: { select: { shots: { where: { deletedAt: null, hiddenAt: null } } } },
        },
      },
      _count: { select: { sequences: { where: { deletedAt: null, hiddenAt: null } } } },
    },
  });
  if (!episode) throw notFound('Episode not found');

  const shots = await prisma.shot.findMany({
    where: { deletedAt: null, hiddenAt: null, sequence: { episodeId: id, deletedAt: null } },
    orderBy: [{ sequenceId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    take: DETAIL_LIMIT,
    select: {
      id: true,
      code: true,
      name: true,
      sequenceId: true,
      order: true,
      startFrame: true,
      endFrame: true,
      omitted: true,
      thumbnailKey: true,
      pipelineStatusId: true,
    },
  });
  // A grouped pass for the whole page, as for a sequence's record: the unit variant would sign one MinIO URL
  // per shot, i.e. three hundred round trips.
  const fallbacks = await firstMediaThumbKeysForShots(shots.map((s) => s.id));
  const shotsWithThumbs = await Promise.all(
    shots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
    })),
  );

  return {
    ...episode,
    shots: shotsWithThumbs,
    shotCount: shotsWithThumbs.length,
    thumbnailUrl: await effectiveThumbnailUrl(episode.thumbnailKey, await firstMediaThumbKeyForEpisode(id)),
  };
}

// ───────────────────────────── Writing ─────────────────────────────

export interface EpisodeInput {
  name: string;
  code: string;
  order?: number;
}

/** First code already taken among those of the batch — `null` if the batch is free. */
export function firstDuplicate(codes: string[]): string | null {
  return codes.find((c, i) => codes.indexOf(c) !== i) ?? null;
}

export async function create(projectId: number, input: EpisodeInput) {
  await assertEnabled(projectId);
  const taken = await prisma.episode.findUnique({
    where: { projectId_code: { projectId, code: input.code } },
  });
  if (taken) throw badRequest('An episode with this code already exists', 'CODE_TAKEN');
  return prisma.episode.create({
    data: { projectId, name: input.name, code: input.code, order: input.order ?? 0 },
  });
}

/** Batch creation: a duplicate within the batch or in the database cancels everything; nothing is created. */
export async function createBulk(projectId: number, items: EpisodeInput[]) {
  await assertEnabled(projectId);
  const codes = items.map((i) => i.code);
  const dup = firstDuplicate(codes);
  if (dup) throw badRequest(`Duplicate code in the batch: ${dup}`, 'CODE_DUP');
  const existing = await prisma.episode.findMany({
    where: { projectId, code: { in: codes }, deletedAt: null },
    select: { code: true },
  });
  if (existing.length > 0) {
    throw badRequest(`Code already in use: ${existing.map((e) => e.code).join(', ')}`, 'CODE_TAKEN');
  }
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.episode.create({
        data: { projectId, name: it.name, code: it.code, order: it.order ?? idx },
      }),
    ),
  );
}

export interface UpdateEpisodeInput {
  name?: string;
  code?: string;
  order?: number;
  description?: string | null;
  pipelineStatusId?: number | null;
}

export async function update(id: number, projectId: number, body: UpdateEpisodeInput) {
  await assertEnabled(projectId);
  if (body.code !== undefined) {
    const clash = await prisma.episode.findFirst({
      where: { projectId, code: body.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw badRequest('An episode with this code already exists', 'CODE_TAKEN');
  }
  return prisma.episode.update({ where: { id }, data: body });
}

/**
 * Reordering: the list received gives the new order, from first to last.
 *
 * Identifiers foreign to the project are refused in bulk rather than ignored — a partially applied request
 * would leave an order that nobody asked for.
 */
export async function reorder(projectId: number, ids: number[]): Promise<void> {
  await assertEnabled(projectId);
  const owned = await prisma.episode.findMany({
    where: { id: { in: ids }, projectId, deletedAt: null },
    select: { id: true },
  });
  if (owned.length !== ids.length) {
    throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
  await prisma.$transaction(
    ids.map((id, index) => prisma.episode.update({ where: { id }, data: { order: index } })),
  );
}

/**
 * Attaches (or detaches, with `null`) sequences to an episode.
 *
 * Both sides are checked: the sequence must belong to the project, and so must the episode. Without this, a
 * sequence identifier borrowed from another project would end up in a neighbouring film's
 * episode — and the attachment would not be visible from the page.
 */
export async function assignSequences(
  projectId: number,
  episodeId: number | null,
  sequenceIds: number[],
): Promise<number> {
  await assertEnabled(projectId);
  if (episodeId !== null) {
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!episode) throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
  const { count } = await prisma.sequence.updateMany({
    where: { id: { in: sequenceIds }, projectId, deletedAt: null },
    data: { episodeId },
  });
  return count;
}

// The trash (soft delete, restore, purge) lives in `lib/trash`, together with that of sequences, shots and
// assets: it is from there that multiple selection and the retention sweep drive it.
