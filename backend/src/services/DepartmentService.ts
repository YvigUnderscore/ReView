// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, type Department, type Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { storage, StorageService } from './StorageService';
import { logAudit } from './AuditService';
import { isProjectManager } from '../lib/projectRoles';
import { parseTaskPolicy, writableDepartments } from '../lib/taskDepartmentPolicy';
import { SETTING_KEYS } from '../lib/settings';

/**
 * Pipeline departments (B1).
 *
 * A department used to be an entry of a JSON array in the settings: nothing guaranteed that a task pointed to
 * an existing step, and renaming a key silently detached everything attached to it. It is now an entity, with
 * two scopes:
 *
 * - **studio** (`projectId = null`): the default pipe, inherited by all projects;
 * - **project**: a project's own list, which entirely replaces the studio's.
 *
 * Replacement is deliberately total, not merged: a project that redefines its pipe really redefines it,
 * otherwise one could no longer tell where a step comes from nor how to remove it.
 */

export interface DepartmentInput {
  key?: string;
  name: string;
  order?: number;
  color?: string | null;
  /** Object key of the department's image (uploaded like an entity thumbnail). */
  imageKey?: string | null;
}

/** Entities that can declare the departments they go through. */
export type DepartmentHolder = 'asset' | 'shot' | 'sequence';

/**
 * Actor of a logged gesture (A5-03). The three structuring writes — renaming, removing, renumbering — decide
 * what "the latest version" of a shot is (`lib/pipelineOrder`); they cannot remain anonymous. The caller
 * always knows it: it is `req.user`, hence the mandatory rather than optional parameter.
 */
export type DepartmentActor = { id: number };

const ORDER_BY = [{ order: 'asc' as const }, { key: 'asc' as const }];

/**
 * A department as the screens read it: its image already signed.
 *
 * Departments are counted in tens, never in thousands: signing the whole list costs less than a round trip
 * per displayed badge, and the cache of `StorageService` already memoizes identical URLs.
 */
export type DepartmentView = Department & { imageUrl: string | null };

async function withImages(departments: Department[]): Promise<DepartmentView[]> {
  return Promise.all(
    departments.map(async (d) => ({
      ...d,
      imageUrl: d.imageKey ? await storage.getPresignedGetUrl(d.imageKey) : null,
    })),
  );
}

/** Accepted image types for a department — the same as for an entity thumbnail. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

/** Short-lived upload URL for a department's image, and its key. */
export async function presignImage(id: number, contentType: string) {
  const ext = IMAGE_EXTENSIONS[contentType];
  if (!ext) throw badRequest('Unsupported image type', 'BAD_CONTENT_TYPE');
  const department = await prisma.department.findUnique({ where: { id }, select: { id: true } });
  if (!department) throw notFound('Department not found');
  const key = StorageService.departmentImageKey(id, ext);
  return { url: await storage.getPresignedPutUrl(key, contentType, 900), key };
}

/**
 * Records the image. The key is checked against the department's prefix: without this check, a PATCH would
 * suffice to display any object in the bucket.
 */
export async function setImage(id: number, key: string | null): Promise<DepartmentView> {
  if (key !== null) {
    if (!key.startsWith(`entity-thumbs/department/${id}.`))
      throw badRequest('Image key does not match the department', 'BAD_KEY');
    // The key depends only on the identifier: replacing the image rewrites the same object, and the memoized
    // URL would otherwise serve the old one from the browser cache.
    storage.forgetPresignedUrl(key);
  }
  const updated = await prisma.department.update({ where: { id }, data: { imageKey: key } });
  return (await withImages([updated]))[0]!;
}

/** Studio departments, inherited by the projects that do not redefine them. */
export async function listForStudio(studioId: number): Promise<DepartmentView[]> {
  return withImages(
    await prisma.department.findMany({
      where: { studioId, projectId: null, deletedAt: null },
      orderBy: ORDER_BY,
    }),
  );
}

/**
 * Departments applicable to a project: its own if it has any, otherwise the studio's.
 * This is the list that the pipe (`lib/pipelineOrder.ts`) reads to order the steps.
 */
export async function listForProject(projectId: number): Promise<DepartmentView[]> {
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    orderBy: ORDER_BY,
  });
  if (own.length > 0) return withImages(own);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return [];
  return listForStudio(project.studioId);
}

