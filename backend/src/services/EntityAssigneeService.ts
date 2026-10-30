// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage, canContribute, effectiveProjectRole } from '../lib/projectRoles';
import type { SessionUser } from '../lib/shotgridAccess';
import { emitToProject } from './SocketService';
import { avatarUrl } from '../lib/userView';

/**
 * Who is on this shot, this sequence, this asset.
 *
 * Assignment already existed, but only on **tasks**: "give this asset to Alice" translated into "put Alice on
 * each of her tasks" (`AssignmentService`). That is the pipeline's correct data, and it stays. But it cannot
 * say "this sequence is followed by Bruno" when Bruno has no task on it — the sequence supervisor, the
 * production, the lead covering three shots. A production commonly states that responsibility; ReView could
 * not record it.
 *
 * The two therefore coexist and do not replace each other: the task carries the work, the entity carries the
 * responsibility. The screens display them together, the task first.
 */

export const ASSIGNEE_KINDS = ['episode', 'sequence', 'shot', 'asset'] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

/** What a card needs to know about an assignee: what to display it, nothing more. */
export const ASSIGNEE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  avatarKey: true,
  jobTitle: true,
} as const;

/** A person read from the database: the object key of their photo, not yet signed. */
interface RawAssignee {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string;
  avatarKey: string | null;
  jobTitle: string | null;
}

/**
 * The same, as the API returns it: photo signed.
 *
 * Shot and asset lists already return `avatarUrl`; returning `avatarKey` here would have produced two forms
 * for the same person depending on whether one reads a list or has just written — and the screen would have
 * shown the initials badge right after assignment, then the real photo on reload.
 */
export type AssigneeView = Omit<RawAssignee, 'avatarKey'> & { avatarUrl: string | null };

/** A person, as the API returns them — photo signed. */
export async function toAssigneeView({ avatarKey, ...person }: RawAssignee): Promise<AssigneeView> {
  return { ...person, avatarUrl: await avatarUrl(avatarKey) };
}

/** Signs the photos of a batch, once per person. */
async function signed(people: RawAssignee[]): Promise<AssigneeView[]> {
  return Promise.all(people.map(toAssigneeView));
}

/** The project of the carrying entity, and its existence. */
async function resolveProject(kind: AssigneeKind, id: number): Promise<number> {
  const row = await findEntity(kind, id);
  if (!row) throw notFound('Entity not found');
  return row.projectId;
}

async function findEntity(kind: AssigneeKind, id: number): Promise<{ projectId: number } | null> {
  const where = { id, deletedAt: null };
  const select = { projectId: true };
  switch (kind) {
    case 'episode':
      return prisma.episode.findFirst({ where, select });
    case 'sequence':
      return prisma.sequence.findFirst({ where, select });
    case 'shot':
      return prisma.shot.findFirst({ where, select });
    case 'asset':
      return prisma.asset.findFirst({ where, select });
  }
}

/**
 * Who can receive work or a responsibility — **single guard** for the three assignment paths: the entity
 * (here), the task (`AssignmentService`) and the review (`ReviewAssignmentService`).
 *
 * Four refusals: a service account (a machine identity does not open Maya), a disabled account, a client
 * (they comment, they do not deliver) and someone who is not a member of the
 * project — assigning them would notify them of work they cannot even open.
 *
 * `AssignmentService` kept a private copy with three refusals, without `disabledAt`: a disabled account was
 * therefore refused as a shot owner and accepted as a task assignee. A guard copy that diverges becomes the
 * service door of the other; only one remains.
 */
export async function assertAssignable(projectId: number, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role: true, isService: true, disabledAt: true },
  });
  if (users.length !== userIds.length) throw notFound('User not found');
  for (const user of users) {
    if (user.isService) throw badRequest('A service account cannot be assigned work', 'NOT_ASSIGNABLE');
    if (user.disabledAt) throw badRequest('This account is disabled', 'NOT_ASSIGNABLE');
    const role = await effectiveProjectRole(user.id, user.role, projectId);
    if (!canContribute(role))
      throw badRequest('This person cannot be assigned work on this project', 'NOT_ASSIGNABLE');
  }
}

/**
 * Replaces the list of people responsible for an entity.
 *
 * `set` rather than `connect`: the caller sends the list it wants to see, and two concurrent writes cannot
 * leave a ghost assignee that no one chose.
 */
