// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role, TaskType, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { notify } from './NotificationService';
import { emitToProject } from './SocketService';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors';
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
import { canWriteTask, parseTaskPolicy, writableDepartments } from '../lib/taskDepartmentPolicy';
import { SETTING_KEYS } from '../lib/settings';
import { taskSelect, toTask } from '../lib/v1Resources';
import * as ApiEventService from './ApiEventService';
import { assertAssignable } from './EntityAssigneeService';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import { enqueuePush } from './shotgrid/ShotgridPushService';

/**
 * Business logic for tasks (list, creation XOR Shot/Asset, update with differentiated rights,
 * assignment notifications). Project access (RBAC) is asserted in the route; these functions receive the
 * resolved projectId (10.D8).
 *
 * Rights are read from the EFFECTIVE role (38.E, `lib/projectRoles`) and never from the global role: the second
 * model that lived here refused a supervisor promoted from ARTIST on their project from modifying or deleting a
 * task they nonetheless supervise.
 */

type SessionUser = { id: number; role: Role };

/** Versions returned with a task's detail: most recent first. */
const DETAIL_VERSIONS_LIMIT = 200;

function emitTaskUpdate(projectId: number, t: { id: number; shotId: number | null; assetId: number | null }) {
  emitToProject(projectId, 'task:update', { projectId, id: t.id, shotId: t.shotId, assetId: t.assetId });
}

type TaskEvent = 'task.created' | 'task.updated' | 'task.status_changed' | 'task.assigned';

/**
 * Change stream (v1 journal + webhooks), emitted FROM the service.
 *
 * It used to come only from the v1 API: a status set by right-click, a batch assignment or a task created on
 * screen produced neither a journal line nor a webhook. Yet the journal presented itself as a change stream: it
 * only showed machine traffic. The origin of the change no longer matters.
 *
 * The representation is that of the v1 API (`toTask`), the same one a subscriber receives for a change coming
 * from a DCC: a consumer must not have to tell the two apart. It costs one re-read by primary key, outside the transaction.
 */
async function publishTaskEvents(
  projectId: number,
  taskId: number,
  actorId: number,
  events: ReadonlyArray<{ event: TaskEvent; extra?: Record<string, unknown> }>,
): Promise<void> {
  if (events.length === 0) return;
  const row = await prisma.task.findUnique({ where: { id: taskId }, select: taskSelect });
  if (!row) return;
  const task = toTask(row);
  for (const { event, extra } of events)
    ApiEventService.publish(event, {
      projectId,
      entityType: 'task',
      entityId: taskId,
      actorId,
      payload: { task, ...extra },
    });
}

/**
 * Who may receive this task.
 *
 * Same guard as entity assignment and review assignment (`EntityAssigneeService.assertAssignable`), deliberately
 * shared: a service account, a deactivated account, or someone not contributing to THIS project could be given a
 * task, and notified of it, through the task path alone, which checked nothing.
 * Three assignment paths, two guards: the third was the back door of the other two.
 */
const assertTaskAssignee = async (projectId: number, assigneeId: number | null | undefined) => {
  if (assigneeId != null) await assertAssignable(projectId, [assigneeId]);
};

/** Notifies a task's assignee (except self-assignment). */
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
      kind: 'taskAssigned',
      messageKey: 'notification.taskAssigned',
      params: { name: taskName },
      projectId,
      referenceId: taskId,
    });
}