/**
 * A project's departments, each accompanied by "can this person create a task there?".
 *
 * The flag is **advisory**: it lets the screen offer two entries rather than twelve under the department
 * policy, but the server re-checks on write — a client does not check itself (`TaskService.create`).
 */
export async function listForProjectWithRights(
  projectId: number,
  user: { id: number; role: Role },
): Promise<(DepartmentView & { writable: boolean })[]> {
  const departments = await listForProject(projectId);
  const [setting, manager, me] = await Promise.all([
    prisma.setting.findUnique({ where: { key: SETTING_KEYS.TASK_DEPARTMENT_POLICY } }),
    isProjectManager(user.id, user.role, projectId),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { departments: { select: { id: true } } },
    }),
  ]);
  const allowed = new Set(
    writableDepartments(departments, {
      policy: parseTaskPolicy(setting?.value),
      isManager: manager,
      userDepartmentIds: (me?.departments ?? []).map((d) => d.id),
    }),
  );
  return departments.map((d) => ({ ...d, writable: allowed.has(d.id) }));
}

/**
 * Stable key derived from the name. Immutable after creation: it is what tasks, timelines and edit snapshots
 * carry.
 */
export function normaliseKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export async function create(
  studioId: number,
  projectId: number | null,
  input: DepartmentInput,
): Promise<Department> {
  const key = normaliseKey(input.key ?? input.name);
  if (!key) throw badRequest('Department name cannot be empty');
  const existing = await prisma.department.findFirst({
    where: projectId === null ? { studioId, projectId: null, key } : { projectId, key },
  });
  if (existing) {
    // Revive rather than refuse: deleting then recreating a step is a common gesture, and the key must stay
    // the same for earlier tasks to be found again.
    if (existing.deletedAt)
      return prisma.department.update({
        where: { id: existing.id },
        data: { deletedAt: null, name: input.name, order: input.order ?? existing.order },
      });
    throw conflict('A department already uses this key');
  }
  return prisma.department.create({
    data: {
      studioId,
      projectId,
      key,
      name: input.name.trim(),
      order: input.order ?? (await nextOrder(studioId, projectId)),
      color: input.color ?? null,
    },
  });
}

/** The name, order and colour can be modified; the key never. */
export async function update(
  actor: DepartmentActor,
  id: number,
  input: Partial<DepartmentInput>,
): Promise<Department> {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department not found');
  const updated = await prisma.department.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
    },
  });
  logAudit({
    userId: actor.id,
    action: 'DEPARTMENT_UPDATE',
    entityType: 'Department',
    entityId: id,
    // `previousOrder` is the field that matters: it is what designated the latest version.
    metadata: {
      key: department.key,
      projectId: department.projectId,
      previousOrder: department.order,
      changes: { ...input },
    },
  });
  return updated;
}

/**
 * Removal of a department. The tasks that carried it keep their denormalized key and simply return to the end
 * of the pipe: nothing is lost, and restoring the department brings them back. It is a logical removal, never
 * a deletion of work.
 */
export async function remove(actor: DepartmentActor, id: number): Promise<void> {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department not found');
  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
  logAudit({
    userId: actor.id,
    action: 'DEPARTMENT_DELETE',
    entityType: 'Department',
    entityId: id,
    metadata: { key: department.key, projectId: department.projectId, order: department.order },
  });
}

/**
 * Renumbers a pipe — and **only one**.
 *
 * `order` is not decorative: it designates the latest version of a shot (`lib/pipelineOrder`). The function
 * wrote the position in the array to every named `Department` row, without reading anything first: a foreign
 * identifier slipped into the list — a stale screen, a direct `curl` — reordered the pipe of another project
 * or that of the studio reference, and the deliverable version of shots we had not touched changed
 * department. The batch must therefore be complete and homogeneous: same studio, same scope (project, or
 * studio reference).
 */
export async function reorder(actor: DepartmentActor, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const unique = [...new Set(ids)];
  const rows = await prisma.department.findMany({
    where: { id: { in: unique } },
    select: { id: true, studioId: true, projectId: true },
  });
  if (rows.length !== unique.length) throw notFound('Department not found');
  const scopes = new Set(rows.map((r) => `${r.studioId}:${r.projectId ?? 'studio'}`));
  if (scopes.size > 1)
    throw badRequest('Reordering mixes departments from different scopes', 'DEPARTMENT_SCOPE_MIX');
  const [first] = rows;
  await prisma.$transaction(
    ids.map((id, index) => prisma.department.update({ where: { id }, data: { order: index } })),
  );
  logAudit({
    userId: actor.id,
    action: 'DEPARTMENT_REORDER',
    entityType: 'Department',
    entityId: ids[0],
    // The trace carries the WHOLE batch and its scope: it is the pipe's order, not a single row, that has
    // just changed — and with it "the latest version" of all the targeted shots.
    metadata: { ids, studioId: first?.studioId ?? null, projectId: first?.projectId ?? null },
  });
}

