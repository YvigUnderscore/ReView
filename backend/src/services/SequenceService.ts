// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import * as PipelineStatusService from './PipelineStatusService';
import { assertDescriptionWritable } from './shotgrid/ShotgridGuardService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { emitToProject } from './SocketService';
import {
  effectiveThumbnailUrl,
  firstMediaThumbKeyForSequence,
  firstMediaThumbKeysForAssets,
  firstMediaThumbKeysForSequences,
  firstMediaThumbKeysForShots,
} from '../lib/thumbnails';
import { CARD_ASSIGNEE_SELECT, awaitingReviewByShot, signAssignees } from '../lib/entityCardData';
import { unseenByShot } from './EntityVisitService';

/**
 * Business logic for sequences (C3).
 *
 * A sequence used to have no page: it was an accordion inside a tab, and its editing was hidden
 * behind a fold-out. The detail returned here is therefore that of a real sheet: its thumbnail, its
 * departments, and its shots with what is needed to recognize them (image, status, frame range)
 * rather than a list of codes.
 *
 * Shot thumbnails are resolved in a single grouped pass: the per-item variant inside a `.map` signed
 * one MinIO URL per shot, which made opening slow well before a sequence reached a hundred shots.
 */

/**
 * Shots and assets returned by a sequence's sheet.
 *
 * The sheet displays them at once: it is not paginated, but it cannot be unbounded either: a badly
 * split sequence would carry half of the feature film. The cap is high so it never bites a healthy
 * breakdown (a sequence rarely exceeds a hundred shots), and `shotCount`/`assetCount` report the real count.
 */
const DETAIL_LIMIT = 500;

export interface BulkSequenceItem {
  name: string;
  code: string;
  order?: number;
  /**
   * Host episode (optional level, see `EpisodeService`). Absent or `null`: the sequence stays outside
   * any episode, the normal state of a feature film and of a project where the level is not enabled.
   */
  episodeId?: number | null;
}

/**
 * Do the cited episodes belong to this project?
 *
 * Without this check, an identifier borrowed from another film would file the sequence under the
 * neighbour's episode, and the attachment is visible from neither page.
 */
async function assertEpisodesInProject(projectId: number, items: BulkSequenceItem[]): Promise<void> {
  const ids = [...new Set(items.map((i) => i.episodeId).filter((v): v is number => typeof v === 'number'))];
  if (ids.length === 0) return;
  const owned = await prisma.episode.count({ where: { id: { in: ids }, projectId, deletedAt: null } });
  if (owned !== ids.length) {
    throw badRequest('This episode does not belong to this project', 'BAD_EPISODE');
  }
}

/** Bulk creation: a duplicate inside the batch or in the database cancels everything; nothing is created. */
export async function createBulk(projectId: number, items: BulkSequenceItem[]) {
  const codes = items.map((i) => i.code);
  const dupInBatch = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dupInBatch) throw badRequest(`Duplicate code in the batch: ${dupInBatch}`, 'CODE_DUP');
  const existing = await prisma.sequence.findMany({
    where: { projectId, code: { in: codes }, deletedAt: null },
    select: { code: true },
  });
  if (existing.length > 0) {
    throw badRequest(`Code already in use: ${existing.map((e) => e.code).join(', ')}`, 'CODE_TAKEN');
  }
  await assertEpisodesInProject(projectId, items);
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.sequence.create({
        data: {
          projectId,
          name: it.name,
          code: it.code,
          order: it.order ?? idx,
          episodeId: it.episodeId ?? null,
        },
      }),
    ),
  );
}

/** What a sequence PATCH may carry. The route has already validated it (Zod). */
export interface UpdateSequenceInput {
  name?: string;
  code?: string;
  order?: number;
  episodeId?: number | null;
  description?: string | null;
  pipelineStatusId?: number | null;
  settings?: Prisma.InputJsonValue;
}

/**
 * Updates a sequence, with the two ShotGrid round trips it entails.
 *
 * The route used to write to the database only: the status stayed local, so the site kept the old one and
 * the next synchronisation brought its value back, cancelling the change by itself. The description was
 * not protected by anything.
 */
