import { Router } from 'express';
import { z } from 'zod';
import { Role, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import {
  resolveProjectIdForVersion,
  resolveProjectIdForTask,
  resolveProjectIdForAsset,
} from '../lib/pipeline';
import { softDeleteVersion, restoreVersion, purgeVersion } from '../lib/trash';
import { logAudit } from '../services/AuditService';
import { emitToProject } from '../services/SocketService';
import { badRequest, forbidden, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

const isGlobalManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

// GET /api/versions?taskId=X | ?assetId=Y
router.get(
  '/',
  validate({
    query: z
      .object({ taskId: z.coerce.number().int().optional(), assetId: z.coerce.number().int().optional() })
      .refine((q) => q.taskId !== undefined || q.assetId !== undefined, 'taskId ou assetId requis'),
  }),
  async (req, res) => {
    const taskId = req.query.taskId ? Number(req.query.taskId) : undefined;
    const assetId = req.query.assetId ? Number(req.query.assetId) : undefined;
    const projectId = taskId
      ? await resolveProjectIdForTask(taskId)
      : await resolveProjectIdForAsset(assetId!);
    if (!projectId) throw notFound('Parent introuvable');
    await assertProjectAccess(req, projectId);
    const versions = await prisma.version.findMany({
      where: taskId ? { taskId, deletedAt: null } : { assetId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true } },
        // Count aligné sur la visibilité réelle : corbeille exclue, brouillons
        // visibles par leur uploader seul (ne pas révéler les brouillons d'autrui).
        _count: {
          select: {
            media: { where: { deletedAt: null, OR: [{ published: true }, { uploaderId: req.user!.id }] } },
          },
        },
      },
    });
    res.json({ versions });
  },
);

// POST /api/versions — artiste+ ; rattachée à une Task XOR un Asset
router.post(
  '/',
  validate({
    body: z
      .object({
        taskId: z.number().int().optional(),
        assetId: z.number().int().optional(),
        name: z.string().min(1).max(60).optional(),
      })
      .refine(
        (b) => (b.taskId === undefined) !== (b.assetId === undefined),
        'Fournir exactement taskId OU assetId',
      ),
  }),
  async (req, res) => {
    if (req.user!.role === Role.CLIENT) throw forbidden('Les clients ne peuvent pas créer de versions');
    const body = req.body as { taskId?: number; assetId?: number; name?: string };
    const projectId = body.taskId
      ? await resolveProjectIdForTask(body.taskId)
      : await resolveProjectIdForAsset(body.assetId!);
    if (!projectId) throw badRequest('Task/Asset parent introuvable');
    await assertProjectAccess(req, projectId);

    // Nom auto-incrémenté (V01, V02…) si non fourni
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
        authorId: req.user!.id,
        status: VersionStatus.DRAFT,
      },
    });
    emitToProject(projectId, 'version:update', {
      projectId,
      id: version.id,
      taskId: version.taskId,
      assetId: version.assetId,
    });
    res.status(201).json({ version });
  },
);

// GET /api/versions/:id (avec médias)
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const version = await prisma.version.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, name: true } },
      // Brouillons : un média non publié n'est visible que par son uploader
      media: {
        where: { deletedAt: null, OR: [{ published: true }, { uploaderId: req.user!.id }] },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!version) throw notFound('Version introuvable');
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version orpheline');
  await assertProjectAccess(req, projectId);
  res.json({ version });
});

// PATCH /api/versions/:id — auteur ou superviseur+. Publication (PUBLISHED) réservée superviseur+.
router.patch(
  '/:id',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      name: z.string().min(1).max(60).optional(),
      status: z.nativeEnum(VersionStatus).optional(),
      transform: z.any().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const version = await prisma.version.findUnique({ where: { id }, select: { authorId: true } });
    if (!version) throw notFound('Version introuvable');
    const projectId = await resolveProjectIdForVersion(id);
    if (!projectId) throw notFound('Version orpheline');
    await assertProjectAccess(req, projectId);

    const body = req.body as { name?: string; status?: VersionStatus; transform?: unknown };
    const manager = isGlobalManager(req.user!.role);
    const isAuthor = version.authorId === req.user!.id;
    if (!manager && !isAuthor) throw forbidden("Modification réservée à l'auteur ou un superviseur");
    if (body.status === VersionStatus.PUBLISHED && !manager) {
      throw forbidden('Seul un superviseur/admin peut publier une version');
    }

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
    if (body.status === VersionStatus.PUBLISHED) {
      logAudit({ userId: req.user!.id, action: 'VERSION_PUBLISH', entityType: 'Version', entityId: id });
    }
    emitToProject(projectId, 'version:update', {
      projectId,
      id,
      taskId: updated.taskId,
      assetId: updated.assetId,
    });
    res.json({ version: updated });
  },
);

// DELETE /api/versions/:id — corbeille (soft-delete, auteur ou superviseur+)
router.delete('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const version = await prisma.version.findUnique({
    where: { id },
    select: { authorId: true, taskId: true, assetId: true },
  });
  if (!version) throw notFound('Version introuvable');
  const projectId = await resolveProjectIdForVersion(id);
  if (!projectId) throw notFound('Version orpheline');
  await assertProjectAccess(req, projectId);
  if (!isGlobalManager(req.user!.role) && version.authorId !== req.user!.id) {
    throw forbidden("Suppression réservée à l'auteur ou un superviseur");
  }
  await softDeleteVersion(id);
  logAudit({ userId: req.user!.id, action: 'VERSION_DELETE', entityType: 'Version', entityId: id });
  emitToProject(projectId, 'version:update', {
    projectId,
    id,
    taskId: version.taskId,
    assetId: version.assetId,
  });
  res.status(204).end();
});

// POST /api/versions/:id/restore — auteur ou superviseur+
router.post(
  '/:id/restore',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    const id = Number(req.params.id);
    const version = await prisma.version.findUnique({
      where: { id },
      select: { authorId: true, taskId: true, assetId: true },
    });
    if (!version) throw notFound('Version introuvable');
    const projectId = await resolveProjectIdForVersion(id);
    if (!projectId) throw notFound('Version orpheline');
    await assertProjectAccess(req, projectId);
    if (!isGlobalManager(req.user!.role) && version.authorId !== req.user!.id) {
      throw forbidden("Restauration réservée à l'auteur ou un superviseur");
    }
    await restoreVersion(id);
    emitToProject(projectId, 'version:update', {
      projectId,
      id,
      taskId: version.taskId,
      assetId: version.assetId,
    });
    res.status(204).end();
  },
);

// DELETE /api/versions/:id/purge — suppression définitive (superviseur+)
router.delete(
  '/:id/purge',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    if (!isGlobalManager(req.user!.role)) throw forbidden('Réservé aux superviseurs/admins');
    const id = Number(req.params.id);
    const version = await prisma.version.findUnique({
      where: { id },
      select: { taskId: true, assetId: true },
    });
    if (!version) throw notFound('Version introuvable');
    const projectId = await resolveProjectIdForVersion(id);
    if (!projectId) throw notFound('Version introuvable');
    await assertProjectAccess(req, projectId);
    await purgeVersion(id);
    logAudit({ userId: req.user!.id, action: 'VERSION_PURGE', entityType: 'Version', entityId: id });
    emitToProject(projectId, 'version:update', {
      projectId,
      id,
      taskId: version.taskId,
      assetId: version.assetId,
    });
    res.status(204).end();
  },
);

export default router;
