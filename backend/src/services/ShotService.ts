// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  firstMediaThumbKeyForShot,
  firstMediaThumbKeysForShots,
  effectiveThumbnailUrl,
} from '../lib/thumbnails';
import { emitToProject } from './SocketService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';
import { badRequest, notFound } from '../lib/errors';
import { type PaginationParams, pageArgs, paginateCursor, withCursor } from '../lib/pagination';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertDescriptionWritable } from './shotgrid/ShotgridGuardService';
import { CARD_ASSIGNEE_SELECT, awaitingReviewByShot, signAssignees } from '../lib/entityCardData';
import { unseenByShot } from './EntityVisitService';

/**
 * Business logic for shots (list + thumbnails, single/batch creation with code uniqueness per
 * sequence, asset attachment, trash). Project access (RBAC) is asserted in the route; these functions
 * receive validated parameters (10.D8).
 */

/**
 * Episode filter for a list of shots (optional level, see `EpisodeService`).
 *
 * A shot does not belong to an episode directly: its sequence carries one. The filter therefore goes
 * through the relation, and `none` designates the shots whose sequence is outside any episode, as well
 * as those with no sequence at all, which are outside any episode by construction. Undefined: no
 * restriction, exactly the previous behaviour.
 */
export function episodeWhere(episode: number | 'none' | undefined): Prisma.ShotWhereInput {
  if (episode === undefined) return {};
  if (episode === 'none') return { OR: [{ sequenceId: null }, { sequence: { episodeId: null } }] };
  return { sequence: { episodeId: Number(episode) } };
}

/**
 * Paginated shots of a project (sequence filter: id, `none` = outside any sequence, or all;
 * episode filter: id, `none` = outside any episode, or all) plus thumbnails.
 *
 * Sorting is tie-broken on `id`: an incremental ShotGrid import leaves every shot created with
 * `order = 0`, and without a tie-break Postgres is free to return these ties in a different order from
 * one page to the next, so page 2 shows shots of page 1 again and skips as many. The cursor (`p.cursor`)
 * follows the same `(order, id)` pair.
 */
export async function list(
  projectId: number,
  seq: number | 'none' | undefined,
  p: PaginationParams,
  episode?: number | 'none',
    /**
     * Who is looking, for the "unseen" state (batch 9). Absent (share surface, which has no account), no
     * card lights up: the glow is a personal notion.
     */
  userId?: number,
) {
  const seqFilter =
    seq === 'none' ? { sequenceId: null } : seq !== undefined ? { sequenceId: Number(seq) } : {};
    // `hiddenAt`: a hidden shot (VisibilityService) appears in no list, for anyone. The filter is
    // unconditional, including for an admin, who manages hidden items from the administration screen
    // provided for that and nowhere else. Letting it show "for admins only" would have made every count
    // wrong depending on who is looking.
  const where = { projectId, deletedAt: null, hiddenAt: null, ...seqFilter, ...episodeWhere(episode) };
  const [shots, total] = await Promise.all([
    prisma.shot.findMany({
      where: withCursor(where, p, 'order', 'asc'),
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        _count: { select: { tasks: true } },
        assets: { where: { deletedAt: null, hiddenAt: null }, select: { id: true, name: true, type: true } },
                // Steps traversed (B1): the department filter of the Shots tab relies on them. The shot sheet
                // returned them, the list did not: choosing a department therefore emptied the screen, with no
                // step to compare on each card.
        departments: {
          select: { id: true, key: true, name: true, color: true },
          orderBy: { order: 'asc' },
        },
                // Steps and assignees, as in `AssetService.list`: the "Assign" submenu of the right-click
                // reads `hasTask` per department. Without them it showed fully greyed out on a project driven
                // from ShotGrid: the two tabs diverged for that reason alone.
        tasks: {
          select: {
            id: true,
            departmentId: true,
            departmentRef: { select: { id: true, name: true } },
            assignee: { select: { id: true, name: true } },
          },
        },
                // The people responsible for the shot: the card shows them as photos. Without them here,
                // each card would have issued its own query.
        assignees: { select: CARD_ASSIGNEE_SELECT, orderBy: { id: 'asc' } },
      },
    }),
    prisma.shot.count({ where }),
  ]);
    // One grouped query for the whole page (B3): the per-item variant inside a `.map` sent one query
    // and one MinIO signature per shot, that is two hundred round trips for a page of a hundred.
  const ids = shots.map((s) => s.id);
  const [fallbacks, awaiting, unseen] = await Promise.all([
    firstMediaThumbKeysForShots(ids),
    awaitingReviewByShot(ids),
        // "Unseen": the shot's activity (its own, its tasks', its deliveries' and their media) compared
        // with my last visit. The computation is grouped like the two previous ones, for the same reason.
    userId ? unseenByShot(userId, shots) : Promise.resolve(new Map<number, boolean>()),
  ]);
  const signed = await signAssignees(shots);
  const items = await Promise.all(
    signed.map(async (s) => ({
      ...s,
      thumbnailUrl: await effectiveThumbnailUrl(s.thumbnailKey, fallbacks.get(s.id) ?? null),
      awaitingReview: awaiting.get(s.id) ?? 0,
      unseen: unseen.get(s.id) ?? false,
    })),
  );
  return paginateCursor(items, total, p, (s) => s.order);
}