/**
 * Departments an entity declares it goes through. Replaces the whole list — the caller sends the desired
 * state, not a delta.
 */
/**
 * The project the carrying entity belongs to. Without it, no check is possible: a single department
 * identifier was enough to attach another project's step.
 */
export async function holderProjectId(holder: DepartmentHolder, id: number): Promise<number> {
  const row =
    holder === 'asset'
      ? await prisma.asset.findUnique({ where: { id }, select: { projectId: true } })
      : holder === 'shot'
        ? await prisma.shot.findUnique({ where: { id }, select: { projectId: true } })
        : await prisma.sequence.findUnique({ where: { id }, select: { projectId: true } });
  if (!row) throw notFound('Entity not found');
  return row.projectId;
}

/**
 * Checks that each department belongs to this project's vocabulary.
 *
 * Attachment did not check it at all: an identifier taken elsewhere — another project's step, or a deleted
 * step — was placed without a murmur, and the entity found itself in a pipe that was not its own.
 */
export async function assertDepartmentsOfProject(projectId: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { studioId: true },
  });
  if (!project) throw notFound('Project not found');
  /**
   * The project **and** the studio.
   *
   * `listForProject` is used to *propose* a list — a project declaring its own steps replaces the studio's in
   * the menus. But it does not make the studio's steps illegitimate: tasks already in the database often live
   * in a studio step, and refusing them here would prevent assigning work on those tasks. What is forbidden
   * is the step of **another project** — that one cannot be recovered.
   */
  const allowed = await prisma.department.findMany({
    where: {
      deletedAt: null,
      studioId: project.studioId,
      OR: [{ projectId }, { projectId: null }],
    },
    select: { id: true },
  });
  const known = new Set(allowed.map((d) => d.id));
  const stranger = ids.find((id) => !known.has(id));
  if (stranger !== undefined) throw badRequest('Unknown department for this project', 'BAD_DEPARTMENT');
}

async function writeHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departments: Prisma.AssetUpdateInput['departments'],
): Promise<void> {
  if (holder === 'asset') await prisma.asset.update({ where: { id }, data: { departments } });
  else if (holder === 'shot') await prisma.shot.update({ where: { id }, data: { departments } });
  else await prisma.sequence.update({ where: { id }, data: { departments } });
}

export async function setHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  await assertDepartmentsOfProject(await holderProjectId(holder, id), departmentIds);
  await writeHolderDepartments(holder, id, {
    set: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** Adds departments without touching the others — idempotent. */
export async function attachHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  if (departmentIds.length === 0) return;
  await assertDepartmentsOfProject(await holderProjectId(holder, id), departmentIds);
  await writeHolderDepartments(holder, id, {
    connect: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** Removes departments without touching the others — idempotent. */
export async function detachHolderDepartments(
  holder: DepartmentHolder,
  id: number,
  departmentIds: number[],
): Promise<void> {
  if (departmentIds.length === 0) return;
  await writeHolderDepartments(holder, id, {
    disconnect: departmentIds.map((departmentId) => ({ id: departmentId })),
  });
}

/** A person's departments (studio directory). */
export async function setUserDepartments(userId: number, departmentIds: number[]): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { departments: { set: departmentIds.map((id) => ({ id })) } },
  });
}

/**
 * Department bearing this key, without creating it. Two scopes are searched, in this order: the project's,
 * then the studio's.
 *
 * `listForProject` is not suitable here: it *proposes* a list, and masks the studio reference as soon as the
 * project has its own. Yet a task already in the database often carries a studio step — it is the same
 * reasoning as `assertDepartmentsOfProject`: what is refused is the step of ANOTHER project.
 *
 * The comparison ignores case and punctuation: the remote site sends "Look Development" where the database
 * holds `LOOK_DEV`, and the keys carried over by the catch-up migration have not all been normalised.
 */
export async function findByKey(projectId: number, key: string): Promise<Department | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return null;
  const candidates = await prisma.department.findMany({
    where: { deletedAt: null, studioId: project.studioId, OR: [{ projectId }, { projectId: null }] },
    orderBy: ORDER_BY,
  });
  const needle = trimmed.toLowerCase();
  const normalised = normaliseKey(trimmed);
  const matches = (d: Department) =>
    d.key.toLowerCase() === needle || (normalised !== '' && normaliseKey(d.key) === normalised);
  return (
    candidates.find((d) => d.projectId === projectId && matches(d)) ??
    candidates.find((d) => d.projectId === null && matches(d)) ??
    null
  );
}

