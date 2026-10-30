// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AssetType, Prisma, Role, TaskType, VersionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertCanContribute, assertProjectManage } from '../lib/projectRoles';
import { parsePipelinePath } from '../lib/pipelinePath';
import { resolveProjectSettingsById } from '../lib/projectSettings';
import { sequenceSelect, shotSelect, assetSelect, taskSelect, versionSelect } from '../lib/v1Resources';
import * as DepartmentService from './DepartmentService';
import { emitToProject } from './SocketService';

/**
 * Idempotent creation of the pipeline structure (API v1).
 *
 * "Ensure" rather than "create": a publishing script does not know whether the shot already exists, and
 * should not have to ask before each send. Replaying the same request must
 * converge to the same state, without duplicate or error — this is what makes the API usable from a DCC,
 * where recovery after an incident is the norm.
 *
 * The product's guards apply in full: archived project read-only, CLIENT not a contributor, creation of
 * structure reserved to supervisors.
 */

type Actor = { id: number; role: Role };

export interface EnsureOutcome<T> {
  entity: T;
  /** Has the entity just been created? Lets the client distinguish a resumption from a first send. */
  created: boolean;
}

const insensitive = (value: string) => ({ equals: value, mode: 'insensitive' as const });

/**
 * Recovers a uniqueness violation that occurred despite the prior lookup. Two causes: a concurrent request
 * has just created the entity (it is returned, `created: false`), or the name is held by an entity in the
 * trash — the SQL constraint ignores soft delete. In this second case we answer 409 with a named code, never
 * an internal error.
 */
async function recoverUniqueViolation<T>(
  err: unknown,
  refind: () => Promise<T | null>,
  trashConflict: () => Error,
): Promise<EnsureOutcome<T>> {
  if (!isUniqueViolation(err)) throw err;
  const winner = await refind();
  if (winner) return { entity: winner, created: false };
  throw trashConflict();
}

/** Violation of a uniqueness index (P2002), as opposed to a failure to let propagate. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Creating structure (sequence, shot, asset) commits the production: supervisor+. */
async function assertCanCreateStructure(actor: Actor, projectId: number): Promise<void> {
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);
}

/** Creating a task or a version is routine work: contributor is enough. */
async function assertCanCreateWork(actor: Actor, projectId: number): Promise<void> {
  await assertProjectWritable(projectId);
  await assertCanContribute(actor.id, actor.role, projectId);
}

export interface EnsureSequenceInput {
  code: string;
  name?: string;
  order?: number;
}

