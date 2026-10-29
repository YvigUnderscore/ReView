// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import {
  firstMediaThumbKeyForAsset,
  firstMediaThumbKeysForAssets,
  effectiveThumbnailUrl,
} from '../lib/thumbnails';
import { type PaginationParams, pageArgs, paginateCursor, withCursor } from '../lib/pagination';
import { CARD_ASSIGNEE_SELECT, awaitingReviewByAsset, signAssignees } from '../lib/entityCardData';
import { unseenByAsset } from './EntityVisitService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { emitToProject } from './SocketService';

/** Business logic of assets. Project access (RBAC) is asserted in the route (10.D8). */

/**
 * Versions and tasks returned by an asset's detail.
 *
 * The detail displays them as one block, without pagination: the cap prevents an asset reused a hundred
 * times (a feature-film set) from making the page proportional to its history. The `_count` counters give
 * the real numbers.
 */
const DETAIL_LIMIT = 200;

/**
 * Paginated assets of a project + thumbnails.
 *
 * The name is unique per project, so it is already discriminating, but the tie-break on `id` is applied
 * anyway: it is the same rule everywhere, and no longer depends on the model's uniqueness constraint. The
 * cursor follows the `(name, id)` pair.
 */
export async function list(
  projectId: number,
  p: PaginationParams,
  /** Who is looking: "not yet viewed" state (batch 9). Absent: no card lights up. */
  userId?: number,
) {
  // `hiddenAt`: a hidden asset appears in no list; see ShotService.list.
  const where = { projectId, deletedAt: null, hiddenAt: null };
  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where: withCursor(where, p, 'name', 'asc'),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { versions: true, tasks: true } },
        // Steps and assignees: the cards' context menu needs them to tick the current state. Without them,
        // one query per displayed card would be required.
        departments: {
          select: { id: true, key: true, name: true, color: true },
          orderBy: { order: 'asc' },
        },
        tasks: {
          select: {
            id: true,
            departmentId: true,
            // The step name comes from here: a task may live in a department the asset does not declare, and
            // the menu must still be able to name it.
            departmentRef: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
        },
        assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
      },
    }),
    prisma.asset.count({ where }),
  ]);
  // Grouped query (B3); see ShotService.list.
  const ids = assets.map((a) => a.id);
  const [fallbacks, awaiting, unseen] = await Promise.all([
    firstMediaThumbKeysForAssets(ids),
    awaitingReviewByAsset(ids),
    // "Not viewed": the asset's activity (its tasks, its deliveries through BOTH attachment paths, its media)
    // compared with my last visit.
    userId ? unseenByAsset(userId, assets) : Promise.resolve(new Map<number, boolean>()),
  ]);
  const signed = await signAssignees(assets);
  const items = await Promise.all(
    signed.map(async (a) => ({
      ...a,
      thumbnailUrl: await effectiveThumbnailUrl(a.thumbnailKey, fallbacks.get(a.id) ?? null),
      awaitingReview: awaiting.get(a.id) ?? 0,
      unseen: unseen.get(a.id) ?? false,
    })),
  );
  return paginateCursor(items, total, p, (a) => a.name);
}

/** Full detail of an asset (versions, tasks, attachments, thumbnail). */
export async function getDetail(id: number) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      _count: { select: { versions: true, tasks: true } },
      versions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DETAIL_LIMIT },
      tasks: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        take: DETAIL_LIMIT,
        include: { assignee: { select: { id: true, name: true } } },
      },
      shots: {
        where: { deletedAt: null, hiddenAt: null },
        select: { id: true, code: true, name: true, sequenceId: true },
      },
      sequences: { where: { deletedAt: null, hiddenAt: null }, select: { id: true, code: true, name: true } },
      // Departments traversed (B1): the settings panel ticks them (C3).
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!asset) throw notFound('Asset not found');
  // The thumbnail was only computed in the list: an asset's page never showed the image, whereas a shot's
  // page did.
  const thumbnailUrl = await effectiveThumbnailUrl(asset.thumbnailKey, await firstMediaThumbKeyForAsset(id));
  return { ...asset, thumbnailUrl };
}

export interface CreateAssetInput {
  projectId: number;
  name: string;
  type: AssetType;
  description?: string;
}

/**
 * Creates an asset. The ShotGrid lock (48) is checked by the route BEFORE arriving here: it carries a remote
 * creation link that only the HTTP layer knows how to present.
 */
export async function create(body: CreateAssetInput) {
  const { projectId, name, type, description } = body;
  if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name } } }))
    throw badRequest('An asset with this name already exists', 'NAME_TAKEN');
  return prisma.asset.create({
    data: { projectId, name, type, description: description ?? null },
  });
}

export interface UpdateAssetInput {
  name?: string;
  type?: AssetType;
  /**
   * Exact label of the type as the studio names it (C3). The column existed since phase 48 but was only
   * written by the ShotGrid sync: a standalone studio could not name its own types.
   */
  typeLabel?: string | null;
  description?: string | null;
  pipelineStatusId?: number | null;
  thumbnailKey?: string | null;
  shotIds?: number[];
  sequenceIds?: number[];
}

/**
 * Updates an asset and, where applicable, its attachments. Shots and sequences are verified to belong to
 * the asset's project: an identifier coming from another project would create an invisible link from both
 * affected screens.
 */
export async function update(projectId: number, id: number, body: UpdateAssetInput) {
  const { shotIds, sequenceIds, ...scalar } = body;
  // The status must come from THIS project's vocabulary, as for a task or a shot: the identifier of a status
  // imported from another project's site would pass silently. the identifier of a status imported from
  // another project's site would pass silently.
  if (body.pipelineStatusId !== undefined) {
    await PipelineStatusService.assertBelongsToProject(projectId, 'asset', body.pipelineStatusId);
  }
  if (shotIds && shotIds.length > 0) {
    const ok = await prisma.shot.count({ where: { id: { in: shotIds }, projectId } });
    if (ok !== shotIds.length) throw badRequest('This shot does not belong to this project', 'BAD_SHOT');
  }
  if (sequenceIds && sequenceIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: sequenceIds }, projectId } });
    if (ok !== sequenceIds.length)
      throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
  }
  const updated = await prisma.asset.update({
    where: { id },
    data: {
      ...scalar,
      ...(shotIds ? { shots: { set: shotIds.map((sid) => ({ id: sid })) } } : {}),
      ...(sequenceIds ? { sequences: { set: sequenceIds.map((sid) => ({ id: sid })) } } : {}),
    },
    include: {
      shots: {
        where: { deletedAt: null, hiddenAt: null },
        select: { id: true, code: true, name: true, sequenceId: true },
      },
      sequences: { where: { deletedAt: null, hiddenAt: null }, select: { id: true, code: true, name: true } },
    },
  });
  // Same reason as for a shot or a sequence: the front end listens for `asset:update`, but only
  // `PipelineEnsureService` and the ShotGrid sync emitted it, never the ordinary edit path. A changed status
  // or attachment stayed invisible on an already open screen until reload.
  emitToProject(projectId, 'asset:update', { projectId, id });
  // 48: attachments are propagated to ShotGrid, which carries these links on the asset.
  if (shotIds || sequenceIds) await enqueuePush(projectId, { type: 'asset-links', assetId: id });
  // The status goes back to the site: otherwise the next sync would bring back the old one and the change
  // would cancel itself.
  if (body.pipelineStatusId !== undefined) {
    await enqueuePush(projectId, { type: 'asset-status', assetId: id });
  }
  return updated;
}