export async function update(
  id: number,
  projectId: number,
  body: UpdateSequenceInput,
  actorId?: number | null,
) {
  await assertProjectWritable(projectId); // 38.B: archived project is read-only
  // The description may be owned by ShotGrid: writing it here would make them diverge until the
  // next synchronisation overwrites it, without telling anyone.
  if (body.description !== undefined) await assertDescriptionWritable(projectId);
  // The status must come from THIS project's vocabulary, as for a task.
  if (body.pipelineStatusId !== undefined) {
    await PipelineStatusService.assertBelongsToProject(projectId, 'sequence', body.pipelineStatusId);
  }
  const sequence = await prisma.sequence.update({ where: { id }, data: body });
  // Same reason as for a shot: the front end listens to `sequence:update`, but nobody emitted it
  // on the ordinary edit path, so a changed status stayed invisible on a screen already open.
  emitToProject(projectId, 'sequence:update', { projectId, id });
  if (body.pipelineStatusId !== undefined) {
    await enqueuePush(projectId, { type: 'sequence-status', sequenceId: id, actorId });
  }
  if (body.description !== undefined) {
    await enqueuePush(projectId, { type: 'description', kind: 'sequence', id, actorId });
  }
  return sequence;
}

/** Full sheet of a sequence: its shots, its assets, its thumbnail, its departments. */
export async function getDetail(
  id: number,
  /** Who is looking: the "unseen" state of the sheet's shot cards (batch 9). */
  userId?: number,
) {
  const sequence = await prisma.sequence.findUnique({
    where: { id },
    include: {
      shots: {
        where: { deletedAt: null, hiddenAt: null },
        // `id` as the final tie-break: shots from an import share `order = 0`, and the code is
        // not enough when two merged sequences carry the same numbering.
        orderBy: [{ order: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: {
          _count: { select: { tasks: true } },
          assets: {
            where: { deletedAt: null, hiddenAt: null },
            select: { id: true, name: true, type: true },
          },
          // The sequence page shows its shots with the Shots-tab card: so it needs the same
          // faces.
          assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
        },
      },
      assets: {
        where: { deletedAt: null, hiddenAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        select: { id: true, name: true, type: true, typeLabel: true, thumbnailKey: true },
      },
      _count: { select: { shots: { where: { deletedAt: null, hiddenAt: null } } } },
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
      assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
      // Host episode (optional level): the sequence page turns it into a link back up. `null` on a
      // feature film, in which case the sheet shows nothing more.
      episode: { select: { id: true, code: true, name: true } },
      // The project setting, to hide the episode when the level is off: the attachment survives
      // switching off (nothing is destroyed), but it must then leave no trace on screen.
      project: { select: { episodesEnabled: true } },
    },
  });
  if (!sequence) throw notFound('Sequence not found');

  const shotIds = sequence.shots.map((s) => s.id);
  const [fallbacks, awaiting, signedShots, unseen] = await Promise.all([
    firstMediaThumbKeysForShots(shotIds),
    awaitingReviewByShot(shotIds),
    signAssignees(sequence.shots),
    // The sheet's shots carry the same card as the Shots tab: they light up under the same
    // rule, otherwise the same shot would glow differently from one screen to the next.
    userId ? unseenByShot(userId, sequence.shots) : Promise.resolve(new Map<number, boolean>()),
  ]);
  const shots = await Promise.all(
    signedShots.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
      awaitingReview: awaiting.get(s.id) ?? 0,
      unseen: unseen.get(s.id) ?? false,
    })),
  );
  // The sheet's assets were only entitled to their chosen thumbnail: they appeared empty while
  // their versions carried images. Same rule as everywhere else.
  const assetFallbacks = await firstMediaThumbKeysForAssets(sequence.assets.map((a) => a.id));
  const assets = await Promise.all(
    sequence.assets.map(async (a) => ({
      ...a,
      thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, assetFallbacks.get(a.id) ?? null),
    })),
  );

  const { project, ...rest } = sequence;
  return {
    ...rest,
    episode: project.episodesEnabled ? sequence.episode : null,
    shots,
    assets,
    thumbnailUrl: await effectiveThumbnailUrl(sequence.thumbnailKey, await firstMediaThumbKeyForSequence(id)),
  };
}

/**
 * Effective thumbnail for a list of sequences, in one pass (sidebar tree, Sequences tab, episode sheet).
 * The list used to return none: sequence cards stayed grey whatever happened, for lack of a signed URL:
 * the field was not even there.
 */
export async function signSequenceThumbnails<T extends { id: number; thumbnailKey: string | null }>(
  rows: T[],
): Promise<(T & { thumbnailUrl: string | null })[]> {
  const fallbacks = await firstMediaThumbKeysForSequences(rows.map((r) => r.id));
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      thumbnailUrl: await effectiveThumbnailUrl(row.thumbnailKey, fallbacks.get(row.id) ?? null),
    })),
  );
}
