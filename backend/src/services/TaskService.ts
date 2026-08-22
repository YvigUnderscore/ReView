// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskType, TaskStatus, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { emitToProject } from './SocketService';
import { badRequest, forbidden, notFound } from '../lib/errors';
import {
  type PaginationParams,
  MAX_PAGE_SIZE,
  nextCursor,
  pageArgs,
  paginateCursor,
  withCursor,
} from '../lib/pagination';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute, assertProjectManage, isProjectManager } from '../lib/projectRoles';
import { taskSelect, toTask } from '../lib/v1Resources';
import * as ApiEventService from './ApiEventService';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Logique métier des tâches (liste, création XOR Shot/Asset, mise à jour avec droits
 * différenciés, notifications d'assignation). L'accès projet (RBAC) est asserté dans
 * la route ; ces fonctions reçoivent le projectId résolu (10.D8).
 *
 * Les droits se lisent sur le rôle EFFECTIF (38.E, `lib/projectRoles`) et jamais sur le
 * rôle global : le second modèle qui vivait ici refusait à un ARTIST promu SUPERVISOR sur
 * son projet d'y modifier ou d'y supprimer une tâche qu'il supervise pourtant.
 */

type SessionUser = { id: number; role: Role };

/** Versions ramenées par la fiche d'une tâche — la plus récente d'abord. */
const DETAIL_VERSIONS_LIMIT = 200;

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
      messageKey: 'notification.taskAssigned',
      params: { name: taskName },
      projectId,
      referenceId: taskId,
    });
}

/**
 * Tâches paginées d'un Shot ou d'un Asset.
 *
 * Départage sur `id` : les tâches d'un plan importé partagent toutes `order = 0`, et
 * sans clé de départage deux pages successives se recouvrent.
 */
export async function list(p: PaginationParams, shotId?: number, assetId?: number) {
  const where = shotId ? { shotId } : { assetId };
  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where: withCursor(where, p, 'order', 'asc'),
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      ...pageArgs(p),
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { versions: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);
  return paginateCursor(items, total, p, (t) => t.order);
}

/**
 * Toutes les tâches d'un projet, avec l'entité qui les porte.
 *
 * Une Task n'a pas de `projectId` : elle pend à un shot ou à un asset, et c'est ce
 * parent qui appartient au projet. La liste passe donc par les deux chemins.
 *
 * Sert à proposer une destination d'upload : sur un projet ShotGrid, un asset traverse
 * cinq étapes (art, model, rig, groom, lookdev) et un plan autant — les voir toutes est
 * ce qui permet de ranger un rendu là où il a été produit.
 */
export interface ProjectTaskRow {
  id: number;
  name: string;
  department: string | null;
  pipelineStatusId: number | null;
  parentKind: 'shot' | 'asset';
  parentName: string;
  versionCount: number;
}

/**
 * Le plafond ne renvoyait rien qui permette de savoir qu'il avait mordu : à dix mille
 * tâches, la liste des destinations d'upload en montrait cinq cents et se taisait. Le
 * total et le curseur de suite accompagnent désormais la page.
 */
export async function listForProject(
  projectId: number,
  p?: PaginationParams,
): Promise<{ items: ProjectTaskRow[]; total: number; truncated: boolean; nextCursor: string | null }> {
  const where = {
    OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
  };
  const take = p?.pageSize ?? MAX_PAGE_SIZE;
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where: p ? withCursor(where, p, 'order', 'asc') : where,
      // `id` en dernier départage : deux tâches homonymes sur deux plans (« comp ») ne
      // doivent pas s'échanger de place entre deux pages.
      orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        name: true,
        order: true,
        department: true,
        pipelineStatusId: true,
        shot: { select: { code: true } },
        asset: { select: { name: true } },
        _count: { select: { versions: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      department: t.department,
      pipelineStatusId: t.pipelineStatusId,
      parentKind: t.shot ? ('shot' as const) : ('asset' as const),
      parentName: t.shot?.code ?? t.asset?.name ?? '',
      versionCount: t._count.versions,
    })),
    total,
    truncated: tasks.length >= take && total > tasks.length,
    nextCursor: nextCursor(tasks, take, (t) => t.order),
  };
}

