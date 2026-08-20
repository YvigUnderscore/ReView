// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShotgridSyncLog } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { enqueuePush } from './ShotgridPushService';
import { runSync } from './ShotgridSyncService';
import { can, parseSettings } from './shotgridSettings';

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
  /**
   * Ce qui a réellement été déclenché, pour le retour à l'utilisateur.
   * `blocked` : l'écriture vers le site est fermée dans les réglages — la ligne se ferme,
   * mais l'écart persistera. Le dire vaut mieux qu'un « résolu » qui ne l'est pas.
   */
  action: 'pulled' | 'pushed' | 'blocked' | 'nothing';
}

/** Domaine de réglage qui gouverne l'écriture, par type d'entité locale. */
const WRITE_DOMAIN: Record<string, 'tasks' | 'hierarchy' | 'versions'> = {
  task: 'tasks',
  shot: 'hierarchy',
  sequence: 'hierarchy',
  asset: 'hierarchy',
  version: 'versions',
};

/**
 * Remet la valeur ReView d'avant l'écrasement, quand la politique `sg_wins` l'a déjà
 * remplacée par celle du site.
 *
 * Sans cette étape, « ReView gagne » renvoyait au site… la valeur du site : le local
 * avait été écrasé pendant la synchronisation, et la ligne de conflit est le seul
 * endroit où la valeur d'origine subsiste (`vars.review`).
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
    orderBy: { projectId: 'desc' }, // le statut du projet prime sur celui du studio
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

  await restoreReviewValue(projectId, log);
  const pushed = await pushLocalValue(projectId, log, actorId);
  return { direction: 'review', action: pushed };
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
): Promise<ResolutionOutcome['action']> {
  if (!log.localType || !log.localId) return 'nothing';

  // Enfiler un job dont le domaine est fermé en écriture ne produit rien : le worker
  // sort en silence. Le vérifier ici permet de le dire à l'utilisateur au lieu de lui
  // annoncer un envoi qui n'aura pas lieu.
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

/** Conflits encore ouverts d'un projet — bannière et écran de comparaison. */
export async function openConflictCount(projectId: number): Promise<number> {
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!connection) return 0;
  return prisma.shotgridSyncLog.count({
    where: { level: 'conflict', resolvedAt: null, run: { connectionId: connection.id } },
  });
}