/**
 * Paginated tasks of a Shot or an Asset.
 *
 * Tie-broken on `id`: the tasks of an imported shot all share `order = 0`, and without a tie-break key two
 * successive pages overlap.
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
 * All the tasks of a project, with the entity carrying them.
 *
 * A Task has no `projectId`: it hangs from a shot or an asset, and it is that parent which belongs to the project.
 * The list therefore goes through both paths.
 *
 * Used to propose an upload destination: on a ShotGrid project, an asset goes through five steps (art, model, rig,
 * groom, lookdev) and a shot as many. Seeing them all is what lets a render be filed where it was produced.
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
 * The cap returned nothing that let the caller know it had bitten: at ten thousand tasks, the list of upload
 * destinations showed five hundred and said nothing. The total and the continuation cursor now accompany the page.
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
      // `id` as the final tie-break: two same-named tasks on two shots ("comp") must not swap places
      // between two pages.
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

/** A kanban card, with everything needed to read, filter and move it. */
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
 * All the tasks of a project, in one query (C4).
 *
 * The kanban used to ask for one per shot **and** one per asset: a hundred and fifty HTTP calls on opening an
 * average project, enough to get rate-limited by the server. On the targeted feature film, two thousand shots,
 * it was unworkable.
 *
 * The limit is explicit and the total is returned: a silent truncation would make a board showing half of them read
 * "this project has 2000 tasks".
 *
 * `cursor` fetches the rest instead of raising the limit: at ten thousand tasks, the board fills in five bounded
 * requests instead of one response of several megabytes. Sorting is tie-broken on `id`, otherwise tasks at `order = 0`,
 * that is, all those of a ShotGrid import, would change page on every call.
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
    // A task without a living parent cannot be displayed: its shot is in the trash.
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

  // Without a cursor, `truncated` keeps its original meaning: the board shows a warning. With a cursor, the
  // question is no longer "do I have everything?" but "is there another page left?", and a full page answers it.
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
  /** Department of the pipe (key of the project settings): carries the upstream-to-downstream order. */
  department?: string | null;
  /** Brief: what there is to do, as production writes it (Phase 50). */
  description?: string | null;
  shotId?: number;
  assetId?: number;
  assigneeId?: number | null;
  order?: number;
}

export async function create(user: SessionUser, projectId: number, body: CreateTaskInput) {
  await assertCanContribute(user.id, user.role, projectId); // 38.E: CLIENT = no task
  await assertProjectWritable(projectId); // 38.B
  // Without an explicit department, the type serves as the step: it carries the same keys as the default
  // departments, and a task without a step would fall into a catch-all bucket.
  const key = body.department ?? (body.type === TaskType.OTHER ? null : body.type);
  const department = await resolveDepartment(projectId, key);
  // Department policy (studio setting): an artist creates within their steps, and nowhere else. Without it,
  // the list offered on screen was only a promise, but nothing prevented a direct call from bypassing it.
  const ctx = await taskWriteContext(user, projectId);
  if (department.departmentId !== null) {
    const allowed = writableDepartments([{ id: department.departmentId }], ctx);
    if (allowed.length === 0) throw forbidden('This task belongs to a department you are not part of');
  }
  await assertTaskAssignee(projectId, body.assigneeId);
  const task = await prisma.task.create({
    data: {
      name: body.name,
      type: body.type,
      ...department,
      description: body.description ?? null,
      shotId: body.shotId ?? null,
      assetId: body.assetId ?? null,
      assigneeId: body.assigneeId ?? null,
      order: body.order ?? 0,
    },
    include: { assignee: { select: { id: true, name: true } } },
  });
  await notifyAssignee(body.assigneeId, user.id, projectId, task.id, task.name);
  emitTaskUpdate(projectId, task);
  await publishTaskEvents(projectId, task.id, user.id, [{ event: 'task.created' }]);
  return task;
}

/**
 * Task name from a comment's content: text without tags, truncated.
 *
 * This is now only a **fallback**: the name is asked for in a dialog before creation (Phase 50), since a review
 * note makes a poor task label, and that label was then read on the kanban and in ShotGrid. The fallback is written
 * in English, like everything written to the database: the reader's language is chosen at display time, and a name
 * stored in French would have appeared as is in all fourteen languages.
 */
