// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { shotgridQueue } from '../JobService';
import { clientForSiteRecord } from './ShotgridConfigService';
import { belongsToProject } from './shotgridProjectGuard';
import { toSgDate } from './shotgridMapper';
import { findByLocal, upsertLink } from './shotgridLinks';
import { can, parseSettings } from './shotgridSettings';
import { markEcho } from './ShotgridEventService';
import { inverseVersionStatusMap } from './ShotgridStatusSync';

/**
 * Écritures ReView → ShotGrid.
 *
 * Tout passe par la file : un artiste qui change un statut ne doit pas attendre le
 * site distant, et une panne de ShotGrid ne doit pas faire échouer une action locale.
 * Chaque écriture vérifie trois choses avant de partir : le domaine est-il ouvert en
 * écriture, l'entité est-elle bien reliée, et l'entité distante appartient-elle
 * toujours au projet lié.
 */

export type PushJob =
  | { type: 'task-status'; taskId: number; actorId?: number | null }
  | { type: 'task-dates'; taskId: number; actorId?: number | null }
  | { type: 'task-assignee'; taskId: number; actorId?: number | null }
  | { type: 'shot-status'; shotId: number; actorId?: number | null }
  | { type: 'version-status'; versionId: number; actorId?: number | null }
  | { type: 'version-publish'; versionId: number; actorId?: number | null };

/**
 * Met une écriture en file pour le projet concerné, si une connexion existe.
 *
 * Rien de ce qui se passe ici ne doit faire échouer l'action de l'utilisateur : poser
 * une décision de review, changer un statut ou publier reste une opération ReView, que
 * ShotGrid soit joignable ou non. Un incident est journalisé, et la réconciliation
 * périodique rattrapera l'écart au prochain passage.
 */
export async function enqueuePush(projectId: number, job: PushJob): Promise<void> {
  try {
    const conn = await prisma.shotgridConnection.findUnique({ where: { projectId } });
    if (!conn?.active) return;
    await shotgridQueue.add(
      'push',
      { kind: 'push', connectionId: conn.id, push: job },
      { removeOnComplete: 200 },
    );
  } catch (err) {
    logger.warn({ err, projectId, job }, "Écriture ShotGrid non mise en file — l'action locale reste valide");
  }
}

interface PushContext {
  connectionId: number;
  sgProjectId: number;
  sgProjectName: string;
  client: ReturnType<typeof clientForSiteRecord>;
  settings: ReturnType<typeof parseSettings>;
  baseUrl: string;
}

/**
 * Identifiant ShotGrid d'une entité locale, avec vérification d'appartenance.
 * Un lien peut pointer une entité supprimée puis recréée sous le même identifiant
 * dans un autre projet : on relit avant d'écrire.
 */
async function resolveTarget(
  ctx: PushContext,
  localType: Parameters<typeof findByLocal>[1],
  localId: number,
  sgType: string,
): Promise<number | null> {
  const link = await findByLocal(ctx.connectionId, localType, localId);
  if (!link || link.sgType !== sgType) return null;
  const remote = await ctx.client.findById(sgType, link.sgId, ['id', 'project']);
  if (!remote) return null;
  const verdict = belongsToProject(remote, {
    sgProjectId: ctx.sgProjectId,
    sgProjectName: ctx.sgProjectName,
  });
  if (!verdict.ok) {
    logger.error(
      { sgType, sgId: link.sgId, expected: ctx.sgProjectId, found: verdict.foundProjectId },
      'Écriture ShotGrid annulée : la cible appartient à un autre projet',
    );
    return null;
  }
  return link.sgId;
}

/** Compte ShotGrid de l'utilisateur, pour écrire en son nom quand c'est possible. */
async function actorLogin(ctx: PushContext, actorId: number | null | undefined): Promise<string | null> {
  if (!actorId || !ctx.settings.push.attributeToUser) return null;
  const link = await findByLocal(ctx.connectionId, 'user', actorId);
  const data = (link?.data ?? {}) as { login?: string };
  return data.login ?? null;
}