export async function ensureSequence(actor: Actor, projectId: number, input: EnsureSequenceInput) {
  const find = () =>
    prisma.sequence.findFirst({
      where: { projectId, deletedAt: null, code: insensitive(input.code) },
      select: sequenceSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.sequence.create({
      data: {
        projectId,
        code: input.code,
        name: input.name ?? input.code,
        order: input.order ?? 0,
      },
      select: sequenceSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`Sequence « ${input.code} » is in the trash`, 'SEQUENCE_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'sequence:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureShotInput {
  code: string;
  name?: string;
  sequenceCode?: string;
  startFrame?: number;
  endFrame?: number;
  order?: number;
}

export async function ensureShot(actor: Actor, projectId: number, input: EnsureShotInput) {
  // The parent sequence is created when needed: publishing a shot of an unknown sequence is the normal case
  // at the start of a production, not an error to pass up to the artist.
  let sequenceId: number | null = null;
  if (input.sequenceCode) {
    const seq = await ensureSequence(actor, projectId, { code: input.sequenceCode });
    sequenceId = seq.entity.id;
  }

  const find = () =>
    prisma.shot.findFirst({
      where: { projectId, deletedAt: null, sequenceId, code: insensitive(input.code) },
      select: shotSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.shot.create({
      data: {
        projectId,
        sequenceId,
        code: input.code,
        name: input.name ?? input.code,
        startFrame: input.startFrame ?? null,
        endFrame: input.endFrame ?? null,
        order: input.order ?? 0,
      },
      select: shotSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`Shot « ${input.code} » is in the trash`, 'SHOT_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'shot:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureAssetInput {
  name: string;
  type?: AssetType;
  description?: string;
}

export async function ensureAsset(actor: Actor, projectId: number, input: EnsureAssetInput) {
  const find = () =>
    prisma.asset.findFirst({
      where: { projectId, deletedAt: null, name: insensitive(input.name) },
      select: assetSelect,
    });
  const existing = await find();
  if (existing) return { entity: existing, created: false };

  await assertCanCreateStructure(actor, projectId);
  let entity;
  try {
    entity = await prisma.asset.create({
      data: {
        projectId,
        name: input.name,
        type: input.type ?? AssetType.OTHER,
        description: input.description ?? null,
      },
      select: assetSelect,
    });
  } catch (err) {
    return recoverUniqueViolation(err, find, () =>
      conflict(`Asset « ${input.name} » is in the trash`, 'ASSET_IN_TRASH'),
    );
  }
  emitToProject(projectId, 'asset:update', { projectId, id: entity.id });
  return { entity, created: true };
}

export interface EnsureTaskInput {
  name: string;
  type?: TaskType;
  /** Pipe department (key). Deduced from the task name if not supplied. */
  department?: string;
}

/** Task attached to a shot XOR an asset. */
export async function ensureTask(
  actor: Actor,
  projectId: number,
  parent: { shotId?: number; assetId?: number },
  input: EnsureTaskInput,
) {
  if ((parent.shotId === undefined) === (parent.assetId === undefined)) {
    throw badRequest('Provide exactly one parent: a shot or an asset');
  }
  const parentWhere = parent.shotId !== undefined ? { shotId: parent.shotId } : { assetId: parent.assetId };
  const { department, departmentId } = await resolveTaskDepartment(projectId, input);

  // The department is part of the task's identity: `modeling:main` and `lookdev:main` coexist, and replaying
  // a publication must find the right one. Both the relation AND the key are queried: tasks from before the
  // catch-up only carry the second, and not seeing them would create a duplicate at each publication.
  const find = () =>
    prisma.task.findFirst({
      where: { ...parentWhere, name: insensitive(input.name), ...departmentWhere(department, departmentId) },
      select: taskSelect,
    });
  const existing = await find();
  if (existing) {
    if (departmentId !== null) await healTaskDepartment(existing.id, departmentId);
    return { entity: existing, created: false };
  }

  await assertCanCreateWork(actor, projectId);
  let entity;
  try {
    entity = await prisma.task.create({
      data: {
        ...parentWhere,
        name: input.name,
        type: input.type ?? inferTaskType(input.name),
        department,
        departmentId,
      },
      select: taskSelect,
    });
  } catch (err) {
    // Two simultaneous publications from the same render farm: the second loses the race and picks up the
    // task the first has just created, instead of making a twin of it.
    return recoverUniqueViolation(err, find, () =>
      conflict(`Task « ${input.name} » already exists`, 'TASK_EXISTS'),
    );
  }
  emitToProject(projectId, 'task:update', { projectId, id: entity.id });
  return { entity, created: true };
}

/** Department criterion of a task search: the relation, or the key, or nothing. */
function departmentWhere(department: string | null, departmentId: number | null) {
  if (departmentId !== null && department)
    return { OR: [{ departmentId }, { department: insensitive(department) }] };
  return department ? { department: insensitive(department) } : {};
}

/**
 * Attaches in passing a task that the earlier publication had linked only by its key.
 * The filter `departmentId: null` makes the write a non-event in the usual case: no row matches, `updatedAt`
 * does not move.
 */
async function healTaskDepartment(taskId: number, departmentId: number): Promise<void> {
  await prisma.task.updateMany({ where: { id: taskId, departmentId: null }, data: { departmentId } });
}

/**
 * Department of a task to create: the denormalised key AND the relation (B1).
 *
 * A key supplied by the client is *declared* — it creates the step if the project does not yet know it, as
 * the ShotGrid import does. A key merely *guessed* from the task's name
 * is not: it is only applied if the step already exists, failing which a heuristic would enrich the studio's
 * pipe. Without it, on the other hand, DCC publications would fill the
 * catch-all "no department" and distort the most advanced step.
 */
async function resolveTaskDepartment(
  projectId: number,
  input: EnsureTaskInput,
): Promise<DepartmentService.TaskDepartment> {
  if (input.department) return DepartmentService.resolveForTask(projectId, input.department);
  const guessed = input.type ?? inferTaskType(input.name);
  if (guessed === TaskType.OTHER) return { department: null, departmentId: null };
  const found = await DepartmentService.findByKey(projectId, guessed);
  if (found) return { department: found.key, departmentId: found.id };
  // Fallback on the settings: a database whose departments are not yet entities keeps writing the key, even
  // without a relation to set.
  const { departments } = await resolveProjectSettingsById(projectId);
  const match = departments.find((d) => d.key.toLowerCase() === guessed.toLowerCase());
  return { department: match?.key ?? null, departmentId: null };
}

/**
 * Guesses a task's type from its name (`anim` → ANIMATION). Task names are highly standardised in production;
 * leaving everything as OTHER would degrade the filters and the statistics for clients who do not send the
 * type.
 */
export function inferTaskType(name: string): TaskType {
  const n = name.toLowerCase();
  const table: [RegExp, TaskType][] = [
    [/^(anim|animation)/, TaskType.ANIMATION],
    [/^(model|modeling|modelling|mod)/, TaskType.MODELING],
    [/^(rig|rigging)/, TaskType.RIGGING],
    [/^(fx|effects|vfx)/, TaskType.FX],
    [/^(light|lighting|lgt)/, TaskType.LIGHTING],
    [/^(comp|compositing)/, TaskType.COMPOSITING],
    [/^(look|lookdev|shading|surf)/, TaskType.LOOKDEV],
    [/^(layout|lay|blocking)/, TaskType.LAYOUT],
  ];
  return table.find(([re]) => re.test(n))?.[1] ?? TaskType.OTHER;
}

export interface EnsureVersionInput {
  /** Explicit name (`v003`). Absent: the next version is computed. */
  name?: string;
  /** Reuse an existing version of the same name rather than failing. */
  reuseExisting?: boolean;
}

/**
 * Version attached to a task XOR an asset. Without a supplied name, the next number is computed (V01, V02…) —
 * two successive publications never overwrite each other.
 */
export async function ensureVersion(
  actor: Actor,
  projectId: number,
  parent: { taskId?: number; assetId?: number },
  input: EnsureVersionInput = {},
) {
  if ((parent.taskId === undefined) === (parent.assetId === undefined)) {
    throw badRequest('Provide exactly one parent: a task or an asset');
  }
  const parentWhere = parent.taskId !== undefined ? { taskId: parent.taskId } : { assetId: parent.assetId };
  const find = (name: string) =>
    prisma.version.findFirst({
      where: { ...parentWhere, deletedAt: null, name: insensitive(name) },
      select: versionSelect,
    });

  if (input.name) {
    const existing = await find(input.name);
    if (existing) {
      if (input.reuseExisting) return { entity: existing, created: false };
      throw badRequest(`Version « ${input.name} » already exists`, 'VERSION_EXISTS');
    }
  }

  await assertCanCreateWork(actor, projectId);
  const create = (name: string) =>
    prisma.version.create({
      data: { ...parentWhere, name, authorId: actor.id, status: VersionStatus.DRAFT },
      select: versionSelect,
    });

  let entity;
  if (input.name) {
    try {
      entity = await create(input.name);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // The name is taken from the search: either by a concurrent publication, or by a version in the trash —
      // the uniqueness index, for its part, ignores soft delete.
      const winner = await find(input.name);
      if (!winner) throw conflict(`Version « ${input.name} » is in the trash`, 'VERSION_IN_TRASH');
      if (input.reuseExisting) return { entity: winner, created: false };
      throw badRequest(`Version « ${input.name} » already exists`, 'VERSION_EXISTS');
    }
  } else {
    entity = await createNextVersion(parentWhere, create);
  }
  emitToProject(projectId, 'version:update', {
    projectId,
    id: entity.id,
    taskId: parent.taskId ?? null,
    assetId: parent.assetId ?? null,
  });
  return { entity, created: true };
}

/**
 * Next version, taking concurrent publications into account.
 *
 * The number is computed outside the transaction: two simultaneous publications aim at the same V03, and one
 * of them loses the race. Returning the other's version to it would be the worst
 * outcome — its media would attach to a colleague's work. We therefore recompute the number and retry: it is
 * indeed "the next version" that was requested.
 */
async function createNextVersion<T>(
  parentWhere: { taskId?: number; assetId?: number },
  create: (name: string) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const name = await nextVersionName(parentWhere);
    try {
      return await create(name);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (attempt >= attempts) throw conflict('Could not allocate a version number', 'VERSION_RACE');
    }
  }
}

/**
 * Next version name. We start from the highest *existing* number and not from the count of versions: after a
 * deletion, counting would give a name already taken.
 */
async function nextVersionName(parentWhere: { taskId?: number; assetId?: number }): Promise<string> {
  const versions = await prisma.version.findMany({ where: parentWhere, select: { name: true } });
  const highest = versions.reduce((max, v) => {
    const n = Number(/(\d+)\s*$/.exec(v.name)?.[1] ?? 0);
    return n > max ? n : max;
  }, 0);
  return `V${String(highest + 1).padStart(2, '0')}`;
}

export interface EnsurePathOptions {
  shot?: Omit<EnsureShotInput, 'code'>;
  asset?: Omit<EnsureAssetInput, 'name'>;
  task?: Omit<EnsureTaskInput, 'name'>;
  version?: EnsureVersionInput;
}

/**
 * Creates the whole chain described by a path (`PROJ/SQ010/SH0100/anim/v003`), touching only what is missing.
 * The project, for its part, is never created implicitly: opening a film
 * is a production decision, not a side effect of a badly configured script.
 */
export async function ensurePath(
  actor: Actor,
  projectId: number,
  rawPath: string,
  opts: EnsurePathOptions = {},
) {
  const parsed = parsePipelinePath(rawPath);
  const created: string[] = [];
  const out: {
    sequenceId?: number;
    shotId?: number;
    assetId?: number;
    taskId?: number;
    versionId?: number;
    created: string[];
  } = { created };

  if (parsed.asset) {
    const asset = await ensureAsset(actor, projectId, { name: parsed.asset, ...opts.asset });
    out.assetId = asset.entity.id;
    if (asset.created) created.push('asset');
  } else {
    if (parsed.sequence) {
      const seq = await ensureSequence(actor, projectId, { code: parsed.sequence });
      out.sequenceId = seq.entity.id;
      if (seq.created) created.push('sequence');
    }
    if (parsed.shot) {
      const shot = await ensureShot(actor, projectId, {
        code: parsed.shot,
        sequenceCode: parsed.sequence,
        ...opts.shot,
      });
      out.shotId = shot.entity.id;
      if (shot.created) created.push('shot');
    }
  }

  if (parsed.task) {
    const parent = out.shotId !== undefined ? { shotId: out.shotId } : { assetId: out.assetId };
    // The department of the path (`layout:main`) yields only to a value explicitly passed as an option by the
    // caller.
    const task = await ensureTask(actor, projectId, parent, {
      name: parsed.task,
      department: parsed.department,
      ...opts.task,
    });
    out.taskId = task.entity.id;
    if (task.created) created.push('task');
  }

  if (parsed.version) {
    const parent = out.taskId !== undefined ? { taskId: out.taskId } : { assetId: out.assetId };
    const version = await ensureVersion(actor, projectId, parent, {
      name: parsed.version,
      ...opts.version,
    });
    out.versionId = version.entity.id;
    if (version.created) created.push('version');
  }

  return out;
}