/** Une carte de kanban, avec tout ce qu'il faut pour la lire, la filtrer et la déplacer. */
export interface BoardTaskRow {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  pipelineStatusId: number | null;
  department: string | null;
  departmentId: number | null;
  assignee: { id: number; name: string | null } | null;
  dueDate: string | null;
  versionCount: number;
  parentKind: 'shot' | 'asset';
  parentId: number;
  parentLabel: string;
  sequenceId: number | null;
}

/**
 * Toutes les tâches d'un projet, en une requête (C4).
 *
 * Le kanban en demandait une par plan **et** une par asset : cent cinquante appels HTTP
 * à l'ouverture d'un projet moyen, jusqu'à se faire limiter par le serveur. Sur le
 * long-métrage visé — deux mille plans — c'était irréalisable.
 *
 * La limite est explicite et le total est renvoyé : une troncature silencieuse ferait
 * lire « ce projet a 2000 tâches » à un board qui n'en montre que la moitié.
 *
 * `cursor` permet d'aller chercher la suite plutôt que de relever la limite : à dix mille
 * tâches, le board se remplit en cinq requêtes bornées au lieu d'une seule réponse de
 * plusieurs mégaoctets. Le tri se départage sur `id`, sans quoi les tâches à `order = 0`
 * — c'est-à-dire toutes celles d'un import ShotGrid — changeraient de page à chaque appel.
 */
