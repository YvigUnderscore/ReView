// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TaskStatus, type PipelineStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';

/**
 * Customisable pipeline statuses (tasks and shots).
 *
 * The `TaskStatus` enumeration remains in the database: the kanban columns, the statistics and the API v1
 * rely on it. Each customised status therefore carries its equivalent
 * (`legacyStatus`), written in parallel. A studio without ShotGrid keeps exactly its six original statuses; a
 * connected studio sees those of its site.
 */

/**
 * The four scopes that carry a status.
 *
 * ShotGrid keeps a list **per entity** (`sg_status_list` on Task, Shot, Sequence and Asset), and they do not
 * coincide: four values on a sequence, fifteen on a shot. Confusing them
 * offered the screen states that the site refused on write — and the asset, for its part, borrowed the task
 * vocabulary for lack of one of its own.
 */
export type Scope = 'task' | 'shot' | 'sequence' | 'asset';

/** The scopes offered in the settings screens, in pipe order. */
export const SCOPES: readonly Scope[] = ['task', 'shot', 'sequence', 'asset'];

export interface StatusInput {
  scope: Scope;
  code: string;
  name: string;
  color: string;
  order?: number;
  isDone?: boolean;
  isDefault?: boolean;
  legacyStatus?: TaskStatus | null;
}

// `order` alone leaves ties that Postgres does not break: two statuses of the same rank would come out in a
// varying order from one call to the next, and the "first" serving as a fallback
// would change for no reason. The code decides.
const ORDER_BY = [{ scope: 'asc' as const }, { order: 'asc' as const }, { code: 'asc' as const }];

export async function list(scope?: Scope): Promise<PipelineStatus[]> {
  return prisma.pipelineStatus.findMany({
    where: scope ? { scope } : undefined,
    orderBy: ORDER_BY,
  });
}

/**
 * Statuses to offer on a given project.
 *
 * Three levels, from the most precise to the most general:
 *   1. the vocabulary specific to the project, if it has one (B2);
 * 2. otherwise that of the studio, filtered by origin — a linked project speaks the vocabulary of its site
 * and that alone, a standalone project must never be offered the statuses
 *      imported from a site it is not linked to;
 * 3. as a last resort, and **only for a linked project** whose statuses have not yet been read, the local
 * vocabulary: better that than an empty list.
 *
 * The third level never plays the other way round. That was the missing piece: the previous fallback served
 * ShotGrid statuses to standalone projects.
 */
export async function listForProject(
  projectId: number,
  scope?: Scope,
  options: { all?: boolean } = {},
): Promise<PipelineStatus[]> {
  const where = scope ? { scope } : {};
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  // The studio's sort (`visibleStatuses`) applies to the result, whatever the source: a vocabulary specific
  // to the project is reduced like that of the site.
  const keep = (list: PipelineStatus[]) =>
    options.all ? list : filterVisible(list, connection?.active ? connection.settings : null);

  const own = await prisma.pipelineStatus.findMany({ where: { projectId, ...where }, orderBy: ORDER_BY });
  if (own.length > 0) return keep(own);

  const origin = connection?.active ? 'shotgrid' : 'local';
  const studio = await prisma.pipelineStatus.findMany({
    where: { projectId: null, origin, ...where },
    orderBy: ORDER_BY,
  });
  if (studio.length > 0 || !connection?.active) return keep(studio);

  return keep(
    await prisma.pipelineStatus.findMany({
      where: { projectId: null, origin: 'local', ...where },
      orderBy: ORDER_BY,
    }),
  );
}

/**
 * Keeps only the statuses the studio has retained for this project (ShotGrid setting).
 *
 * A scope without a list remains whole: one never deduces a hiding from an omission. And a filter that no
 * longer recognises any code — codes renamed on the site side, a list inherited
 * from another project — is ignored: better to offer too much than nothing at all; an empty menu cannot be
 * repaired from the screen where it is missing.
 */
function filterVisible(list: PipelineStatus[], settings: unknown): PipelineStatus[] {
  const visible = (settings as { visibleStatuses?: Partial<Record<Scope, string[]>> } | null)
    ?.visibleStatuses;
  if (!visible) return list;
  // The fallback is judged scope by scope: a shot list that has become empty must not be saved by the task
  // statuses which, for their part, remain in the result.
  const kept = new Set<number>();
  for (const scope of SCOPES) {
    const inScope = list.filter((s) => s.scope === scope);
    const codes = visible[scope];
    const shown = !codes || codes.length === 0 ? inScope : inScope.filter((s) => codes.includes(s.code));
    for (const s of shown.length > 0 ? shown : inScope) kept.add(s.id);
  }
  // A scope unknown to `SCOPES` passes through without a filter: it has no setting.
  return list.filter((s) => kept.has(s.id) || !SCOPES.includes(s.scope as Scope));
}

