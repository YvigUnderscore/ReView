// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { env } from '../../config/env';
import { shotgridQueue } from '../JobService';
import { storage } from '../StorageService';
import { mediaSourceKey } from '../MediaService';
import { clientForSiteRecord } from './ShotgridConfigService';
import { belongsToProject } from './shotgridProjectGuard';
import { writeAllowedOn } from './shotgridTemplateGuard';
import { toSgDate } from './shotgridMapper';
import { findByLocal, upsertLink } from './shotgridLinks';
import { can, parseSettings } from './shotgridSettings';
import { inverseVersionStatusMap, resolveVersionStatusCode } from './ShotgridStatusSync';
import { pushComment } from './ShotgridNoteSync';
import { pushPlaylist } from './ShotgridPlaylistSync';

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
  | { type: 'sequence-status'; sequenceId: number; actorId?: number | null }
  | { type: 'version-status'; versionId: number; actorId?: number | null }
  | { type: 'version-publish'; versionId: number; actorId?: number | null }
  | { type: 'asset-links'; assetId: number; actorId?: number | null }
  | { type: 'comment'; commentId: number; actorId?: number | null }
  | { type: 'playlist'; playlistId: number; actorId?: number | null };

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
  // Second rempart, indépendant du cloisonnement : jamais dans un projet modèle.
  if (!writeAllowedOn(remote)) {
    logger.error({ sgType, sgId: link.sgId }, 'Écriture ShotGrid annulée : cible dans un projet modèle');
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

/** Domaine de la matrice qui gouverne chaque type d'écriture. */
const JOB_DOMAIN: Record<PushJob['type'], 'tasks' | 'hierarchy' | 'versions' | 'notes' | 'playlists'> = {
  'task-status': 'tasks',
  'task-dates': 'tasks',
  'task-assignee': 'tasks',
  'shot-status': 'hierarchy',
  'sequence-status': 'hierarchy',
  'asset-links': 'hierarchy',
  'version-status': 'versions',
  'version-publish': 'versions',
  comment: 'notes',
  playlist: 'playlists',
};

/**
 * Consigne une écriture refusée par la matrice de droits.
 *
 * Les gardes de domaine sont des `return` secs : le job se terminait « ok » et personne,
 * nulle part, n'apprenait que le statut n'était pas parti. L'utilisateur voyait sa
 * modification prise en compte dans ReView et cherchait ensuite pourquoi ShotGrid ne
 * bougeait pas. On agrège par domaine — un compteur et une date suffisent à faire
 * apparaître le problème dans l'écran de synchronisation.
 */
async function noteBlockedPush(connectionId: number, job: PushJob, domain: string): Promise<void> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { id: connectionId },
    select: { pushBlocked: true },
  });
  const current = { ...((connection?.pushBlocked as Record<string, unknown> | null) ?? {}) };
  const entry = (current[domain] ?? {}) as { count?: number };
  current[domain] = { count: (entry.count ?? 0) + 1, at: new Date().toISOString(), jobType: job.type };
  await prisma.shotgridConnection.update({
    where: { id: connectionId },
    data: { pushBlocked: current as Prisma.InputJsonValue },
  });
  logger.info({ connectionId, domain, jobType: job.type }, 'Écriture ShotGrid refusée par les réglages');
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

  // Le refus se constate ici, une fois pour tous les types : chaque fonction d'écriture
  // reteste son domaine ensuite (défense en profondeur), mais aucune ne pouvait le dire.
  const domain = JOB_DOMAIN[job.type];
  if (!can(ctx.settings, domain, 'write')) {
    await noteBlockedPush(connectionId, job, domain);
    return;
  }

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
      case 'sequence-status':
        await pushSequenceStatus(ctx, job);
        break;
      case 'version-status':
        await pushVersionStatus(ctx, job);
        break;
      case 'version-publish':
        await pushVersionPublish(ctx, job);
        break;
      case 'asset-links':
        await pushAssetLinks(ctx, job);
        break;
      case 'comment':
        await pushCommentJob(ctx, job);
        break;
      case 'playlist':
        await pushPlaylistJob(ctx, job);
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
  await ctx.client.update(
    'Shot',
    sgId,
    { sg_status_list: code },
    {
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
  );
}

/**
 * Statut de séquence ReView → ShotGrid.
 *
 * Il n'existait aucun chemin : une séquence porte un statut depuis la phase 48, mais
 * aucun type de job ne l'emportait vers le site. Le studio changeait l'état d'une
 * séquence dans ReView et le site n'en savait rien — jusqu'à ce que la synchronisation
 * suivante ramène l'ancienne valeur.
 */