/** Checks that the sequence (if given) does belong to the project. */
async function assertSequenceInProject(sequenceId: number | null | undefined, projectId: number) {
  if (!sequenceId) return;
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId }, select: { projectId: true } });
  if (!seq || seq.projectId !== projectId)
    throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
}

export interface CreateShotInput {
  projectId: number;
  sequenceId?: number | null;
  name: string;
  code: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
  settings?: Prisma.InputJsonValue;
}

export async function create(input: CreateShotInput) {
  await assertProjectWritable(input.projectId); // 38.B: archived project is read-only
  await assertSequenceInProject(input.sequenceId, input.projectId);
    // Code uniqueness per sequence (shots without a sequence form a group of their own).
  const clash = await prisma.shot.findFirst({
    where: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      code: input.code,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (clash) throw badRequest('A shot with this code already exists in this sequence', 'CODE_TAKEN');
  return prisma.shot.create({
    data: {
      projectId: input.projectId,
      sequenceId: input.sequenceId ?? null,
      name: input.name,
      code: input.code,
      startFrame: input.startFrame ?? null,
      endFrame: input.endFrame ?? null,
      order: input.order ?? 0,
      settings: input.settings ?? {},
    },
  });
}

export type BulkShotItem = Omit<CreateShotInput, 'projectId'>;

export async function createBulk(projectId: number, items: BulkShotItem[]) {
  await assertProjectWritable(projectId); // 38.B
    // Referenced sequences must belong to the project.
  const seqIds = [...new Set(items.map((i) => i.sequenceId).filter((v): v is number => !!v))];
  if (seqIds.length > 0) {
    const ok = await prisma.sequence.count({ where: { id: { in: seqIds }, projectId } });
    if (ok !== seqIds.length)
      throw badRequest('This sequence does not belong to this project', 'BAD_SEQUENCE');
  }
    // Duplicates (code, sequence) within the batch.
  const key = (sid: number | null | undefined, code: string) => `${sid ?? 'none'}::${code}`;
  const keys = items.map((i) => key(i.sequenceId, i.code));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw badRequest(`Duplicate code in the batch : ${dup.split('::')[1]}`, 'CODE_DUP');
    // Conflicts with existing data.
  const existing = await prisma.shot.findMany({
    where: { projectId, deletedAt: null, code: { in: items.map((i) => i.code) } },
    select: { code: true, sequenceId: true },
  });
  const existingKeys = new Set(existing.map((e) => key(e.sequenceId, e.code)));
  const clash = items.find((i) => existingKeys.has(key(i.sequenceId, i.code)));
  if (clash)
    throw badRequest(`A shot with this code already exists in this sequence: ${clash.code}`, 'CODE_TAKEN');
  return prisma.$transaction(
    items.map((it, idx) =>
      prisma.shot.create({
        data: {
          projectId,
          sequenceId: it.sequenceId ?? null,
          name: it.name,
          code: it.code,
          startFrame: it.startFrame ?? null,
          endFrame: it.endFrame ?? null,
          order: it.order ?? idx,
        },
      }),
    ),
  );
}

/** Shot detail (sequence, tasks, assets). Also returns projectId for the access assertion. */
export async function get(id: number) {
  const shot = await prisma.shot.findUnique({
    where: { id },
    include: {
      sequence: true,
            // Tie-break on `id`: two tasks created by the same import share `order = 0`.
      tasks: {
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: { assignee: { select: { id: true, name: true } } },
      },
      assets: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
            // Departments traversed (B1): the settings panel ticks them (C3).
      departments: { select: { id: true, key: true, name: true, color: true }, orderBy: { order: 'asc' } },
    },
  });
  if (!shot) throw notFound('Shot not found');
    // The thumbnail was only computed in the list: a shot page has no list behind it, and so
    // displayed an empty header.
  return {
    ...shot,
    thumbnailUrl: await effectiveThumbnailUrl(shot.thumbnailKey, await firstMediaThumbKeyForShot(shot.id)),
  };
}

export interface UpdateShotInput {
  sequenceId?: number | null;
  name?: string;
  code?: string;
  startFrame?: number | null;
  endFrame?: number | null;
  order?: number;
  description?: string | null;
  thumbnailKey?: string | null;
  settings?: Prisma.InputJsonValue;
    /** Shot status (C3): until now written only by the ShotGrid synchronisation. */
  pipelineStatusId?: number | null;
    /** Left out of the edit (Phase 45): the shot stays in the database, timelines skip it. */
  omitted?: boolean;
}

export interface UpdateShotOptions {
    /**
     * Holds back real-time events: the caller emits them itself, once, for the whole batch
     * (see `emitShotsUpdated`). Reserved for loops; the single-item path emits as before.
     */
  deferEvents?: boolean;
}

/**
 * Real-time events for a shot modification: `shot:update` + `timeline:update`.
 *
 * Exported so that BATCH actions emit one pair of events instead of N. Thirty shots set to retake with one
 * click (the daily gesture of a production) used to mean thirty `shot:update`, hence thirty FULL reloads of
 * the kanban on the screen of each person who had it open: the heaviest read in the application, repeated
 * for nothing since only the last response survived.
 *
 * `ids` carries the batch. The payload of the SINGULAR stays exactly what it was: no `ids` field when there
 * is only one shot, and `id`/`shotId` always hold the first identifier: a consumer that ignores `ids` keeps
 * working as is.
 */
export function emitShotsUpdated(projectId: number, ids: readonly number[]): void {
  const first = ids[0];
  if (first === undefined) return;
  const batch = ids.length > 1 ? { ids: [...ids] } : {};
    // The shot itself changed: status, code, name, description, omission. Without this event, a screen
    // open on this shot, or on the project's shot list, kept the old value until reload, and the author of
    // the change believed it had not gone through. The front end has always listened to `shot:update`
    // (`socketBridge`).
  emitToProject(projectId, 'shot:update', { projectId, id: first, ...batch });
    // Order, frame range, omission, sequence: all of these move shots within the automatic timelines,
    // which must update without a reload (Phase 45).
  emitToProject(projectId, 'timeline:update', { projectId, shotId: first, ...batch });
}

export async function update(
  id: number,
  projectId: number,
  body: UpdateShotInput,
  actorId?: number | null,
  options?: UpdateShotOptions,
) {
  await assertProjectWritable(projectId); // 38.B
  await assertSequenceInProject(body.sequenceId, projectId);
    // The status must come from THIS project's vocabulary: setting the identifier of a status
    // imported from another project's site would pass silently and skew the reading.
  if (body.pipelineStatusId !== undefined) {
    await PipelineStatusService.assertBelongsToProject(projectId, 'shot', body.pipelineStatusId);
  }
    // The description may be owned by ShotGrid: writing it here would make them diverge until the
    // next synchronisation overwrites it, without telling anyone.
  if (body.description !== undefined) await assertDescriptionWritable(projectId);
    // If the code or the sequence changes, check uniqueness (code unique per sequence).
  if (body.code !== undefined || body.sequenceId !== undefined) {
    const current = await prisma.shot.findUnique({ where: { id }, select: { code: true, sequenceId: true } });
    const nextCode = body.code ?? current!.code;
    const nextSequenceId = body.sequenceId !== undefined ? body.sequenceId : current!.sequenceId;
    const conflict = await prisma.shot.findFirst({
      where: { projectId, sequenceId: nextSequenceId, code: nextCode, deletedAt: null, id: { not: id } },
      select: { id: true },
    });
    if (conflict) throw badRequest('A shot with this code already exists in this sequence', 'CODE_TAKEN');
  }
  const shot = await prisma.shot.update({ where: { id }, data: body });
    // Singular emissions, except when a batch caller groups them itself. Only `PipelineEnsureService`
    // and the ShotGrid synchronisation emitted `shot:update`, that is, none of the paths a human editing a
    // shot takes.
  if (!options?.deferEvents) emitShotsUpdated(projectId, [id]);
    // The status goes back to ShotGrid. It used to go nowhere: the shot changed state in ReView, the site
    // kept the old one, and the next synchronisation brought the site's value back. The artist saw their
    // change cancel itself out.
  if (body.pipelineStatusId !== undefined) {
    await enqueuePush(projectId, { type: 'shot-status', shotId: id, actorId });
  }
    // Description round trip, when the studio has opened it: without this push, the local change would be
    // erased by the next synchronisation.
  if (body.description !== undefined) {
    await enqueuePush(projectId, { type: 'description', kind: 'shot', id, actorId });
  }
  return shot;
}

export interface AttachAssetInput {
  assetId?: number;
  name?: string;
  type?: AssetType;
}

/** Attaches an existing asset OR creates one and attaches it to the shot. */
export async function attachAsset(shotId: number, projectId: number, body: AttachAssetInput) {
  await assertProjectWritable(projectId); // 38.B
  let assetId = body.assetId;
  if (assetId === undefined) {
    if (await prisma.asset.findUnique({ where: { projectId_name: { projectId, name: body.name! } } }))
      throw badRequest('An asset with this name already exists', 'NAME_TAKEN');
    const created = await prisma.asset.create({
      data: { projectId, name: body.name!, type: body.type ?? AssetType.OTHER },
    });
    assetId = created.id;
  } else {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } });
    if (!asset || asset.projectId !== projectId)
      throw badRequest('This asset does not belong to this project', 'BAD_ASSET');
  }
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { connect: { id: assetId } } } });
  return prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, name: true, type: true } });
}

export async function detachAsset(shotId: number, assetId: number) {
  await prisma.shot.update({ where: { id: shotId }, data: { assets: { disconnect: { id: assetId } } } });
}