export function taskNameFromComment(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Review feedback';
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** What the creation dialog (Phase 50) adds to the original comment. */
export interface CommentTaskInput {
  /** Name chosen by the person; if absent, the comment text is the fallback. */
  name?: string;
  description?: string | null;
}

/**
 * Creates a kanban task from a review comment (32.D): attached to the shot/asset carrying the media's version,
 * assigned to the comment's author, with a link back via `sourceCommentId` (frame/annotation restored by ?comment=).
 *
 * Four gaps corrected in Phase 50:
 *  - **rights**: this path checked nothing at all, the route reading the account's GLOBAL role. A supervisor named on
 *    THIS project (role by membership) did not see the entry and was refused if they called it anyway, whereas the
 *    classic creation is open to them. Same gate for both, read on the EFFECTIVE role;
 *  - **writable project**: a task was born on an archived project (38.B);
 *  - **step and status**: the task had neither. Without a reference-list status it fell into the kanban's fallback
 *    column, and disappeared from the board as soon as the project changed vocabulary;
 *  - **ShotGrid site**: the task was never created there, unlike every other creation path. It now goes through the
 *    write queue: the local action does not wait for the site and does not depend on it.
 */
export async function createFromComment(
  user: SessionUser,
  projectId: number,
  commentId: number,
  body: CommentTaskInput = {},
) {
  await assertProjectManage(user.id, user.role, projectId);
  await assertProjectWritable(projectId);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      media: {
        select: {
          version: {
            select: {
              assetId: true,
              task: { select: { shotId: true, assetId: true, type: true, department: true } },
            },
          },
        },
      },
    },
  });
  if (!comment) throw notFound('Comment not found');
  const version = comment.media.version;
  const source = version.task;
  const shotId = source?.shotId ?? null;
  const assetId = source?.assetId ?? version.assetId ?? null;
  if (!shotId && !assetId) throw badRequest('This media has no shot or asset attached');

  // The step of the task carrying the reviewed version: a note on a comp render is comp work. It decides the
  // place in the pipe and who may write to the task; without it, the note went into the catch-all bucket.
  const department = await resolveDepartment(projectId, source?.department ?? null);
  // The project's entry status, in ITS vocabulary: `resolveStatusPair` aligns the enumeration and the reference
  // list, exactly as for a task modified on screen.
  const statusPair = await resolveStatusPair(projectId, { status: TaskStatus.TODO });
  const name = body.name?.trim() || taskNameFromComment(comment.content);

  let task;
  try {
    task = await prisma.task.create({
      data: {
        name,
        type: source?.type ?? TaskType.OTHER,
        ...department,
        ...statusPair,
        description: body.description?.trim() || null,
        shotId,
        assetId: shotId ? null : assetId,
        assigneeId: comment.assigneeId,
        sourceCommentId: comment.id,
      },
      include: { assignee: { select: { id: true, name: true } } },
    });
  } catch (err) {
    // A shot carries only one task per step and name. The name used to come from the text of the note, never
    // the same twice in practice; it is now chosen, so two notes named alike on the same step collide. The fault lies
    // with whoever wrote it, with what is needed to fix it: the dialog is still there.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      // The name travels in the details, not in the message: the client translates by code, and a sentence assembled
      // here would in any case be read by nobody.
      throw new AppError('A task with this name already exists at this step', 409, 'TASK_NAME_TAKEN', {
        name,
      });
    throw err;
  }
  await notifyAssignee(comment.assigneeId, user.id, projectId, task.id, task.name);
  emitTaskUpdate(projectId, task);
  await publishTaskEvents(projectId, task.id, user.id, [
    { event: 'task.created', extra: { sourceCommentId: comment.id } },
  ]);
  await enqueuePush(projectId, { type: 'task-create', taskId: task.id, actorId: user.id });
  return task;
}

/** Task detail (assignee, versions, shot/asset context for the breadcrumb). */
export async function getDetail(id: number) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      // Bounded history: a comp task reworked two hundred times must not make the sheet grow indefinitely.
      // `_count` gives the real number of versions.
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
      // Original comment (32.D): link back to the review at the frame/annotation.
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
  /**
   * Task brief (Phase 50): what there is to do.
   *
   * Reserved to managers, like the name or the schedule: it is production that assigns the work. The assignee reads it;
   * they do not rewrite it: the list of fields they may touch (status, checklist) is unchanged.
   */
  description?: string | null;
  status?: TaskStatus;
  /** Customizable status (Phase 48): written in parallel with `status`. */
  pipelineStatusId?: number | null;
  assigneeId?: number | null;
  order?: number;
  startDate?: Date | null;
  dueDate?: Date | null;
  checklist?: ChecklistItem[];
}

/**
 * Aligns the department key and the foreign key (B1).
 *
 * The relation is authoritative; the string is written in parallel: it is what the pipe reads (`lib/pipelineOrder.ts`),
 * the version nomenclature and the edit snapshots, which are frozen records and need not follow a rename. A step unknown
 * to the project, an imported ShotGrid `step` or a DCC path, is created rather than lost: it exists since someone works on it.
 */
/**
 * A person's rights context on a task: studio policy, effective role, their departments.
 *
 * A single read for both callers (creation and update): letting each query the database on its own would have made them
 * diverge at the first change.
 */