async function pushSequenceStatus(ctx: PushContext, job: Extract<PushJob, { type: 'sequence-status' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const sequence = await prisma.sequence.findUnique({
    where: { id: job.sequenceId },
    include: { pipelineStatus: true },
  });
  if (!sequence?.pipelineStatus) return;
  const sgId = await resolveTarget(ctx, 'sequence', sequence.id, 'Sequence');
  if (!sgId) return;

  const code = sequence.pipelineStatus.code;
  await ctx.client.update(
    'Sequence',
    sgId,
    { sg_status_list: code },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
  logger.info({ sequenceId: sequence.id, sgId, code }, 'Statut de séquence poussé vers ShotGrid');
}

/** Décision de review ReView → statut de la Version ShotGrid. */
async function pushVersionStatus(ctx: PushContext, job: Extract<PushJob, { type: 'version-status' }>) {
  if (!can(ctx.settings, 'versions', 'write')) return;
  const version = await prisma.version.findUnique({ where: { id: job.versionId } });
  if (!version?.reviewStatusId) return;
  const sgId = await resolveTarget(ctx, 'version', version.id, 'Version');
  if (!sgId) return;

  // La carte réglée d'abord ; à défaut, une déduction par le nom, en lecture seule.
  // Sans ce second chemin, fermer la lecture du référentiel de statuts suffisait à
  // couper tout envoi de décision de review.
  const code =
    inverseVersionStatusMap(ctx.settings.versionStatusMap).get(version.reviewStatusId) ??
    (await resolveVersionStatusCode(ctx.client, version.reviewStatusId));
  if (!code) {
    logger.info(
      { versionId: version.id, reviewStatusId: version.reviewStatusId },
      'Décision non poussée : statut ReView sans correspondance ShotGrid',
    );
    return;
  }
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
      media: { where: { deletedAt: null }, orderBy: { id: 'asc' }, take: 1 },
    },
  });
  if (!version) return;

  const already = await findByLocal(ctx.connectionId, 'version', version.id);
  if (already) {
    // La version existe déjà là-bas : ajouter un média à une version en cours doit
    // enrichir CETTE version, pas en fabriquer une seconde portant le même nom.
    const media = version.media[0];
    if (media) {
      await uploadThumbnail(ctx, already.sgId, media);
      if (ctx.settings.push.publishMode === 'upload') {
        await uploadMasterMedia(ctx, already.sgId, media);
      }
      logger.info(
        { versionId: version.id, sgId: already.sgId },
        'Média ajouté à la version ShotGrid existante',
      );
    }
    return;
  }

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
    data: {
      createdFromReview: true,
      publishMode: ctx.settings.push.publishMode,
      // Le média de cette version est celui qu'on vient d'envoyer : il est déjà ici.
      // Sans ce marqueur, la synchronisation suivante le retéléchargerait depuis le site
      // et l'ajouterait à la même version — une copie de plus à chaque passe.
      mediaImported: true,
    },
  });
  logger.info(
    { versionId: version.id, sgId: created.id, mode: ctx.settings.push.publishMode },
    'Version créée dans ShotGrid depuis une publication ReView',
  );

  // Miniature d'abord : légère, elle suffit à rendre la version reconnaissable dans
  // les listes ShotGrid même quand le fichier lui-même reste chez nous.
  const media = version.media[0];
  if (media) {
    await uploadThumbnail(ctx, created.id, media);
    if (ctx.settings.push.publishMode === 'upload') {
      await uploadMasterMedia(ctx, created.id, media);
    }
  }
}

