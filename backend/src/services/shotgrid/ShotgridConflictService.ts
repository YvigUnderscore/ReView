// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShotgridSyncLog } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { enqueuePush } from './ShotgridPushService';
import { runSync } from './ShotgridSyncService';

/**
 * Arbitrage d'un conflit.
 *
 * Une ligne de conflit signale que les deux côtés ont bougé entre deux
 * synchronisations. La classer « résolue » sans rien faire laisserait l'écart intact —
 * c'est exactement ce qu'un bouton « Garder ShotGrid » ne doit pas se contenter de
 * faire. Choisir ShotGrid relit l'entité distante et l'applique ; choisir ReView pousse
 * la valeur locale vers le site.
 */
export type Resolution = 'sg' | 'review';

export interface ResolutionOutcome {
  direction: Resolution;
  /** Ce qui a réellement été déclenché, pour le retour à l'utilisateur. */
  action: 'pulled' | 'pushed' | 'nothing';
}

export async function resolveConflict(
  projectId: number,
  log: Pick<ShotgridSyncLog, 'sgType' | 'sgId' | 'localType' | 'localId'>,
  resolution: Resolution,
  actorId: number,
): Promise<ResolutionOutcome> {
  if (resolution === 'sg') {
    if (!log.sgType || !log.sgId) return { direction: 'sg', action: 'nothing' };
    // Relecture ciblée de la seule entité en cause : ShotGrid écrase la valeur locale.
    await runSync(projectId, {
      kind: 'incremental',
      onlySgIds: [{ sgType: log.sgType, sgId: log.sgId }],
      withMedia: false,
      triggeredById: actorId,
    });
    logger.info({ projectId, sgType: log.sgType, sgId: log.sgId }, 'Conflit arbitré en faveur de ShotGrid');
    return { direction: 'sg', action: 'pulled' };
  }

  const pushed = await pushLocalValue(projectId, log, actorId);
  return { direction: 'review', action: pushed ? 'pushed' : 'nothing' };
}

/**
 * Renvoie la valeur locale vers ShotGrid, selon la nature de l'entité en conflit.
 * Un type sans écriture correspondante ne fait rien plutôt que d'échouer : la ligne
 * est tout de même classée, et la comparaison dira si l'écart persiste.
 */
async function pushLocalValue(
  projectId: number,
  log: Pick<ShotgridSyncLog, 'localType' | 'localId'>,
  actorId: number,
): Promise<boolean> {
  if (!log.localType || !log.localId) return false;

  switch (log.localType) {
    case 'task': {
      const task = await prisma.task.findUnique({ where: { id: log.localId } });
      if (!task) return false;
      await enqueuePush(projectId, { type: 'task-status', taskId: task.id, actorId });
      await enqueuePush(projectId, { type: 'task-dates', taskId: task.id, actorId });
      return true;
    }
    case 'shot':
      await enqueuePush(projectId, { type: 'shot-status', shotId: log.localId, actorId });
      return true;
    case 'version':
      await enqueuePush(projectId, { type: 'version-status', versionId: log.localId, actorId });
      return true;
    case 'asset':
      await enqueuePush(projectId, { type: 'asset-links', assetId: log.localId, actorId });
      return true;
    default:
      logger.info(
        { localType: log.localType },
        'Conflit classé sans écriture : type sans équivalent poussable',
      );
      return false;
  }
}

/** Conflits encore ouverts d'un projet — bannière et écran de comparaison. */
export async function openConflictCount(projectId: number): Promise<number> {
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!connection) return 0;
  return prisma.shotgridSyncLog.count({
    where: { level: 'conflict', resolvedAt: null, run: { connectionId: connection.id } },
  });
}