async function taskWriteContext(
  user: SessionUser,
  projectId: number,
): Promise<{ policy: ReturnType<typeof parseTaskPolicy>; isManager: boolean; userDepartmentIds: number[] }> {
  const [row, isManager, departments] = await Promise.all([
    prisma.setting.findUnique({ where: { key: SETTING_KEYS.TASK_DEPARTMENT_POLICY } }),
    isProjectManager(user.id, user.role, projectId),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { departments: { select: { id: true } } },
    }),
  ]);
  return {
    policy: parseTaskPolicy(row?.value),
    isManager,
    userDepartmentIds: (departments?.departments ?? []).map((d) => d.id),
  };
}

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
 * Aligns `pipelineStatusId` and `status` according to what the caller provided.
 * The kanban sends one or the other depending on the originating screen; the database holds both.
 */
async function resolveStatusPair(
  projectId: number,
  body: Pick<UpdateTaskInput, 'status' | 'pipelineStatusId'>,
): Promise<{ status?: TaskStatus; pipelineStatusId?: number | null }> {
  if (body.pipelineStatusId !== undefined) {
    if (body.pipelineStatusId === null) return { pipelineStatusId: null };
    // The status must belong to THIS project's vocabulary: until now nothing prevented setting on a task a status
    // imported from another project's site.
    const offered = await PipelineStatusService.listForProject(projectId, 'task');
    const status = offered.find((s) => s.id === body.pipelineStatusId);
    if (!status) throw badRequest('Unknown pipeline status for this project');
    return { pipelineStatusId: status.id, status: status.legacyStatus ?? TaskStatus.TODO };
  }
  if (body.status !== undefined) {
    // The kanban still sends the six-value enumeration. The match is looked up in the project's vocabulary and
    // nowhere else: re-deriving it from the whole reference list would have replaced "On Hold" with "Waiting to Start",
    // and written that to the studio's ShotGrid site.
    const match = await PipelineStatusService.resolveByLegacy(projectId, 'task', body.status);
    return { status: body.status, ...(match ? { pipelineStatusId: match.id } : {}) };
  }
  return {};
}

/**
 * Sets (or removes) a task's assignee: a single path, outside the general `PATCH`.
 *
 * Batch assignment and asset assignment go through here: they cannot borrow `update()`, which refuses a non-manager
 * any field other than the status, and which expects a full session where the batch only knows the actor.
 */
export async function setAssignee(
  user: SessionUser,
  projectId: number,
  taskId: number,
  assigneeId: number | null,
  opts: { notify?: boolean } = {},
) {
  await assertProjectManage(user.id, user.role, projectId);
  await assertTaskAssignee(projectId, assigneeId);
  const before = await prisma.task.findUnique({ where: { id: taskId }, select: { assigneeId: true } });
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: { assigneeId },
    select: { id: true, name: true, shotId: true, assetId: true },
  });
  if (opts.notify !== false) await notifyAssignee(assigneeId, user.id, projectId, taskId, updated.name);
  emitTaskUpdate(projectId, updated);
  // Batch assignment goes through here: it is the gesture production follows most closely, and it left no trace
  // outside the screen.
  if (before?.assigneeId !== assigneeId)
    await publishTaskEvents(projectId, taskId, user.id, [
      { event: 'task.assigned', extra: { assigneeId, from: before?.assigneeId ?? null } },
      { event: 'task.updated' },
    ]);
  await enqueuePush(projectId, { type: 'task-assignee', taskId, actorId: user.id });
  return updated;
}

