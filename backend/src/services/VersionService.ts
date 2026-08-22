// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { nextVersionName } from '../lib/versionNaming';
import { storage } from './StorageService';
import * as MediaService from './MediaService';
import { softDeleteVersion, restoreVersion, purgeVersion } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { forbidden, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute, assertProjectManage, isProjectManager } from '../lib/projectRoles';
import { versionSelect, toVersion } from '../lib/v1Resources';
import * as ApiEventService from './ApiEventService';

/**
 * Logique métier des versions (liste avec comptage média respectant la visibilité,
 * création XOR Task/Asset, publication réservée superviseur+, corbeille). L'accès
 * projet (RBAC) est asserté dans la route (10.D8).
 *
 * Les droits se lisent sur le rôle EFFECTIF (38.E, `lib/projectRoles`) et jamais sur le
 * rôle global : le second modèle qui vivait ici refusait à un ARTIST promu SUPERVISOR sur
 * son projet de publier ou de supprimer une version de CE projet, et laissait un ARTIST
 * rétrogradé CLIENT en créer.
 */

type SessionUser = { id: number; role: Role };

/** Émet l'événement temps réel de mise à jour de version vers le projet. */
function emitVersionUpdate(
  projectId: number,
  v: { id: number; taskId: number | null; assetId: number | null },
) {
  emitToProject(projectId, 'version:update', { projectId, id: v.id, taskId: v.taskId, assetId: v.assetId });
}

/**
 * Flux de changements (journal v1 + webhooks) — émis DEPUIS le service.
 *
 * `version.published` ne partait que de la route v1 : une publication faite à l'écran, par
 * un patch en lot ou par le flux de publication d'un média ne produisait ni ligne de
 * journal ni webhook. C'est pourtant l'événement auquel s'abonne d'abord un studio.
 *
 * La représentation est celle de l'API v1, la même que reçoit un abonné pour une
 * publication venue d'un DCC.
 */
async function publishVersionEvent(
  event: 'version.created' | 'version.published',
  projectId: number,
  versionId: number,
  actorId: number,
): Promise<void> {
  const row = await prisma.version.findUnique({ where: { id: versionId }, select: versionSelect });
  if (!row) return;
  ApiEventService.publish(event, {
    projectId,
    entityType: 'version',
    entityId: versionId,
    actorId,
    payload: { version: toVersion(row) },
  });
}

/** Versions d'une Task ou d'un Asset. Comptage média aligné sur la visibilité réelle. */
export async function list(userId: number, taskId?: number, assetId?: number) {
  const versions = await prisma.version.findMany({
    where: taskId ? { taskId, deletedAt: null } : { assetId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true } },
      reviewStatus: true, // décision de review courante (Phase 31)
      // Corbeille exclue, brouillons visibles par leur uploader seul (ne révèle pas ceux d'autrui).
      _count: {
        select: { media: { where: { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] } } },
      },
      // Brouillons de l'appelant : ce sont les seuls qu'il pourra publier d'un geste, et
      // l'interface n'a pas à proposer un bouton qui ne ferait rien (Phase 46).
      media: {
        where: { deletedAt: null, published: false, uploaderId: userId, status: { not: 'UPLOADING' } },
        select: { id: true },
      },
    },
  });
  return versions.map(({ media, ...v }) => ({ ...v, draftCount: media.length }));
}

export interface CreateVersionInput {
  taskId?: number;
  assetId?: number;
  name?: string;
}

/**
 * Nom de la version suivante, dans la convention du projet.
 *
 * Sur un projet relié à ShotGrid, les versions y sont nommées d'après le plan et l'étape
 * qui les produisent : garder un « V02 » local en face oblige chacun à traduire de tête
 * entre les deux outils. On lit donc le parent et l'étape pour composer le même code.
 *
 * Les noms déjà pris incluent la corbeille : un numéro qui a servi ne doit pas resservir,
 * même si la version qui le portait a été supprimée.
 */
async function autoName(projectId: number, body: CreateVersionInput): Promise<string> {
  const where = body.taskId ? { taskId: body.taskId } : { assetId: body.assetId };
  const [siblings, connection, task, asset] = await Promise.all([
    prisma.version.findMany({ where, select: { name: true } }),
    prisma.shotgridConnection.findUnique({ where: { projectId }, select: { active: true } }),
    body.taskId
      ? prisma.task.findUnique({
          where: { id: body.taskId },
          select: {
            department: true,
            shot: { select: { code: true } },
            asset: { select: { name: true } },
          },
        })
      : null,
    body.assetId ? prisma.asset.findUnique({ where: { id: body.assetId }, select: { name: true } }) : null,
  ]);

  return nextVersionName({
    existing: siblings.map((v) => v.name),
    // Une connexion en pause reste un projet relié : la nomenclature du studio n'a pas à
    // changer de forme parce qu'on a suspendu la synchronisation une après-midi.
    linked: Boolean(connection),
    parentCode: task?.shot?.code ?? task?.asset?.name ?? asset?.name ?? null,
    step: task?.department ?? null,
  });
}

export async function create(user: SessionUser, projectId: number, body: CreateVersionInput) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E : CLIENT = pas de version
  await assertProjectWritable(projectId); // 38.B
  const name = body.name ?? (await autoName(projectId, body));
  const version = await prisma.version.create({
    data: {
      taskId: body.taskId ?? null,
      assetId: body.assetId ?? null,
      name,
      authorId: user.id,
      status: VersionStatus.DRAFT,
    },
  });
  emitVersionUpdate(projectId, version);
  await publishVersionEvent('version.created', projectId, version.id, user.id);
  return version;
}