/** Playlist de dailies ReView → Playlist ShotGrid, ordre compris. */
async function pushPlaylistJob(ctx: PushContext, job: Extract<PushJob, { type: 'playlist' }>) {
  if (!can(ctx.settings, 'playlists', 'write')) return;
  await pushPlaylist(
    {
      connectionId: ctx.connectionId,
      sgProjectId: ctx.sgProjectId,
      client: ctx.client,
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
    job.playlistId,
  );
}

/** Commentaire ReView → note ShotGrid, avec la frame annotée en pièce jointe. */
async function pushCommentJob(ctx: PushContext, job: Extract<PushJob, { type: 'comment' }>) {
  if (!can(ctx.settings, 'notes', 'write')) return;
  await pushComment(
    {
      connectionId: ctx.connectionId,
      sgProjectId: ctx.sgProjectId,
      client: ctx.client,
      attachAnnotations: ctx.settings.push.attachAnnotations,
      asUserLogin: await actorLogin(ctx, job.actorId),
    },
    job.commentId,
  );
}

/**
 * Rattachements d'un asset aux shots et aux sequences.
 *
 * ShotGrid porte ces liens sur l'asset lui-même (`shots`, `sequences`) : c'est de là
 * que sortent les listes « quels assets pour ce plan ». Assigner dans ReView sans les
 * répercuter laissait la production aveugle côté ShotGrid, alors même que
 * l'information existait des deux côtés.
 */
async function pushAssetLinks(ctx: PushContext, job: Extract<PushJob, { type: 'asset-links' }>) {
  if (!can(ctx.settings, 'hierarchy', 'write')) return;
  const asset = await prisma.asset.findUnique({
    where: { id: job.assetId },
    include: {
      shots: { where: { deletedAt: null }, select: { id: true } },
      sequences: { where: { deletedAt: null }, select: { id: true } },
    },
  });
  if (!asset) return;
  const sgId = await resolveTarget(ctx, 'asset', asset.id, 'Asset');
  if (!sgId) return;

  // Seuls les rattachements dont la contrepartie existe côté ShotGrid partent : un
  // shot créé localement et jamais synchronisé n'a pas d'identifiant distant à citer.
  const shotRefs: Array<{ type: string; id: number }> = [];
  for (const shot of asset.shots) {
    const link = await findByLocal(ctx.connectionId, 'shot', shot.id);
    if (link) shotRefs.push({ type: 'Shot', id: link.sgId });
  }
  const sequenceRefs: Array<{ type: string; id: number }> = [];
  for (const sequence of asset.sequences) {
    const link = await findByLocal(ctx.connectionId, 'sequence', sequence.id);
    if (link) sequenceRefs.push({ type: 'Sequence', id: link.sgId });
  }

  await ctx.client.update(
    'Asset',
    sgId,
    { shots: shotRefs, sequences: sequenceRefs },
    { asUserLogin: await actorLogin(ctx, job.actorId) },
  );
  logger.info(
    { assetId: asset.id, sgId, shots: shotRefs.length, sequences: sequenceRefs.length },
    'Rattachements d’asset poussés vers ShotGrid',
  );
}

/** Vignette de la version, envoyée dans le champ `image` de ShotGrid. */
async function uploadThumbnail(
  ctx: PushContext,
  sgVersionId: number,
  media: { id: number; thumbnailKey: string | null },
): Promise<void> {
  if (!media.thumbnailKey) return;
  try {
    const buffer = await storage.getObjectBuffer(media.thumbnailKey);
    await ctx.client.uploadFile(
      'Version',
      sgVersionId,
      'image',
      buffer,
      `thumb-${media.id}.webp`,
      'image/webp',
    );
  } catch (err) {
    logger.warn({ err, mediaId: media.id }, 'Vignette non transmise à ShotGrid');
  }
}

/**
 * Transfert du fichier lui-même vers `sg_uploaded_movie`, qui déclenche le transcodage
 * de ShotGrid. Réservé au mode « upload » : un master de dailies pèse lourd, et le
 * dupliquer n'a de sens que si le studio veut ShotGrid autonome.
 */
async function uploadMasterMedia(
  ctx: PushContext,
  sgVersionId: number,
  media: {
    id: number;
    storageKey: string;
    originalName: string;
    mimeType: string;
    size: bigint;
    metadata: unknown;
  },
): Promise<void> {
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
  if (Number(media.size) > MAX_UPLOAD_BYTES) {
    logger.warn(
      { mediaId: media.id, size: Number(media.size) },
      'Média trop volumineux pour un envoi vers ShotGrid — la version reste liée sans fichier',
    );
    return;
  }
  try {
    const buffer = await storage.getObjectBuffer(mediaSourceKey(media));
    // `sg_uploaded_movie` accepte images et vidéos : c'est lui qui déclenche le
    // transcodage de ShotGrid et alimente son lecteur.
    await ctx.client.uploadFile(
      'Version',
      sgVersionId,
      'sg_uploaded_movie',
      buffer,
      media.originalName,
      media.mimeType,
    );
    logger.info({ mediaId: media.id, sgVersionId }, 'Média envoyé vers ShotGrid');
  } catch (err) {
    logger.error({ err, mediaId: media.id }, 'Envoi du média vers ShotGrid en échec');
  }
}