export async function update(user: SessionUser, projectId: number, id: number, body: UpdateTaskInput) {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { assigneeId: true, status: true, pipelineStatusId: true, departmentId: true },
  });
  if (!task) throw notFound('Task not found');
  const ctx = await taskWriteContext(user, projectId);
  const manager = ctx.isManager;
  if (!manager) {
    // Which tasks the person can access: always their assignments, and, under the department policy, the members
    // of the step. What they can *change* remains limited to the status and the checklist: responsibility for a
    // step is not that of the schedule.
    const reachable = canWriteTask({
      ...ctx,
      taskDepartmentId: task.departmentId,
      isAssignee: task.assigneeId === user.id,
    });
    const keys = Object.keys(body);
    const allowed = ['status', 'pipelineStatusId', 'checklist'];
    if (!reachable || keys.some((k) => !allowed.includes(k)))
      throw forbidden('On a task assigned to you, only the status and the checklist can change');
  }
  await assertTaskAssignee(projectId, body.assigneeId);
  const { checklist, department, ...rest } = body;
  // Department: the key and the relation move together, as the status does below.
  const departmentPair = department !== undefined ? await resolveDepartment(projectId, department) : {};
  // Status: the customizable reference list and the enumeration move together, whichever of the two the caller
  // provided. Letting them diverge would show one state on the kanban and another on the sheet.
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
  // Change stream: a status change is distinguished from any other modification: it is what production boards
  // follow, and without a dedicated event every consumer would have to compare states itself to find it.
  const statusChanged = updated.status !== task.status || updated.pipelineStatusId !== task.pipelineStatusId;
  await publishTaskEvents(projectId, id, user.id, [
    ...(statusChanged
      ? ([
          {
            event: 'task.status_changed' as const,
            extra: { from: task.status, to: updated.status, pipelineStatusId: updated.pipelineStatusId },
          },
        ] as const)
      : []),
    ...(body.assigneeId !== undefined && updated.assigneeId !== task.assigneeId
      ? ([
          {
            event: 'task.assigned' as const,
            extra: { assigneeId: updated.assigneeId, from: task.assigneeId },
          },
        ] as const)
      : []),
    { event: 'task.updated' },
  ]);
  // 48: what changed goes up to ShotGrid, domain by domain. Dates travel together: ShotGrid recalculates
  // the duration from both.
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
 * Updates a task through the v1 API: status, assignment, due date: the minimum a pipeline drives from a DCC.
 *
 * Rights are asserted by the route (project open, contributor); what is at stake here is the event stream. A status
 * change is distinguished from any other update: it is what production boards follow, and without a dedicated event
 * every client would have to compare states itself to find it.
 */
export async function applyApiPatch(actorId: number, projectId: number, id: number, body: ApiPatchInput) {
  await assertTaskAssignee(projectId, body.assigneeId);
  const before = await prisma.task.findUnique({ where: { id }, select: { status: true } });
  // Same resolution as the interface: the API used to write only the historical enumeration, so that a
  // `PATCH {status}` from a DCC left `pipelineStatusId` on the old value. The sheet showed one state, the kanban
  // another, and nothing went to ShotGrid: the status set by the pipeline existed only for the API.
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
  // Open screens and the remote site learn of the change as they would of a manual edit: the v1 API emitted
  // neither one.
  emitTaskUpdate(projectId, { id, shotId: task.shot?.id ?? null, assetId: task.asset?.id ?? null });
  if (body.status !== undefined) await enqueuePush(projectId, { type: 'task-status', taskId: id, actorId });
  if (body.dueDate !== undefined) await enqueuePush(projectId, { type: 'task-dates', taskId: id, actorId });
  if (body.assigneeId !== undefined)
    await enqueuePush(projectId, { type: 'task-assignee', taskId: id, actorId });
  return view;
}

/**
 * Deletes a task, only if it is empty.
 *
 * `Version.taskId` is `onDelete: Cascade`: deletion takes the task's versions with it, hence the published media and
 * all the review work attached to it. This route had no guard, and no screen called it; exposing it on the kanban's
 * right-click without one would have turned a menu entry into a silent destruction.
 *
 * Same rule as the retirement of a task trashed on the ShotGrid side (`ShotgridPullService.retireTask`), deliberately
 * identical: only empty tasks are deleted, and the number of versions preventing deletion is stated rather than left to
 * guesswork. Emptying them first is an explicit gesture, version by version.
 */
export async function remove(user: SessionUser, projectId: number, id: number) {
  await assertProjectManage(user.id, user.role, projectId);
  const task = await prisma.task.findUnique({ where: { id }, select: { shotId: true, assetId: true } });
  if (!task) throw notFound('Task not found');
  const versions = await prisma.version.count({ where: { taskId: id } });
  if (versions > 0)
    throw new AppError('This task still carries versions - delete them first', 409, 'TASK_HAS_VERSIONS', {
      count: versions,
    });
  await prisma.task.delete({ where: { id } });
  emitTaskUpdate(projectId, { id, shotId: task.shotId, assetId: task.assetId });
}