/**
 * Resolves a department by its key, within the project's vocabulary. Used to attach a task when the caller
 * only knows the key — ShotGrid import, notably. Creates the missing step at project level rather than losing
 * it: a step coming from the remote site exists, even if the studio did not declare it.
 */
export async function resolveByKey(projectId: number, key: string): Promise<Department | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const found = await findByKey(projectId, trimmed);
  if (found) return found;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return null;
  await materialiseInheritance(project.studioId, projectId);
  try {
    return await create(project.studioId, projectId, { key: trimmed, name: trimmed, order: 900 });
  } catch (err) {
    // Two simultaneous publications carrying the same unknown step: the second loses the race against the
    // uniqueness index. What matters is the expected result, not who wrote it — we re-read what the other has
    // just set.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
    return findByKey(projectId, trimmed);
  }
}

/**
 * Freezes the inheritance before adding a step to the project.
 *
 * A project with no list of its own inherits the studio's; setting ONE step on it does not add it to the
 * inherited list, it replaces it entirely (`listForProject` stops at the first non-empty list). A single
 * imported `step` was therefore enough to reduce a project's pipe to one line, and to make the eight steps it
 * displayed a minute earlier disappear from the menus. The inheritance is therefore copied at project scope,
 * then completed.
 *
 * The project then stops following the studio's changes — that is the price, and it is reversible: removing
 * its own steps gives it back the inheritance.
 */
async function materialiseInheritance(studioId: number, projectId: number): Promise<void> {
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true },
  });
  if (own.length > 0) return;
  const inherited = await listForStudio(studioId);
  if (inherited.length === 0) return;
  await prisma.department.createMany({
    data: inherited.map((d) => ({
      studioId,
      projectId,
      key: d.key,
      name: d.name,
      order: d.order,
      color: d.color,
    })),
    skipDuplicates: true,
  });
  // A step the project carried in the trash keeps its key (the uniqueness index ignores soft delete): the
  // copy above skipped it, so we pick it up to make sure the frozen list is the one that was displayed.
  await prisma.department.updateMany({
    where: { projectId, deletedAt: { not: null }, key: { in: inherited.map((d) => d.key) } },
    data: { deletedAt: null },
  });
}

/** What a task carries: the denormalized key AND the relation (B1). */
export interface TaskDepartment {
  department: string | null;
  departmentId: number | null;
}

/**
 * `{department, departmentId}` pair to write on a task, from any key.
 *
 * All write paths go through here — interface, DCC publication, ShotGrid import — so that the relation is no
 * longer the privilege of one of them: a task with only the string filled in is invisible to assignment by
 * department.
 *
 * `create: false` forbids creation: this is the policy applied to *guessed* keys (the type deduced from a
 * task's name). A guess has no business enriching a studio's pipe; a step explicitly named by a DCC or by the
 * remote site does.
 */
export async function resolveForTask(
  projectId: number,
  key: string | null | undefined,
  options: { create?: boolean } = {},
): Promise<TaskDepartment> {
  const trimmed = key?.trim();
  if (!trimmed) return { department: null, departmentId: null };
  const found =
    options.create === false ? await findByKey(projectId, trimmed) : await resolveByKey(projectId, trimmed);
  // Step not found and creation refused: the key is still written as is rather than lost — it carries the
  // pipe's order and the naming of versions.
  return found
    ? { department: found.key, departmentId: found.id }
    : { department: trimmed, departmentId: null };
}

/**
 * Aligns a project's departments with the list edited in its settings (B1).
 *
 * The settings screen always handles an ordered list of `{key, name}` — the most readable form for a pipe.
 * This function translates it into entities: it creates what is missing, renames and reorders what exists,
 * and logically removes the rest. Without it, the editor would write into a JSON nobody reads any more.
 *
 * The key identifies: renaming it amounts to removing one step and adding another — precisely what is wanted,
 * rather than the silent detachment of before.
 */
