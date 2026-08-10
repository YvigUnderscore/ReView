// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskType, TaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { emitToProject } from './SocketService';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate } from '../lib/pagination';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute } from '../lib/projectRoles';
import { taskSelect, toTask } from '../lib/v1Resources';
import * as ApiEventService from './ApiEventService';

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

/** Tâches paginées d'un Shot ou d'un Asset. */
export async function list(
  p: PaginationParams,
  shotId?: number,
  assetId?: number,
): Promise<Paginated<unknown>> {
  const where = shotId ? { shotId } : { assetId };
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { order: 'asc' },
      ...pageArgs(p),
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { versions: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  return paginate(items, total, p);
}

export interface CreateTaskInput {
  name: string;
  type: TaskType;
  /** Département du pipe (clé des réglages projet) — porte l'ordre amont → aval. */
  department?: string | null;
  shotId?: number;
  assetId?: number;
  assigneeId?: number | null;
  order?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateTaskInput) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E : CLIENT = pas de tâche
  await assertProjectWritable(projectId); // 38.B
  const task = await prisma.task.create({
    data: {
      name: body.name,
      type: body.type,
      // Sans département explicite, le type fait office d'étape : il porte les mêmes clés
      // que les départements par défaut, et une tâche sans étape se range en fourre-tout.
      department: body.department ?? (body.type === TaskType.OTHER ? null : body.type),
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

/** Nom de tâche depuis un contenu de commentaire : texte sans balises, tronqué. */
export function taskNameFromComment(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Retour de review';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/**
 * Crée une tâche kanban depuis un commentaire de review (32.D) : rattachée au
 * shot/asset porteur de la version du média, assigné du commentaire repris,
 * lien retour via `sourceCommentId` (frame/annotation restaurées par ?comment=).
 */
export async function createFromComment(user: SessionUser, projectId: number, commentId: number) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      media: {
        select: {
          version: {
            select: { assetId: true, task: { select: { shotId: true, assetId: true } } },
          },
        },
      },
    },
  });
  if (!comment) throw notFound('Commentaire introuvable');
  const version = comment.media.version;
  const shotId = version.task?.shotId ?? null;
  const assetId = version.task?.assetId ?? version.assetId ?? null;
  if (!shotId && !assetId) throw badRequest('Média sans shot/asset rattaché');

  const task = await prisma.task.create({
    data: {
      name: taskNameFromComment(comment.content),
      type: TaskType.OTHER,
      shotId,
      assetId: shotId ? null : assetId,
      assigneeId: comment.assigneeId,
      sourceCommentId: comment.id,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await notifyAssignee(comment.assigneeId, user.id, projectId, task.id, task.name);
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
      // Commentaire d'origine (32.D) : lien retour vers la review à la frame/annotation.
      sourceComment: { select: { id: true, mediaObjectId: true } },
    },
  });
  if (!task) throw notFound('Tâche introuvable');
  return task;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface UpdateTaskInput {
  name?: string;
  type?: TaskType;
  department?: string | null;
  status?: TaskStatus;
  assigneeId?: number | null;
  order?: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  checklist?: ChecklistItem[];
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateTaskInput) {
  const task = await prisma.task.findUnique({ where: { id }, select: { assigneeId: true } });
  if (!task) throw notFound('Tâche introuvable');
  const manager = isGlobalManager(user.role);
  const isAssignee = task.assigneeId === user.id;
  if (!manager) {
    // Un non-manager (artiste assigné) ne peut changer que le statut et la checklist de sa tâche.
    const keys = Object.keys(body);
    if (!isAssignee || keys.some((k) => k !== 'status' && k !== 'checklist'))
      throw forbidden('Seuls le statut et la checklist de votre tâche assignée sont modifiables');
  }
  const { checklist, ...rest } = body;
  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...rest,
      ...(checklist !== undefined ? { checklist: checklist as unknown as Prisma.InputJsonValue } : {}),
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await notifyAssignee(body.assigneeId, user.id, projectId, id, updated.name);
  emitTaskUpdate(projectId, updated);
  return updated;
}

export interface ApiPatchInput {
  status?: TaskStatus;
  assigneeId?: number | null;
  dueDate?: Date | null;
}

/**
 * Mise à jour d'une tâche par l'API v1 : statut, assignation, échéance — le minimum
 * qu'un pipeline pilote depuis un DCC.
 *
 * Les droits sont assertés par la route (projet ouvert, contributeur) ; ce qui se joue ici
 * est le flux d'événements. Le changement de statut se distingue d'une mise à jour
 * quelconque : c'est lui que suivent les tableaux de production, et sans événement dédié
 * chaque client devrait comparer les états lui-même pour le retrouver.
 */
export async function applyApiPatch(actorId: number, projectId: number, id: number, body: ApiPatchInput) {
  const before = await prisma.task.findUnique({ where: { id }, select: { status: true } });
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
    },
    select: taskSelect,
  });

  const view = toTask(task);
  const event = (type: Parameters<typeof ApiEventService.publish>[0], payload: Record<string, unknown>) =>
    ApiEventService.publish(type, {
      projectId,
      entityType: 'task',
      entityId: id,
      actorId,
      payload,
    });

  if (body.status !== undefined && before && before.status !== body.status) {
    event('task.status_changed', { task: view, from: before.status, to: body.status });
  }
  if (body.assigneeId !== undefined) {
    event('task.assigned', { task: view, assigneeId: body.assigneeId });
  }
  event('task.updated', { task: view });
  return view;
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  if (!isGlobalManager(user.role)) throw forbidden('Réservé aux superviseurs/admins');
  const task = await prisma.task.findUnique({ where: { id }, select: { shotId: true, assetId: true } });
  if (!task) throw notFound('Tâche introuvable');
  await prisma.task.delete({ where: { id } });
  emitTaskUpdate(projectId, { id, shotId: task.shotId, assetId: task.assetId });
}