/**
 * The status to set for an enumeration value, within the project's vocabulary.
 *
 * The kanban still sends the six-value enumeration. Resolution looked for "the first status of the whole
 * reference that carries this enum", across all projects and all origins alike: a
 * shot "On Hold" went back down to "Waiting to Start", and the result went back to the studio's ShotGrid
 * site. The search is now bounded to the vocabulary actually offered to the project.
 */
export async function resolveByLegacy(
  projectId: number,
  scope: Scope,
  legacyStatus: TaskStatus,
): Promise<PipelineStatus | null> {
  const candidates = await listForProject(projectId, scope);
  return candidates.find((s) => s.legacyStatus === legacyStatus) ?? null;
}

/**
 * Checks that a status is indeed one of those that may be set on an entity of this project (C3).
 *
 * Same guard as for tasks, extended to shots and sequences whose PATCH simply did not accept the status: the
 * value could only come from the ShotGrid sync, and a standalone studio had
 * no way to change it. `null` clears the status, which is always allowed.
 */
export async function assertBelongsToProject(
  projectId: number,
  scope: Scope,
  statusId: number | null,
): Promise<number | null> {
  if (statusId === null) return null;
  const offered = await listForProject(projectId, scope);
  const found = offered.find((s) => s.id === statusId);
  if (!found) throw badRequest('Unknown pipeline status for this project');
  return found.id;
}

export async function create(input: StatusInput, projectId: number | null = null): Promise<PipelineStatus> {
  const code = normaliseCode(input.code);
  const existing = await prisma.pipelineStatus.findFirst({
    where: { projectId, scope: input.scope, code, origin: 'local' },
  });
  if (existing) throw conflict('A status already uses this code in this scope');
  if (input.isDefault) await clearDefault(input.scope, projectId);
  return prisma.pipelineStatus.create({
    data: {
      projectId,
      scope: input.scope,
      code,
      name: input.name,
      color: input.color,
      order: input.order ?? (await nextOrder(input.scope, projectId)),
      isDone: input.isDone ?? false,
      isDefault: input.isDefault ?? false,
      legacyStatus: input.legacyStatus ?? TaskStatus.TODO,
    },
  });
}

export async function update(id: number, input: Partial<StatusInput>): Promise<PipelineStatus> {
  const status = await prisma.pipelineStatus.findUnique({ where: { id } });
  if (!status) throw notFound('Status not found');
  if (input.isDefault) await clearDefault(status.scope as Scope, status.projectId);
  return prisma.pipelineStatus.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.isDone !== undefined ? { isDone: input.isDone } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.legacyStatus !== undefined ? { legacyStatus: input.legacyStatus } : {}),
    },
  });
}

/**
 * Deletes an unused status. A status carried by tasks or shots does not disappear: the entities concerned
 * would lose their state without anyone having decided which one to give them
 * instead.
 */
export async function remove(id: number): Promise<void> {
  const status = await prisma.pipelineStatus.findUnique({ where: { id } });
  if (!status) throw notFound('Status not found');
  const [tasks, shots] = await Promise.all([
    prisma.task.count({ where: { pipelineStatusId: id } }),
    prisma.shot.count({ where: { pipelineStatusId: id } }),
  ]);
  if (tasks + shots > 0) throw conflict(`This status is used by ${tasks + shots} item(s) — replace it first`);
  const remaining = await prisma.pipelineStatus.count({ where: { scope: status.scope } });
  if (remaining <= 1) throw badRequest('The last status of a scope cannot be deleted');
  await prisma.pipelineStatus.delete({ where: { id } });
}

export async function reorder(scope: Scope, ids: number[]): Promise<PipelineStatus[]> {
  await prisma.$transaction(
    ids.map((id, index) => prisma.pipelineStatus.update({ where: { id }, data: { order: index } })),
  );
  return list(scope);
}

function normaliseCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 40);
}

async function nextOrder(scope: Scope, projectId: number | null): Promise<number> {
  const last = await prisma.pipelineStatus.findFirst({
    where: { scope, projectId },
    orderBy: { order: 'desc' },
  });
  return (last?.order ?? -1) + 1;
}

/** The default status is unique per scope AND per reach: a project has its own. */
async function clearDefault(scope: Scope, projectId: number | null): Promise<void> {
  await prisma.pipelineStatus.updateMany({
    where: { scope, projectId, isDefault: true },
    data: { isDefault: false },
  });
}