export async function syncFromSettings(
  projectId: number,
  wanted: { key: string; name: string }[],
): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { studioId: true } });
  if (!project) return;
  const current = await listForProject(projectId);
  // A list identical to the studio's has no reason to be copied into the project: it keeps inheriting, and
  // will follow the changes of the reference.
  const sameAsInherited =
    current.every((d) => d.projectId === null) &&
    current.length === wanted.length &&
    current.every((d, i) => d.key === normaliseKey(wanted[i]!.key) && d.name === wanted[i]!.name.trim());
  if (sameAsInherited) return;

  const own = await prisma.department.findMany({ where: { projectId } });
  const byKey = new Map(own.map((d) => [d.key.toLowerCase(), d]));
  const keptIds = new Set<number>();

  for (const [index, entry] of wanted.entries()) {
    const key = normaliseKey(entry.key || entry.name);
    if (!key) continue;
    const existing = byKey.get(key.toLowerCase());
    if (existing) {
      keptIds.add(existing.id);
      await prisma.department.update({
        where: { id: existing.id },
        data: { name: entry.name.trim() || key, order: index, deletedAt: null },
      });
      continue;
    }
    const created = await prisma.department.create({
      data: { studioId: project.studioId, projectId, key, name: entry.name.trim() || key, order: index },
    });
    keptIds.add(created.id);
  }

  const removed = own.filter((d) => !keptIds.has(d.id) && !d.deletedAt);
  if (removed.length > 0)
    await prisma.department.updateMany({
      where: { id: { in: removed.map((d) => d.id) } },
      data: { deletedAt: new Date() },
    });
}

async function nextOrder(studioId: number, projectId: number | null): Promise<number> {
  const last = await prisma.department.findFirst({
    where: projectId === null ? { studioId, projectId: null } : { projectId },
    orderBy: { order: 'desc' },
  });
  return (last?.order ?? -1) + 1;
}

/**
 * A person's departments **within a project's vocabulary**.
 *
 * `User.departments` spans the whole studio: a person working on three projects carries the steps of all
 * three. A project's Members tab only shows one of them, and must therefore return — and allow removing —
 * only what belongs to it.
 */
export async function listMemberDepartments(projectId: number, userId: number): Promise<Department[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      departments: {
        // Same scope as `assertDepartmentsOfProject`: the project's steps AND those of the inherited
        // reference. One instance = one studio, so `projectId: null` designates only one reference.
        where: { deletedAt: null, OR: [{ projectId }, { projectId: null }] },
        orderBy: ORDER_BY,
      },
    },
  });
  return user?.departments ?? [];
}

/**
 * A member's departments on a project: one ticks and unticks, one never replaces.
 *
 * **An artist belongs to SEVERAL departments, not just one.** The relation has been multiple since wave B,
 * and the studio is right: a compositing lead who also does roto, a generalist moving from layout to lighting
 * — forcing them to choose one box would make the "my department" filter and the suggested assignment wrong,
 * since both read this list.
 *
 * Why not `setUserDepartments`? Because it replaces the WHOLE list. From this screen one only sees a
 * project's vocabulary: sending the displayed state there would silently erase the steps the person holds on
 * another project. The added and removed departments are therefore named, and both are checked against the
 * project's vocabulary — otherwise an identifier taken elsewhere would suffice to detach someone from a
 * project one is not even looking at.
 */
export async function setMemberDepartments(
  actor: DepartmentActor,
  projectId: number,
  userId: number,
  change: { add?: number[]; remove?: number[] },
): Promise<Department[]> {
  const membership = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });
  if (!membership) throw notFound('This user is not a member of the project');

  const add = [...new Set(change.add ?? [])];
  const remove = [...new Set(change.remove ?? [])].filter((id) => !add.includes(id));
  await assertDepartmentsOfProject(projectId, [...add, ...remove]);

  if (add.length > 0 || remove.length > 0) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        departments: {
          connect: add.map((id) => ({ id })),
          disconnect: remove.map((id) => ({ id })),
        },
      },
    });
    logAudit({
      userId: actor.id,
      action: 'PROJECT_MEMBER_DEPARTMENTS',
      entityType: 'Project',
      entityId: projectId,
      metadata: { targetUserId: userId, added: add, removed: remove },
    });
  }
  return listMemberDepartments(projectId, userId);
}
