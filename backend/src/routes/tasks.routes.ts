import { Router } from 'express';
import { z } from 'zod';
import { Role, TaskType, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { assertProjectAccess } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { resolveProjectIdForTask, resolveProjectIdForShot, resolveProjectIdForAsset } from '../lib/pipeline';
import { notify } from '../services/NotificationService';
import { emitToProject } from '../services/SocketService';
import { badRequest, forbidden, notFound } from '../lib/errors';

const router = Router();
router.use(authenticate);

const isGlobalManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

// GET /api/tasks?shotId=X | ?assetId=Y
router.get(
  '/',
  validate({
    query: z
      .object({ shotId: z.coerce.number().int().optional(), assetId: z.coerce.number().int().optional() })
      .refine((q) => q.shotId !== undefined || q.assetId !== undefined, 'shotId ou assetId requis'),
  }),
  async (req, res) => {
    const shotId = req.query.shotId ? Number(req.query.shotId) : undefined;
    const assetId = req.query.assetId ? Number(req.query.assetId) : undefined;
    const projectId = shotId ? await resolveProjectIdForShot(shotId) : await resolveProjectIdForAsset(assetId!);
    if (!projectId) throw notFound('Parent introuvable');
    await assertProjectAccess(req, projectId);
    const tasks = await prisma.task.findMany({
      where: shotId ? { shotId } : { assetId },
      orderBy: { order: 'asc' },
      include: { assignee: { select: { id: true, name: true, email: true } }, _count: { select: { versions: true } } },
    });
    res.json({ tasks });
  },
);

// POST /api/tasks (admin/superviseur) — rattachée à un Shot XOR un Asset
router.post(
  '/',
  validate({
    body: z
      .object({
        name: z.string().min(1).max(160),
        type: z.nativeEnum(TaskType).default(TaskType.OTHER),
        shotId: z.number().int().optional(),
        assetId: z.number().int().optional(),
        assigneeId: z.number().int().nullable().optional(),
        order: z.number().int().optional(),
      })
      .refine((b) => (b.shotId === undefined) !== (b.assetId === undefined), 'Fournir exactement shotId OU assetId'),
  }),
  async (req, res) => {
    if (!isGlobalManager(req.user!.role)) throw forbidden('Réservé aux superviseurs/admins');
    const body = req.body as {
      name: string; type: TaskType; shotId?: number; assetId?: number; assigneeId?: number | null; order?: number;
    };
    const projectId = body.shotId
      ? await resolveProjectIdForShot(body.shotId)
      : await resolveProjectIdForAsset(body.assetId!);
    if (!projectId) throw badRequest('Shot/Asset parent introuvable');
    await assertProjectAccess(req, projectId);

    const task = await prisma.task.create({
      data: {
        name: body.name,
        type: body.type,
        shotId: body.shotId ?? null,
        assetId: body.assetId ?? null,
        assigneeId: body.assigneeId ?? null,
        order: body.order ?? 0,
      },
      include: { assignee: { select: { id: true, name: true } } },
    });
    if (body.assigneeId && body.assigneeId !== req.user!.id) {
      await notify({ userId: body.assigneeId, type: 'TASK_ASSIGNED', content: `Tâche assignée : ${task.name}`, projectId, referenceId: task.id });
    }
    emitToProject(projectId, 'task:update', { projectId, id: task.id, shotId: task.shotId, assetId: task.assetId });
    res.status(201).json({ task });
  },
);

// GET /api/tasks/:id
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int() }) }), async (req, res) => {
  const id = Number(req.params.id);
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      versions: { orderBy: { createdAt: 'desc' } },
      // Contexte de localisation pour le fil d'ariane (projet › séquence · shot › tâche)
      shot: {
        select: {
          id: true, code: true, name: true,
          project: { select: { id: true, name: true } },
          sequence: { select: { id: true, code: true, name: true } },
        },
      },
      asset: { select: { id: true, name: true, type: true, project: { select: { id: true, name: true } } } },
    },
  });
  if (!task) throw notFound('Tâche introuvable');
  const projectId = await resolveProjectIdForTask(id);
  if (!projectId) throw notFound('Tâche orpheline');
  await assertProjectAccess(req, projectId);
  res.json({ task });
});

// PATCH /api/tasks/:id — superviseur/admin : tous champs ; assigné : statut uniquement
router.patch(
  '/:id',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      name: z.string().min(1).max(160).optional(),
      type: z.nativeEnum(TaskType).optional(),
      status: z.nativeEnum(TaskStatus).optional(),
      assigneeId: z.number().int().nullable().optional(),
      order: z.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const id = Number(req.params.id);
    const task = await prisma.task.findUnique({ where: { id }, select: { assigneeId: true } });
    if (!task) throw notFound('Tâche introuvable');
    const projectId = await resolveProjectIdForTask(id);
    if (!projectId) throw notFound('Tâche orpheline');
    await assertProjectAccess(req, projectId);

    const body = req.body as Record<string, unknown>;
    const manager = isGlobalManager(req.user!.role);
    const isAssignee = task.assigneeId === req.user!.id;

    if (!manager) {
      // Un non-manager (artiste assigné) ne peut changer que le statut de sa propre tâche.
      const keys = Object.keys(body);
      if (!isAssignee || keys.some((k) => k !== 'status')) {
        throw forbidden('Seul le statut de votre tâche assignée est modifiable');
      }
    }

    const updated = await prisma.task.update({
      where: { id },
      data: req.body,
      include: { assignee: { select: { id: true, name: true } } },
    });
    const newAssignee = (body as { assigneeId?: number | null }).assigneeId;
    if (newAssignee && newAssignee !== req.user!.id) {
      await notify({ userId: newAssignee, type: 'TASK_ASSIGNED', content: `Tâche assignée : ${updated.name}`, projectId, referenceId: id });
    }
    emitToProject(projectId, 'task:update', { projectId, id, shotId: updated.shotId, assetId: updated.assetId });
    res.json({ task: updated });
  },
);

// DELETE /api/tasks/:id (admin/superviseur)
router.delete(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res) => {
    if (!isGlobalManager(req.user!.role)) throw forbidden('Réservé aux superviseurs/admins');
    const id = Number(req.params.id);
    const task = await prisma.task.findUnique({ where: { id }, select: { shotId: true, assetId: true } });
    if (!task) throw notFound('Tâche introuvable');
    const projectId = await resolveProjectIdForTask(id);
    if (!projectId) throw notFound('Tâche introuvable');
    await assertProjectAccess(req, projectId);
    await prisma.task.delete({ where: { id } });
    emitToProject(projectId, 'task:update', { projectId, id, shotId: task.shotId, assetId: task.assetId });
    res.status(204).end();
  },
);

export default router;