export async function listForBoard(
  projectId: number,
  limit = 2000,
  cursor?: string,
): Promise<{ items: BoardTaskRow[]; total: number; truncated: boolean; nextCursor: string | null }> {
  const where = {
    OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
  };
  const window = { page: 1, pageSize: limit, order: 'asc' as const, cursor };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where: withCursor(where, window, 'order', 'asc'),
      orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
        order: true,
        status: true,
        pipelineStatusId: true,
        department: true,
        departmentId: true,
        dueDate: true,
        assignee: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
        shot: { select: { id: true, code: true, sequenceId: true } },
        asset: { select: { id: true, name: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  const items = rows.flatMap<BoardTaskRow>((t) => {
    const parent = t.shot
      ? { kind: 'shot' as const, id: t.shot.id, label: t.shot.code, sequenceId: t.shot.sequenceId }
      : t.asset
        ? { kind: 'asset' as const, id: t.asset.id, label: t.asset.name, sequenceId: null }
        : null;
    // Une tâche sans parent vivant ne peut pas s'afficher : son plan est en corbeille.
    if (!parent) return [];
    return [
      {
        id: t.id,
        name: t.name,
        type: t.type,
        status: t.status,
        pipelineStatusId: t.pipelineStatusId,
        department: t.department,
        departmentId: t.departmentId,
        assignee: t.assignee,
        dueDate: t.dueDate ? t.dueDate.toISOString() : null,
        versionCount: t._count.versions,
        parentKind: parent.kind,
        parentId: parent.id,
        parentLabel: parent.label,
        sequenceId: parent.sequenceId,
      },
    ];
  });

  // Sans curseur, `truncated` garde son sens d'origine — le board affiche un
  // avertissement. Avec un curseur, la question n'est plus « ai-je tout » mais « reste-t-il
  // une page », et c'est une page pleine qui y répond.
  return {
    items,
    total,
    truncated: cursor ? rows.length >= limit : total > rows.length,
    nextCursor: nextCursor(rows, limit, (t) => t.order),
  };
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
  // Sans département explicite, le type fait office d'étape : il porte les mêmes clés
  // que les départements par défaut, et une tâche sans étape se range en fourre-tout.
  const key = body.department ?? (body.type === TaskType.OTHER ? null : body.type);
  const department = await resolveDepartment(projectId, key);
  const task = await prisma.task.create({
    data: {
      name: body.name,
      type: body.type,
      ...department,
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
  if (!comment) throw notFound('Comment not found');
  const version = comment.media.version;
  const shotId = version.task?.shotId ?? null;
  const assetId = version.task?.assetId ?? version.assetId ?? null;
  if (!shotId && !assetId) throw badRequest('This media has no shot or asset attached');

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
      // Historique borné : une tâche de comp reprise deux cents fois ne doit pas faire
      // grossir la fiche indéfiniment. `_count` dit le nombre réel de versions.
      versions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: DETAIL_VERSIONS_LIMIT },
      _count: { select: { versions: true } },
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
  if (!task) throw notFound('Task not found');
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
  /** Statut personnalisable (Phase 48) — écrit en parallèle de `status`. */
  pipelineStatusId?: number | null;
  assigneeId?: number | null;
  order?: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  checklist?: ChecklistItem[];
}

/**
 * Aligne la clé de département et la clé étrangère (B1).
 *
 * La relation fait foi, la chaîne reste écrite en parallèle : c'est elle que lisent le pipe
 * (`lib/pipelineOrder.ts`), la nomenclature des versions et les snapshots de montage, qui
 * sont des comptes rendus figés et n'ont pas à suivre un renommage. Une étape inconnue du
 * projet — un `step` importé de ShotGrid, un chemin DCC — est créée plutôt que perdue :
 * elle existe puisque quelqu'un travaille dessus.
 */
async function resolveDepartment(
  projectId: number,
  key: string | null | undefined,
): Promise<{ department: string | null; departmentId: number | null }> {
  if (!key) return { department: null, departmentId: null };
  const department = await DepartmentService.resolveByKey(projectId, key);
  return department
    ? { department: department.key, departmentId: department.id }
    : { department: key, departmentId: null };
}

/**
 * Aligne `pipelineStatusId` et `status` d'après ce que l'appelant a fourni.
 * Le kanban envoie l'un ou l'autre selon l'écran d'origine ; la base porte les deux.
 */
async function resolveStatusPair(
  projectId: number,
  body: Pick<UpdateTaskInput, 'status' | 'pipelineStatusId'>,
): Promise<{ status?: TaskStatus; pipelineStatusId?: number | null }> {
  if (body.pipelineStatusId !== undefined) {
    if (body.pipelineStatusId === null) return { pipelineStatusId: null };
    // Le statut doit appartenir au vocabulaire de CE projet : rien n'empêchait jusqu'ici
    // de poser sur une tâche un statut importé du site d'un autre projet.
    const offered = await PipelineStatusService.listForProject(projectId, 'task');
    const status = offered.find((s) => s.id === body.pipelineStatusId);
    if (!status) throw badRequest('Unknown pipeline status for this project');
    return { pipelineStatusId: status.id, status: status.legacyStatus ?? TaskStatus.TODO };
  }
  if (body.status !== undefined) {
    // Le kanban envoie encore l'énumération à six valeurs. La correspondance se cherche
    // dans le vocabulaire du projet et nulle part ailleurs : la reposer depuis le
    // référentiel entier remplaçait « On Hold » par « Waiting to Start » — et l'écrivait
    // sur le site ShotGrid du studio.
    const match = await PipelineStatusService.resolveByLegacy(projectId, 'task', body.status);
    return { status: body.status, ...(match ? { pipelineStatusId: match.id } : {}) };
  }
  return {};
}

/**
 * Pose (ou retire) l'assigné d'une tâche — chemin unique, hors du `PATCH` général.
 *
 * L'assignation par lot et l'assignation d'un asset passent par ici : elles ne peuvent pas
 * emprunter `update()`, qui refuse à un non-manager tout autre champ que le statut, et qui
 * attend une session complète là où le lot ne connaît que l'acteur.
 */
export async function setAssignee(
  user: SessionUser,
  projectId: number,
  taskId: number,
  assigneeId: number | null,
  opts: { notify?: boolean } = {},
) {
  await assertProjectManage(user.id, user.role, projectId);
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId },
    select: { id: true, name: true, shotId: true, assetId: true },
  });
  if (opts.notify !== false) await notifyAssignee(assigneeId, user.id, projectId, taskId, updated.name);
  emitTaskUpdate(projectId, updated);
  await enqueuePush(projectId, { type: 'task-assignee', taskId, actorId: user.id });
  return updated;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateTaskInput) {
  const task = await prisma.task.findUnique({ where: { id }, select: { assigneeId: true } });
  if (!task) throw notFound('Task not found');
  const manager = await isProjectManager(user.id, user.role, projectId);
  const isAssignee = task.assigneeId === user.id;
  if (!manager) {
    // Un non-manager (artiste assigné) ne peut changer que le statut et la checklist de sa tâche.
    const keys = Object.keys(body);
    const allowed = ['status', 'pipelineStatusId', 'checklist'];
    if (!isAssignee || keys.some((k) => !allowed.includes(k)))
      throw forbidden('On a task assigned to you, only the status and the checklist can change');
  }
  const { checklist, department, ...rest } = body;
  // Département : la clé et la relation avancent ensemble, comme le statut plus bas.
  const departmentPair = department !== undefined ? await resolveDepartment(projectId, department) : {};
  // Statut : le référentiel personnalisable et l'énumération avancent ensemble, quel
  // que soit celui des deux que l'appelant a fourni. Les laisser diverger ferait
  // afficher un état au kanban et un autre sur la fiche.
  const statusPair = await resolveStatusPair(projectId, body);
  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...rest,
      ...statusPair,
      ...departmentPair,
      ...(checklist !== undefined ? { checklist: checklist as unknown as Prisma.InputJsonValue } : {}),
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await notifyAssignee(body.assigneeId, user.id, projectId, id, updated.name);
  emitTaskUpdate(projectId, updated);
  // 48 : ce qui a changé remonte vers ShotGrid, domaine par domaine. Les dates partent
  // ensemble — ShotGrid recalcule la durée à partir des deux.
  if (body.status !== undefined || body.pipelineStatusId !== undefined)
    await enqueuePush(projectId, { type: 'task-status', taskId: id, actorId: user.id });
  if (body.startDate !== undefined || body.dueDate !== undefined)
    await enqueuePush(projectId, { type: 'task-dates', taskId: id, actorId: user.id });
  if (body.assigneeId !== undefined)
    await enqueuePush(projectId, { type: 'task-assignee', taskId: id, actorId: user.id });
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
  // Même résolution que l'interface : l'API n'écrivait que l'énumération historique, si
  // bien qu'un `PATCH {status}` depuis un DCC laissait `pipelineStatusId` sur l'ancienne
  // valeur. La fiche affichait un état, le kanban un autre, et rien ne partait vers
  // ShotGrid — le statut posé par le pipeline n'existait que pour l'API.
  const statusPair = await resolveStatusPair(projectId, body);
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...statusPair,
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
  // Les écrans ouverts et le site distant apprennent le changement comme pour une
  // modification faite à la main : l'API v1 n'émettait ni l'un ni l'autre.
  emitTaskUpdate(projectId, { id, shotId: task.shot?.id ?? null, assetId: task.asset?.id ?? null });
  if (body.status !== undefined) await enqueuePush(projectId, { type: 'task-status', taskId: id, actorId });
  if (body.dueDate !== undefined) await enqueuePush(projectId, { type: 'task-dates', taskId: id, actorId });
  if (body.assigneeId !== undefined)
    await enqueuePush(projectId, { type: 'task-assignee', taskId: id, actorId });
  return view;
}

export async function remove(user: SessionUser, projectId: number, id: number) {
  await assertProjectManage(user.id, user.role, projectId);
  const task = await prisma.task.findUnique({ where: { id }, select: { shotId: true, assetId: true } });
  if (!task) throw notFound('Task not found');
  await prisma.task.delete({ where: { id } });
  emitTaskUpdate(projectId, { id, shotId: task.shotId, assetId: task.assetId });
}
