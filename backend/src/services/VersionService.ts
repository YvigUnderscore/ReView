import { Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { softDeleteVersion, restoreVersion, purgeVersion } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { forbidden, notFound } from '../lib/errors';
import { assertNotPublished } from '../lib/publishLock';
import { assertProjectWritable } from '../lib/projectGuard';

/**
 * Logique métier des versions (liste avec comptage média respectant la visibilité,
 * création XOR Task/Asset, publication réservée superviseur+, corbeille). L'accès
 * projet (RBAC) est asserté dans la route (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isGlobalManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Émet l'événement temps réel de mise à jour de version vers le projet. */
function emitVersionUpdate(
  projectId: number,
  v: { id: number; taskId: number | null; assetId: number | null },
) {
  emitToProject(projectId, 'version:update', { projectId, id: v.id, taskId: v.taskId, assetId: v.assetId });
}

/** Versions d'une Task ou d'un Asset. Comptage média aligné sur la visibilité réelle. */
export async function list(userId: number, taskId?: number, assetId?: number) {
  return prisma.version.findMany({
    where: taskId ? { taskId, deletedAt: null } : { assetId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, name: true } },
      reviewStatus: true, // décision de review courante (Phase 31)
      // Corbeille exclue, brouillons visibles par leur uploader seul (ne révèle pas ceux d'autrui).
      _count: {
        select: { media: { where: { deletedAt: null, OR: [{ published: true }, { uploaderId: userId }] } } },
      },
    },
  });
}

export interface CreateVersionInput {
  taskId?: number;
  assetId?: number;
  name?: string;
}

export async function create(user: SessionUser, projectId: number, body: CreateVersionInput) {
  await assertProjectWritable(projectId); // 38.B
  // Nom auto-incrémenté (V01, V02…) si non fourni.
  let name = body.name;
  if (!name) {
    const count = await prisma.version.count({
      where: body.taskId ? { taskId: body.taskId } : { assetId: body.assetId },
    });
    name = `V${String(count + 1).padStart(2, '0')}`;
  }
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
  if (!version) throw notFound('Version introuvable');
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
  if (!version) throw notFound('Version introuvable');
  const manager = isGlobalManager(user.role);
  const isAuthor = version.authorId === user.id;
  if (!manager && !isAuthor) throw forbidden("Modification réservée à l'auteur ou un superviseur");
  if (body.status === VersionStatus.PUBLISHED && !manager)
    throw forbidden('Seul un superviseur/admin peut publier une version');
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
  return updated;
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version introuvable');
  if (!isGlobalManager(user.role) && version.authorId !== user.id)
    throw forbidden("Suppression réservée à l'auteur ou un superviseur");
  await softDeleteVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_DELETE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function restore(user: SessionUser, projectId: number, id: number) {
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version introuvable');
  if (!isGlobalManager(user.role) && version.authorId !== user.id)
    throw forbidden("Restauration réservée à l'auteur ou un superviseur");
  await restoreVersion(id);
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}

export async function purge(user: SessionUser, projectId: number, id: number) {
  if (!isGlobalManager(user.role)) throw forbidden('Réservé aux superviseurs/admins');
  const version = await prisma.version.findUnique({ where: { id }, select: { taskId: true, assetId: true } });
  if (!version) throw notFound('Version introuvable');
  await purgeVersion(id);
  logAudit({ userId: user.id, action: 'VERSION_PURGE', entityType: 'Version', entityId: id });
  emitVersionUpdate(projectId, { id, taskId: version.taskId, assetId: version.assetId });
}
