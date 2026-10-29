// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { parsePipelinePath, type PipelinePath, type PipelineEntityKind } from '../lib/pipelinePath';
import {
  projectSelect,
  sequenceSelect,
  shotSelect,
  assetSelect,
  taskSelect,
  versionSelect,
} from '../lib/v1Resources';

/**
 * Resolution of pipeline entities from names (API v1).
 *
 * Every read is case-insensitive: a DCC writes `sh0100` where production typed `SH0100`, and refusing over
 * that detail would make the API unusable in practice. The codes remain unique
 * per parent on the database side, so case creates no ambiguity.
 *
 * Nothing here checks rights: the resolved project is returned to the caller, it being up to the route to
 * call `assertProjectAccess` before exposing anything.
 */

/** A reference is either a numeric identifier, or a code/name. */
const asId = (ref: string): number | null => (/^\d+$/.test(ref) ? Number(ref) : null);

const insensitive = (value: string) => ({ equals: value, mode: 'insensitive' as const });

export async function resolveProject(ref: string) {
  const id = asId(ref);
  const project = await prisma.project.findFirst({
    where: {
      deletedAt: null,
      ...(id !== null ? { id } : { OR: [{ slug: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: projectSelect,
  });
  if (!project) throw notFound(`Project « ${ref} » not found`, 'PROJECT_NOT_FOUND');
  return project;
}

export async function resolveSequence(projectId: number, ref: string) {
  const id = asId(ref);
  const sequence = await prisma.sequence.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(id !== null ? { id } : { OR: [{ code: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: sequenceSelect,
  });
  if (!sequence) throw notFound(`Sequence « ${ref} » not found`, 'SEQUENCE_NOT_FOUND');
  return sequence;
}

/**
 * A project's shot. `sequenceId` set to `null` explicitly targets shots without a sequence; `undefined`
 * searches the whole project (the case of a client who only knows the code).
 */
export async function resolveShot(projectId: number, ref: string, sequenceId?: number | null) {
  const id = asId(ref);
  const shot = await prisma.shot.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(sequenceId !== undefined ? { sequenceId } : {}),
      ...(id !== null ? { id } : { OR: [{ code: insensitive(ref) }, { name: insensitive(ref) }] }),
    },
    select: shotSelect,
  });
  if (!shot) throw notFound(`Shot « ${ref} » not found`, 'SHOT_NOT_FOUND');
  return shot;
}

export async function resolveAsset(projectId: number, ref: string) {
  const id = asId(ref);
  const asset = await prisma.asset.findFirst({
    where: {
      projectId,
      deletedAt: null,
      ...(id !== null ? { id } : { name: insensitive(ref) }),
    },
    select: assetSelect,
  });
  if (!asset) throw notFound(`Asset « ${ref} » not found`, 'ASSET_NOT_FOUND');
  return asset;
}

/**
 * A task of a shot XOR an asset, by name (e.g. `anim`, `lighting`).
 *
 * `department` restricts the search: a pipeline readily names the task of each department `main`, and without
 * this precision `modeling:main` and `lookdev:main` would be the same task.
 * Without a department, the search stays on the name alone — the historical paths continue to resolve.
 */
export async function resolveTask(
  parent: { shotId?: number; assetId?: number },
  ref: string,
  department?: string,
) {
  const id = asId(ref);
  const task = await prisma.task.findFirst({
    where: {
      ...(parent.shotId !== undefined ? { shotId: parent.shotId } : { assetId: parent.assetId }),
      ...(id !== null ? { id } : { name: insensitive(ref) }),
      ...(id === null && department ? { department: insensitive(department) } : {}),
    },
    select: taskSelect,
  });
  if (!task) throw notFound(`Task « ${ref} » not found`, 'TASK_NOT_FOUND');
  return task;
}

/** Version of a task XOR an asset, by name (e.g. `v003`). */
export async function resolveVersion(parent: { taskId?: number; assetId?: number }, ref: string) {
  const id = asId(ref);
  const version = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      ...(parent.taskId !== undefined ? { taskId: parent.taskId } : { assetId: parent.assetId }),
      ...(id !== null ? { id } : { name: insensitive(ref) }),
    },
    select: versionSelect,
  });
  if (!version) throw notFound(`Version « ${ref} » not found`, 'VERSION_NOT_FOUND');
  return version;
}

export interface ResolvedPath {
  kind: PipelineEntityKind;
  projectId: number;
  project: Awaited<ReturnType<typeof resolveProject>>;
  sequence?: Awaited<ReturnType<typeof resolveSequence>>;
  shot?: Awaited<ReturnType<typeof resolveShot>>;
  asset?: Awaited<ReturnType<typeof resolveAsset>>;
  task?: Awaited<ReturnType<typeof resolveTask>>;
  version?: Awaited<ReturnType<typeof resolveVersion>>;
}

/** Resolves the asset branch of a parsed path. */
async function resolveAssetBranch(parsed: PipelinePath, out: ResolvedPath): Promise<void> {
  out.asset = await resolveAsset(out.projectId, parsed.asset!);
  if (parsed.task) out.task = await resolveTask({ assetId: out.asset.id }, parsed.task, parsed.department);
  if (parsed.version) {
    out.version = out.task
      ? await resolveVersion({ taskId: out.task.id }, parsed.version)
      : await resolveVersion({ assetId: out.asset.id }, parsed.version);
  }
}

/** Resolves the sequence/shot branch of a parsed path. */
async function resolveShotBranch(parsed: PipelinePath, out: ResolvedPath): Promise<void> {
  if (parsed.sequence) out.sequence = await resolveSequence(out.projectId, parsed.sequence);
  if (parsed.shot) {
    // Without a sequence in the path (`shots/` branch), we target the orphan shots.
    out.shot = await resolveShot(out.projectId, parsed.shot, out.sequence ? out.sequence.id : null);
  }
  if (parsed.task && out.shot)
    out.task = await resolveTask({ shotId: out.shot.id }, parsed.task, parsed.department);
  if (parsed.version && out.task) out.version = await resolveVersion({ taskId: out.task.id }, parsed.version);
}

/**
 * Resolves a complete path into entities. Each missing link raises a 404 naming the offending segment — a
 * pipeline script must be able to say *what* cannot be found.
 */
export async function resolvePath(raw: string): Promise<ResolvedPath> {
  const parsed = parsePipelinePath(raw);
  const project = await resolveProject(parsed.project);
  const out: ResolvedPath = { kind: parsed.kind, projectId: project.id, project };

  if (parsed.asset) await resolveAssetBranch(parsed, out);
  else await resolveShotBranch(parsed, out);

  return out;
}

/** Entity designated by the leaf of the path — what the caller actually asked for. */
export function leafOf(resolved: ResolvedPath) {
  switch (resolved.kind) {
    case 'version':
      return resolved.version;
    case 'task':
      return resolved.task;
    case 'asset':
      return resolved.asset;
    case 'shot':
      return resolved.shot;
    case 'sequence':
      return resolved.sequence;
    default:
      return resolved.project;
  }
}