/** Détail d'une version + médias visibles pour l'utilisateur (brouillons privés). */
export async function getDetail(userId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      reviewStatus: true, // décision de review courante (Phase 31)
      media: {
        where: { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          originalName: true,
          status: true,
          published: true,
          thumbnailKey: true,
        },
      },
    },
  });
  if (!version) throw notFound('Version not found');
  // Présigne la miniature de chaque média (Phase 20 : vraies vignettes dans la timeline).
  const media = await Promise.all(
    version.media.map(async ({ thumbnailKey, ...m }) => ({
      ...m,
      thumbnailUrl: thumbnailKey ? await storage.getPresignedGetUrl(thumbnailKey) : null,
    })),
  );
  return { ...version, media };
}

export interface UpdateVersionInput {
  name?: string;
  status?: VersionStatus;
  transform?: unknown;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateVersionInput) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, published: true },
  });
  if (!version) throw notFound('Version not found');
  const manager = await isProjectManager(user.id, user.role, projectId);
  const isAuthor = version.authorId === user.id;
  if (!manager && !isAuthor) throw forbidden('Only the author or a supervisor can modify a version');
  if (body.status === VersionStatus.PUBLISHED && !manager)
    throw forbidden('Only a supervisor or administrator can publish a version');
  // …et la sortie de l'état publié est tout aussi réservée. Sans cela le verrou n'a qu'un
  // sens : l'auteur dépublie sa version — la retirant au passage du lien de partage client,
  // décisions de review comprises — puis la modifie librement, puisque `assertNotPublished`
  // ne voit plus qu'un brouillon.
  if (version.published && body.status !== undefined && body.status !== VersionStatus.PUBLISHED && !manager)
    throw forbidden('Only a supervisor or administrator can unpublish a version');
  // Verrou de publication (Phase 11) : la transform 3D d'une version publiée est figée.
  if (body.transform !== undefined) assertNotPublished(version);

  const updated = await prisma.version.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.transform !== undefined ? { transform: body.transform as object } : {}),
      ...(body.status !== undefined
        ? { status: body.status, published: body.status === VersionStatus.PUBLISHED }
        : {}),
    },
  });
  if (body.status === VersionStatus.PUBLISHED)
    logAudit({ userId: user.id, action: 'VERSION_PUBLISH', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, updated);
  // Seule la transition compte : repasser PUBLISHED sur une version déjà publiée n'est pas
  // une publication, et n'a pas à réveiller les abonnés une seconde fois.
  if (body.status === VersionStatus.PUBLISHED && !version.published)
    await publishVersionEvent('version.published', projectId, id, user.id);
  return updated;
}

/**
 * Publie d'un geste tous les brouillons d'une version (Phase 46).
 *
 * Publier trois fichiers un par un puis la version par-dessus faisait quatre clics pour
 * une seule intention — « c'est prêt, montrez-le ».
 *
 * Chacun ne publie que ses propres dépôts, superviseur compris : un brouillon est
 * strictement privé à son auteur, et le publier à sa place exposerait un travail qu'il n'a
 * pas choisi de montrer. Un superviseur qui veut diffuser la version dispose du passage en
 * PUBLISHED, qui ne dévoile aucun brouillon.
 */
export async function publishAll(user: SessionUser, projectId: number, id: number) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E : CLIENT = pas de publication
  const version = await prisma.version.findUnique({
    where: { id },
    select: { id: true, deletedAt: true, published: true },
  });
  if (!version || version.deletedAt) throw notFound('Version not found');

  const drafts = await prisma.mediaObject.findMany({
    where: {
      versionId: id,
      deletedAt: null,
      published: false,
      uploaderId: user.id,
      // Un upload en cours n'a pas encore été validé (magic bytes, antivirus, quotas) :
      // il sera publié à sa finalisation si la version l'est déjà.
      status: { not: MediaStatus.UPLOADING },
    },
    select: { id: true },
  });
  for (const draft of drafts) await MediaService.publish(user, draft.id);

  // Rattrape aussi une version restée en brouillon alors que tous ses médias étaient déjà
  // publiés — cas des versions créées avant cette règle.
  await MediaService.syncVersionPublication(id, user.id);
  const updated = await prisma.version.findUniqueOrThrow({ where: { id } });
  emitVersionUpdate(projectId, updated);
  // « Publier tout » fait basculer la version sans passer par `update` : sans cette ligne,
  // le geste le plus courant de la review restait muet pour les abonnés.
  if (updated.published && !version.published)
    await publishVersionEvent('version.published', projectId, id, user.id);
  return { version: updated, publishedCount: drafts.length };
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version not found');
  if (!(await isProjectManager(user.id, user.role, projectId)) && version.authorId !== user.id)
    throw forbidden('Only the author or a supervisor can delete a version');
  await softDeleteVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_DELETE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function restore(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version not found');
  if (!(await isProjectManager(user.id, user.role, projectId)) && version.authorId !== user.id)
    throw forbidden('Only the author or a supervisor can restore a version');
  await restoreVersion(id);
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function purge(user: SessionUser, projectId: number, id: number) {
  await assertProjectManage(user.id, user.role, projectId);
  const version = await prisma.version.findUnique({ where: { id }, select: { taskId: true, assetId: true } });
  if (!version) throw notFound('Version not found');
  await purgeVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_PURGE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}
