// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShotgridSyncLog } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { enqueuePush } from './ShotgridPushService';
import { runSync } from './ShotgridSyncService';
import { can, parseSettings } from './shotgridSettings';

/**
 * Arbitration of a conflict.
 *
 * A conflict row signals that both sides moved between two synchronizations. Marking it "resolved" without doing anything would
 * leave the gap intact: this is exactly what a "Keep ShotGrid" button must not merely do. Choosing ShotGrid re-reads the remote
 * entity and applies it; choosing ReView pushes the local value to the site.
 */
export type Resolution = 'sg' | 'review';

export interface ResolutionOutcome {
  direction: Resolution;
  /**
   * What was actually triggered, for feedback to the user.
   * `blocked`: writing to the site is closed in the settings: the row closes, but the gap will persist. Saying so is better than a
   * "resolved" that is not.
   */
  action: 'pulled' | 'pushed' | 'blocked' | 'nothing';
}

/** Settings domain governing the write, per local entity type. */
const WRITE_DOMAIN: Record<string, 'tasks' | 'hierarchy' | 'versions'> = {
  task: 'tasks',
  shot: 'hierarchy',
  sequence: 'hierarchy',
  asset: 'hierarchy',
  version: 'versions',
};

/**
 * Puts back the ReView value from before the overwrite, when the `sg_wins` policy has already replaced it with the site's.
 *
 * Without this step, "ReView wins" sent the site back... the site's value: the local value had been overwritten during the
 * synchronization, and the conflict row is the only place where the original value survives (`vars.review`).
 */
async function restoreReviewValue(
  projectId: number,
  log: Pick<ShotgridSyncLog, 'localType' | 'localId' | 'vars'>,
): Promise<void> {
  const vars = (log.vars ?? {}) as Record<string, unknown>;
  const code = typeof vars.review === 'string' && vars.review !== '—' ? vars.review : null;
  if (!code || !log.localId) return;
  if (log.localType !== 'task' && log.localType !== 'shot' && log.localType !== 'sequence') return;

  const status = await prisma.pipelineStatus.findFirst({
    where: { code, OR: [{ projectId }, { projectId: null }] },
    orderBy: { projectId: 'desc' }, // the project's status takes precedence over the studio's
  });
  if (!status) return;

  if (log.localType === 'task') {
    await prisma.task.update({
      where: { id: log.localId },
      data: {
        pipelineStatusId: status.id,
        ...(status.legacyStatus ? { status: status.legacyStatus } : {}),
      },
    });
  } else if (log.localType === 'shot') {
    await prisma.shot.update({ where: { id: log.localId }, data: { pipelineStatusId: status.id } });
  } else {
    await prisma.sequence.update({
      where: { id: log.localId },
      data: { pipelineStatusId: status.id },
    });
  }
}

export async function resolveConflict(
  projectId: number,
  log: Pick<ShotgridSyncLog, 'sgType' | 'sgId' | 'localType' | 'localId' | 'vars'>,
  resolution: Resolution,
  actorId: number,
): Promise<ResolutionOutcome> {
  if (resolution === 'sg') {
    if (!log.sgType || !log.sgId) return { direction: 'sg', action: 'nothing' };
    // Targeted re-read of the only entity at stake: ShotGrid overwrites the local value.
    await runSync(projectId, {
      kind: 'incremental',
      onlySgIds: [{ sgType: log.sgType, sgId: log.sgId }],
      withMedia: false,
      triggeredById: actorId,
    });
    logger.info({ projectId, sgType: log.sgType, sgId: log.sgId }, 'Conflit arbitré en faveur de ShotGrid');
    return { direction: 'sg', action: 'pulled' };
  }

  await restoreReviewValue(projectId, log);
  const pushed = await pushLocalValue(projectId, log, actorId);
  return { direction: 'review', action: pushed };
}

/**
 * Pushes the local value to ShotGrid, depending on the nature of the conflicting entity.
 * A type with no matching write does nothing rather than fail: the row is still classified, and the comparison will say whether the
 * gap persists.
 */
async function pushLocalValue(
  projectId: number,
  log: Pick<ShotgridSyncLog, 'localType' | 'localId'>,
  actorId: number,
): Promise<ResolutionOutcome['action']> {
  if (!log.localType || !log.localId) return 'nothing';

  // Enqueuing a job whose domain is closed for writing produces nothing: the worker exits silently. Checking it here lets us tell
  // the user instead of announcing a send that will not happen.
  const domain = WRITE_DOMAIN[log.localType];
  if (domain) {
    const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
    if (!connection?.active) return 'blocked';
    if (!can(parseSettings(connection.settings), domain, 'write')) return 'blocked';
  }

  switch (log.localType) {
    case 'task': {
      const task = await prisma.task.findUnique({ where: { id: log.localId } });
      if (!task) return 'nothing';
      await enqueuePush(projectId, { type: 'task-status', taskId: task.id, actorId });
      await enqueuePush(projectId, { type: 'task-dates', taskId: task.id, actorId });
      return 'pushed';
    }
    case 'shot':
      await enqueuePush(projectId, { type: 'shot-status', shotId: log.localId, actorId });
      return 'pushed';
    case 'sequence':
      await enqueuePush(projectId, { type: 'sequence-status', sequenceId: log.localId, actorId });
      return 'pushed';
    case 'version':
      await enqueuePush(projectId, { type: 'version-status', versionId: log.localId, actorId });
      return 'pushed';
    case 'asset':
      await enqueuePush(projectId, { type: 'asset-links', assetId: log.localId, actorId });
      return 'pushed';
    default:
      logger.info(
        { localType: log.localType },
        'Conflit classé sans écriture : type sans équivalent poussable',
      );
      return 'nothing';
  }
}

/** Still-open conflicts of a project: banner and comparison screen. */
export async function openConflictCount(projectId: number): Promise<number> {
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!connection) return 0;
  return prisma.shotgridSyncLog.count({
    where: { level: 'conflict', resolvedAt: null, run: { connectionId: connection.id } },
  });
}
