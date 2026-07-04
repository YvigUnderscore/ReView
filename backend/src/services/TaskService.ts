import { Role, TaskType, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { emitToProject } from './SocketService';
import { forbidden, notFound } from '../lib/errors';

/**
 * Logique métier des tâches (liste, création XOR Shot/Asset, mise à jour avec droits
 * différenciés, notifications d'assignation). L'accès projet (RBAC) est asserté dans
 * la route ; ces fonctions reçoivent le projectId résolu (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isGlobalManager = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

function emitTaskUpdate(projectId: number, t: { id: number; shotId: number | null; assetId: number | null }) {
  emitToProject(projectId, 'task:update', { projectId, id: t.id, shotId: t.shotId, assetId: t.assetId });
}

/** Notifie l'assigné d'une tâche (hors auto-assignation). */
async function notifyAssignee(
  assigneeId: number | null | undefined,
  actorId: number,
  projectId: number,
  taskId: number,
  taskName: string,
) {
  if (assigneeId && assigneeId !== actorId)
    await notify({
      userId: assigneeId,
      type: 'TASK_ASSIGNED',
      content: `Tâche assignée : ${taskName}`,
      projectId,
      referenceId: taskId,
    });
}

/** Tâches d'un Shot ou d'un Asset. */
export async function list(shotId?: number, assetId?: number) {
  return prisma.task.findMany({
    where: shotId ? { shotId } : { assetId },
    orderBy: { order: 'asc' },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      _count: { select: { versions: true } },
    },
  });
}

export interface CreateTaskInput {
  name: string;
  type: TaskType;
  shotId?: number;
  assetId?: number;
  assigneeId?: number | null;
  order?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateTaskInput) {
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
  await notifyAssignee(body.assigneeId, user.id, projectId, task.id, task.name);
  emitTaskUpdate(projectId, task);
  return task;
}

/** Détail d'une tâche (assigné, versions, contexte shot/asset pour le fil d'ariane). */
export async function getDetail(id: number) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      versions: { orderBy: { createdAt: 'desc' } },
      shot: {
        select: {
          id: true,
          code: true,
          name: true,
          project: { select: { id: true, name: true } },
          sequence: { select: { id: true, code: true, name: true } },
        },
      },
      asset: { select: { id: true, name: true, type: true, project: { select: { id: true, name: true } } } },
    },
  });
  if (!task) throw notFound('Tâche introuvable');
  return task;
}

export interface UpdateTaskInput {
  name?: string;
  type?: TaskType;
  status?: TaskStatus;
  assigneeId?: number | null;
  order?: number;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateTaskInput) {
  const task = await prisma.task.findUnique({ where: { id }, select: { assigneeId: true } });
  if (!task) throw notFound('Tâche introuvable');
  const manager = isGlobalManager(user.role);
  const isAssignee = task.assigneeId === user.id;
  if (!manager) {
    // Un non-manager (artiste assigné) ne peut changer que le statut de sa propre tâche.
    const keys = Object.keys(body);
    if (!isAssignee || keys.some((k) => k !== 'status'))
      throw forbidden('Seul le statut de votre tâche assignée est modifiable');
  }
  const updated = await prisma.task.update({
    where: { id },
    data: body,
    include: { assignee: { select: { id: true, name: true } } },
  });
  await notifyAssignee(body.assigneeId, user.id, projectId, id, updated.name);
  emitTaskUpdate(projectId, updated);
  return updated;
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  if (!isGlobalManager(user.role)) throw forbidden('Réservé aux superviseurs/admins');
  const task = await prisma.task.findUnique({ where: { id }, select: { shotId: true, assetId: true } });
  if (!task) throw notFound('Tâche introuvable');
  await prisma.task.delete({ where: { id } });
  emitTaskUpdate(projectId, { id, shotId: task.shotId, assetId: task.assetId });
}