export async function setAssignees(
  actor: SessionUser,
  kind: AssigneeKind,
  id: number,
  userIds: number[],
): Promise<AssigneeView[]> {
  const projectId = await resolveProject(kind, id);
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);
  const unique = [...new Set(userIds)];
  await assertAssignable(projectId, unique);

  const data = { assignees: { set: unique.map((userId) => ({ id: userId })) } };
  const include = { assignees: { select: ASSIGNEE_SELECT, orderBy: { id: 'asc' as const } } };
  const updated = await writeAssignees(kind, id, data, include);
  emitToProject(projectId, `${kind}:update`, { id });
  return signed(updated);
}

async function writeAssignees(
  kind: AssigneeKind,
  id: number,
  data: { assignees: { set: { id: number }[] } },
  include: { assignees: { select: typeof ASSIGNEE_SELECT; orderBy: { id: 'asc' } } },
): Promise<RawAssignee[]> {
  switch (kind) {
    case 'episode':
      return (await prisma.episode.update({ where: { id }, data, include })).assignees;
    case 'sequence':
      return (await prisma.sequence.update({ where: { id }, data, include })).assignees;
    case 'shot':
      return (await prisma.shot.update({ where: { id }, data, include })).assignees;
    case 'asset':
      return (await prisma.asset.update({ where: { id }, data, include })).assignees;
  }
}

/**
 * All the people of a scope, the entity and its children included.
 *
 * This is what a sequence page header shows: "who works on this" has no meaning if it stops at the sequence
 * itself — the work is on its shots, and on the tasks of its shots. Three sources therefore, merged and
 * de-duplicated, with the origin of each so that the screen can say it.
 */
export interface ScopeAssignee extends RawAssignee {
  /** `direct` = set on the entity; `child` = on a child; `task` = on a task. */
  origins: ('direct' | 'child' | 'task')[];
  /** Number of items linking this person to the scope (for sorting). */
  count: number;
}

export async function scopeAssignees(
  kind: AssigneeKind,
  id: number,
): Promise<(AssigneeView & { origins: ScopeAssignee['origins']; count: number })[]> {
  const collected = new Map<number, ScopeAssignee>();
  const add = (user: RawAssignee, origin: 'direct' | 'child' | 'task') => {
    const existing = collected.get(user.id);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      existing.count += 1;
      return;
    }
    collected.set(user.id, { ...user, origins: [origin], count: 1 });
  };

  for (const user of await directAssignees(kind, id)) add(user, 'direct');
  for (const user of await childAssignees(kind, id)) add(user, 'child');
  for (const user of await taskAssignees(kind, id)) add(user, 'task');

  // Direct owners first, then the most involved: this is the order in which one looks for someone when
  // opening a sequence.
  const ordered = [...collected.values()].sort((a, b) => {
    const direct = Number(b.origins.includes('direct')) - Number(a.origins.includes('direct'));
    return direct !== 0 ? direct : b.count - a.count;
  });
  const photos = await signed(ordered);
  return ordered.map((person, index) => ({
    ...photos[index]!,
    origins: person.origins,
    count: person.count,
  }));
}

async function directAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  const select = { assignees: { select: ASSIGNEE_SELECT } };
  switch (kind) {
    case 'episode':
      return (await prisma.episode.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'sequence':
      return (await prisma.sequence.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'shot':
      return (await prisma.shot.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'asset':
      return (await prisma.asset.findUnique({ where: { id }, select }))?.assignees ?? [];
  }
}

/** Owners set on children — a shot has none, nor does an asset. */
async function childAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  if (kind === 'shot' || kind === 'asset') return [];
  const shots = await prisma.shot.findMany({
    where:
      kind === 'episode'
        ? { sequence: { episodeId: id }, deletedAt: null, hiddenAt: null }
        : { sequenceId: id, deletedAt: null, hiddenAt: null },
    select: { assignees: { select: ASSIGNEE_SELECT } },
  });
  const sequences =
    kind === 'episode'
      ? await prisma.sequence.findMany({
          where: { episodeId: id, deletedAt: null, hiddenAt: null },
          select: { assignees: { select: ASSIGNEE_SELECT } },
        })
      : [];
  return [...shots, ...sequences].flatMap((row) => row.assignees);
}

/** Assignees of the tasks in the scope: the real work, the one that carries a status. */
async function taskAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  const where =
    kind === 'asset'
      ? { assetId: id }
      : kind === 'shot'
        ? { shotId: id }
        : kind === 'sequence'
          ? { shot: { sequenceId: id, deletedAt: null, hiddenAt: null } }
          : { shot: { sequence: { episodeId: id }, deletedAt: null, hiddenAt: null } };
  const tasks = await prisma.task.findMany({
    where: { ...where, assigneeId: { not: null } },
    select: { assignee: { select: ASSIGNEE_SELECT } },
  });
  return tasks.map((t) => t.assignee).filter((u): u is RawAssignee => u !== null);
}