export async function runPush(connectionId: number, job: PushJob): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { id: connectionId },
    include: { site: true },
  });
  if (!connection?.active) return;

  const ctx: PushContext = {
    connectionId,
    sgProjectId: connection.sgProjectId,
    sgProjectName: connection.sgProjectName,
    client: clientForSiteRecord(connection.site),
    settings: parseSettings(connection.settings),
    baseUrl: connection.site.baseUrl,
  };

  try {
    switch (job.type) {
      case 'task-status':
        await pushTaskStatus(ctx, job);
        break;
      case 'task-dates':
        await pushTaskDates(ctx, job);
        break;
      case 'task-assignee':
        await pushTaskAssignee(ctx, job);
        break;
      case 'shot-status':
        await pushShotStatus(ctx, job);
        break;
      case 'version-status':
        await pushVersionStatus(ctx, job);
        break;
      case 'version-publish':
        await pushVersionPublish(ctx, job);
        break;
    }
  } catch (err) {
    logger.error({ err, job }, 'Écriture ShotGrid en échec');
    throw err;
  }
}

async function pushTaskStatus(ctx: PushContext, job: Extract<PushJob, { type: 'task-status' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({
    where: { id: job.taskId },
    include: { pipelineStatus: true },
  });
  if (!task?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

  const code = task.pipelineStatus.code;
  await markEcho(ctx.connectionId, 'Task', sgId, 'sg_status_list', code);
  await ctx.client.update(
    'Task',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
  logger.info({ taskId: task.id, sgId, code }, 'Statut de tâche poussé vers ShotGrid');
}

/**
 * Dates de planification.
 *
 * ShotGrid lie start_date, due_date et duration : modifier l'une recalcule les autres.
 * Les deux dates partent donc dans la même requête — les envoyer séparément ferait
 * recalculer une échéance à partir d'une durée qui n'a plus cours.
 */
async function pushTaskDates(ctx: PushContext, job: Extract<PushJob, { type: 'task-dates' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({ where: { id: job.taskId } });
  if (!task) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

  const payload: Record<string, unknown> = {};
  if (task.startDate) payload.start_date = toSgDate(task.startDate);
  if (task.dueDate) payload.due_date = toSgDate(task.dueDate);
  if (Object.keys(payload).length === 0) return;

  await markEcho(ctx.connectionId, 'Task', sgId, 'due_date', payload.due_date);
  await ctx.client.update('Task', sgId, payload, { asUserLogin: await actorLogin(ctx, job.actorId) });
}

async function pushTaskAssignee(ctx: PushContext, job: Extract<PushJob, { type: 'task-assignee' }>) {
  if (!can(ctx.settings, 'tasks', 'write')) return;
  const task = await prisma.task.findUnique({ where: { id: job.taskId } });
  if (!task) return;
  const sgId = await resolveTarget(ctx, 'task', task.id, 'Task');
  if (!sgId) return;

  // Assigner suppose un compte ShotGrid correspondant : sans lui, ne rien écrire vaut
  // mieux que de vider la liste des assignés côté ShotGrid.
  if (!task.assigneeId) return;
  const link = await findByLocal(ctx.connectionId, 'user', task.assigneeId);
  if (!link) {
    logger.info({ taskId: task.id }, 'Assignation non poussée : pas de compte ShotGrid correspondant');
    return;
  }
  await markEcho(ctx.connectionId, 'Task', sgId, 'task_assignees', [{ id: link.sgId, type: 'HumanUser' }]);
  await ctx.client.update(
    'Task',
    sgId,
    {
      task_assignees: [{ id: link.sgId, type: 'HumanUser' }],
    },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
}

async function pushShotStatus(ctx: PushContext, job: Extract<PushJob, { type: 'shot-status' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const shot = await prisma.shot.findUnique({
    where: { id: job.shotId },
    include: { pipelineStatus: true },
  });
  if (!shot?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'shot', shot.id, 'Shot');
  if (!sgId) return;

  const code = shot.pipelineStatus.code;
  await markEcho(ctx.connectionId, 'Shot', sgId, 'sg_status_list', code);
  await ctx.client.update(
    'Shot',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
}

/** Décision de review ReView → statut de la Version ShotGrid. */
async function pushVersionStatus(ctx: PushContext, job: Extract<PushJob, { type: 'version-status' }>) {
  if (!can(ctx.settings, 'versions', 'write')) return;
  const version = await prisma.version.findUnique({ where: { id: job.versionId } });
  if (!version?.reviewStatusId) return;
  const sgId = await resolveTarget(ctx, 'version', version.id, 'Version');
  if (!sgId) return;

  const code = inverseVersionStatusMap(ctx.settings.versionStatusMap).get(version.reviewStatusId);
  if (!code) {
    logger.info(
      { versionId: version.id, reviewStatusId: version.reviewStatusId },
      'Décision non poussée : statut ReView sans correspondance ShotGrid',
    );
    return;
  }
  await markEcho(ctx.connectionId, 'Version', sgId, 'sg_status_list', code);
  await ctx.client.update(
    'Version',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
  logger.info({ versionId: version.id, sgId, code }, 'Décision de review poussée vers ShotGrid');
}

/**
 * Publication ReView → Version ShotGrid.
 *
 * Deux modes réglés par projet : le lien (la Version ShotGrid renvoie vers la review
 * ReView, sans dupliquer le média) ou l'envoi du fichier. Le lien est le défaut :
 * dupliquer des masters de dailies coûte cher et ReView reste le lieu de la review.
 */
async function pushVersionPublish(ctx: PushContext, job: Extract<PushJob, { type: 'version-publish' }>) {
  if (!can(ctx.settings, 'versions', 'write')) return;
  if (ctx.settings.push.publishMode === 'off') return;

  const version = await prisma.version.findUnique({
    where: { id: job.versionId },
    include: {
      task: { include: { shot: true, asset: true } },
      asset: true,
      media: { where: { deletedAt: null }, take: 1 },
    },
  });
  if (!version) return;

  const already = await findByLocal(ctx.connectionId, 'version', version.id);
  if (already) return; // déjà connue de ShotGrid : rien à créer

  const payload: Record<string, unknown> = {
    project: { type: 'Project', id: ctx.sgProjectId },
    code: version.name,
    description: [version.task?.name, 'Publié depuis ReView'].filter(Boolean).join(' — '),
  };

  if (version.taskId) {
    const taskLink = await findByLocal(ctx.connectionId, 'task', version.taskId);
    if (taskLink) payload.sg_task = { type: 'Task', id: taskLink.sgId };
  }
  const shotId = version.task?.shotId ?? null;
  const assetId = version.assetId ?? version.task?.assetId ?? null;
  if (shotId) {
    const link = await findByLocal(ctx.connectionId, 'shot', shotId);
    if (link) payload.entity = { type: 'Shot', id: link.sgId };
  } else if (assetId) {
    const link = await findByLocal(ctx.connectionId, 'asset', assetId);
    if (link) payload.entity = { type: 'Asset', id: link.sgId };
  }

  const reviewUrl = env.APP_URL
    ? `${env.APP_URL.replace(/\/$/, '')}/review/${version.media[0]?.id ?? ''}`
    : null;
  if (reviewUrl) payload.sg_path_to_movie = reviewUrl;

  const created = await ctx.client.createAs('Version', payload, await actorLogin(ctx, job.actorId));
  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'version',
    localId: version.id,
    sgType: 'Version',
    sgId: created.id,
    data: { createdFromReview: true, publishMode: ctx.settings.push.publishMode },
  });
  logger.info(
    { versionId: version.id, sgId: created.id, mode: ctx.settings.push.publishMode },
    'Version créée dans ShotGrid depuis une publication ReView',
  );

  if (ctx.settings.push.publishMode === 'upload' && version.media[0]) {
    logger.info({ versionId: version.id }, 'Envoi du média vers ShotGrid demandé');
    // Le transfert du fichier passe par le stockage : traité hors de cette écriture
    // courte, il fera l'objet d'un travail dédié quand le média sera prêt.
  }
}
