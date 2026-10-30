// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { parseProjectCsv, type CsvIssue } from '../lib/projectCsvParse';
import { CSV_FIELDS, type ColumnOverride, type CsvField } from '../lib/projectCsvColumns';
import { logAudit } from './AuditService';
import * as DepartmentService from './DepartmentService';
import * as PipelineStatusService from './PipelineStatusService';
import {
  buildPlan,
  type ImportContext,
  type ImportCounts,
  type ImportPlan,
  type RowOutcome,
  type ShotRef,
} from './ProjectImportPlan';

/**
 * A studio's entry into ReView through a CSV file.
 *
 * Three guarantees, in this order:
 *
 * 1. **Preview before writing.** `preview` returns the exact plan — creations, updates, unchanged rows,
 * rejected rows and their reason — without touching the database.
 * 2. **Idempotence.** The business identity (`(project, sequence, code)` for a shot, `(shot, name)` for a
 * task) is that of the uniqueness indexes: replaying the file rebuilds
 * the same plan, entirely "unchanged". An absent column never erases a value — an import is not a
 * replacement.
 * 3. **Grouped writes, bounded transaction.** A feature film is two thousand shots and ten thousand tasks:
 * everything that is created goes through `createMany`, everything that is modified through `updateMany`
 * grouped by payload (`applyGroupedUpdates`), and the transaction carries an explicit `timeout` (Prisma's 5 s
 * default would make it abort after having written everything and rolled everything back). This grouping is
 * not a race for speed: it shortens the time during which the import holds its locks.
 */

type SessionUser = { id: number; role: Role };

/** Two minutes: the same envelope as project duplication, for the same reason. */
const IMPORT_TX = { timeout: 120_000, maxWait: 15_000 };

/** PostgreSQL caps at 65,535 parameters per query: we write in batches. */
function chunked<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A planned update: the targeted row and what is written to it. */
interface PlannedUpdate<D> {
  id: number;
  data: D;
}

/**
 * Grouping key of a payload. The keys are sorted so that two identical retouches written in a different order
 * (`{name, endFrame}` and `{endFrame, name}`) indeed fall into the same group. The payloads are flat and
 * serialisable — scalar fields, dates, `null` — which the typing of `ShotPatch`/`TaskPatch` guarantees.
 */
const payloadKey = (data: object): string => JSON.stringify(data, Object.keys(data).sort());

/**
 * Applies updates by grouping them by identical payload.
 *
 * The creations were already grouped; the updates remained unitary and sequential **inside** the import
 * transaction. What costs here is not the speed of the import: it is the time during
 * which it holds its row locks and a pool connection, during which any other write on these shots (a
 * published version, a ShotGrid sync) waits. A follow-up re-import massively writes
 * the same value — same status, same department deadline — so a few `updateMany` replace thousands of round
 * trips.
 *
 * Two invariants not to lose:
 *
 * - **The result is the same.** Within a group, the identifiers are distinct: the rows touched are disjoint,
 * so the order between them has no effect. If the same identifier came back,
 *   we close the batch before starting again, which preserves "the last write wins".
 * - **Failure remains a failure.** `update` threw `P2025` when the row had vanished between the plan and the
 * write, and aborted the whole import; `updateMany` would ignore it
 *   silently. We therefore compare the number of rows touched with the number requested.
 */
export async function applyGroupedUpdates<D extends object>(
  updates: PlannedUpdate<D>[],
  write: (ids: number[], data: D) => Promise<{ count: number }>,
  entity: string,
): Promise<void> {
  let groups = new Map<string, { data: D; ids: number[] }>();
  let seen = new Set<number>();

  const flush = async (): Promise<void> => {
    for (const group of groups.values()) {
      for (const ids of chunked(group.ids)) {
        const { count } = await write(ids, group.data);
        if (count !== ids.length) {
          // Concatenation: the entity names a table, not interface text.
          throw conflict(entity + ' changed during import, nothing was written', 'IMPORT_RACE');
        }
      }
    }
    groups = new Map();
    seen = new Set();
  };

  for (const update of updates) {
    if (seen.has(update.id)) await flush();
    const key = payloadKey(update.data);
    const group = groups.get(key);
    if (group) group.ids.push(update.id);
    else groups.set(key, { data: update.data, ids: [update.id] });
    seen.add(update.id);
  }
  await flush();
}

/** The report returned to the caller: the plan, without the write payloads. */
export interface ImportReport {
  committed: boolean;
  counts: ImportCounts;
  columns: { index: number; header: string; field: CsvField | null; manual: boolean }[];
  issues: CsvIssue[];
  rows: RowOutcome[];
  /** Does the file have more rows than the report details? */
  truncated: boolean;
}

/** Bounds of the response: a file of twenty thousand rows does not fit in a screen's JSON. */
const MAX_REPORT_ROWS = 1000;
const MAX_REPORT_ISSUES = 2000;

const isoDay = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const atUtcMidnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Project state needed to compute the plan — one pass of reads, no loop. */
export async function loadContext(projectId: number): Promise<ImportContext> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, startFrame: true, episodesEnabled: true },
  });
  if (!project) throw notFound('Project not found');

  const [episodes, sequences, shots, tasks, shotStatuses, taskStatuses, departments, members] =
    await Promise.all([
      // The trash is read along with the rest: soft delete does not release the uniqueness key, and a row
      // targeting a deleted entity must be refused at preview rather than let the grouped write fail on a
      // P2002.
      prisma.episode.findMany({
        where: { projectId },
        select: { id: true, code: true, deletedAt: true },
      }),
      prisma.sequence.findMany({
        where: { projectId },
        select: { id: true, code: true, episodeId: true, deletedAt: true },
      }),
      prisma.shot.findMany({
        where: { projectId },
        select: {
          id: true,
          code: true,
          deletedAt: true,
          sequenceId: true,
          name: true,
          description: true,
          startFrame: true,
          endFrame: true,
          pipelineStatusId: true,
          order: true,
        },
      }),
      prisma.task.findMany({
        where: { shot: { projectId, deletedAt: null } },
        select: {
          id: true,
          shotId: true,
          name: true,
          department: true,
          departmentId: true,
          pipelineStatusId: true,
          assigneeId: true,
          startDate: true,
          dueDate: true,
        },
      }),
      PipelineStatusService.listForProject(projectId, 'shot'),
      PipelineStatusService.listForProject(projectId, 'task'),
      DepartmentService.listForProject(projectId),
      listAssignableMembers(projectId),
    ]);

  const withTrashFlag = <T extends { deletedAt: Date | null }>({ deletedAt, ...rest }: T) => ({
    ...rest,
    trashed: deletedAt !== null,
  });

  return {
    projectStartFrame: project.startFrame,
    episodesEnabled: project.episodesEnabled,
    episodes: episodes.map(withTrashFlag),
    sequences: sequences.map(withTrashFlag),
    shots: shots.map(withTrashFlag),
    // `shotId` is nullable in the schema (a task may carry an asset); the read filter guarantees the
    // opposite, the guard merely states it to the type checker.
    tasks: tasks.flatMap((t) =>
      t.shotId === null
        ? []
        : [{ ...t, shotId: t.shotId, startDate: isoDay(t.startDate), dueDate: isoDay(t.dueDate) }],
    ),
    shotStatuses: shotStatuses.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    taskStatuses: taskStatuses.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    departments: departments.map((d) => ({ id: d.id, key: d.key, name: d.name })),
    members,
  };
}

/**
 * People a file may designate: the project's members, plus global accounts (admin/supervisor) who need no
 * membership to work. Machine identities and disabled accounts are excluded — assigning work to them means
 * nothing.
 */
async function listAssignableMembers(projectId: number) {
  const users = await prisma.user.findMany({
    where: {
      isService: false,
      disabledAt: null,
      OR: [{ memberships: { some: { projectId } } }, { role: { in: [Role.ADMIN, Role.SUPERVISOR] } }],
    },
    select: { id: true, email: true, name: true, username: true, firstName: true, lastName: true },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    aliases: [u.username, u.name, [u.firstName, u.lastName].filter(Boolean).join(' ')].filter(
      (a): a is string => !!a && a.trim() !== '',
    ),
  }));
}

/** Reduces the plan to what is displayed and downloaded, bounds included. */
function toReport(plan: ImportPlan, columns: ImportReport['columns'], committed: boolean): ImportReport {
  return {
    committed,
    counts: plan.counts,
    columns,
    issues: plan.issues
      .concat(plan.rows.flatMap((r) => r.issues))
      .sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
      .slice(0, MAX_REPORT_ISSUES),
    rows: plan.rows.slice(0, MAX_REPORT_ROWS),
    truncated: plan.rows.length > MAX_REPORT_ROWS,
  };
}

/** Reads the file and computes the plan without writing anything. */
export async function preview(
  projectId: number,
  csv: string,
  overrides: ColumnOverride[] = [],
): Promise<ImportReport> {
  const parse = parseProjectCsv(csv, overrides);
  const ctx = await loadContext(projectId);
  return toReport(buildPlan(parse, ctx), parse.columns, false);
}

/**
 * Applies the file. The plan is recomputed against the current state just before writing: the preview seen on
 * screen commits to nothing, only this recomputation decides.
 */
export async function commit(
  user: SessionUser,
  projectId: number,
  csv: string,
  overrides: ColumnOverride[] = [],
): Promise<ImportReport> {
  await assertProjectWritable(projectId);
  const parse = parseProjectCsv(csv, overrides);
  const ctx = await loadContext(projectId);
  const plan = buildPlan(parse, ctx);

  await prisma.$transaction(async (tx) => {
    const episodeIdByCode = await writeEpisodes(tx, projectId, plan, ctx);
    const sequenceIdByCode = await writeSequences(tx, projectId, plan, ctx, episodeIdByCode);
    const shotIdByKey = await writeShots(tx, projectId, plan, sequenceIdByCode);
    await writeTasks(tx, plan, shotIdByKey);
  }, IMPORT_TX);

  logAudit({
    userId: user.id,
    action: 'PROJECT_IMPORT_CSV',
    entityType: 'Project',
    entityId: projectId,
    metadata: { ...plan.counts },
  });
  return toReport(plan, parse.columns, true);
}

type Tx = Prisma.TransactionClient;

const lower = (v: string) => v.trim().toLowerCase();

async function writeEpisodes(tx: Tx, projectId: number, plan: ImportPlan, ctx: ImportContext) {
  const byCode = new Map(ctx.episodes.map((e) => [lower(e.code), e.id]));
  if (plan.episodesToCreate.length === 0) return byCode;
  let order = ctx.episodes.length;
  for (const batch of chunked(plan.episodesToCreate)) {
    const created = await tx.episode.createManyAndReturn({
      data: batch.map((code) => ({ projectId, code, name: code, order: order++ })),
      select: { id: true, code: true },
    });
    for (const e of created) byCode.set(lower(e.code), e.id);
  }
  return byCode;
}

async function writeSequences(
  tx: Tx,
  projectId: number,
  plan: ImportPlan,
  ctx: ImportContext,
  episodeIdByCode: Map<string, number>,
) {
  const byCode = new Map(ctx.sequences.map((s) => [lower(s.code), s.id]));
  let order = ctx.sequences.length;
  for (const batch of chunked(plan.sequencesToCreate)) {
    const created = await tx.sequence.createManyAndReturn({
      data: batch.map((s) => ({
        projectId,
        code: s.code,
        name: s.code,
        order: order++,
        episodeId: s.episodeCode ? (episodeIdByCode.get(lower(s.episodeCode)) ?? null) : null,
      })),
      select: { id: true, code: true },
    });
    for (const s of created) byCode.set(lower(s.code), s.id);
  }
  // A file generally attaches a whole block of sequences to the same episode: as many identical `update`s,
  // which grouping reduces to one `updateMany` per episode.
  const episodeMoves: PlannedUpdate<{ episodeId: number }>[] = [];
  for (const update of plan.sequenceEpisodeUpdates) {
    const episodeId = update.episodeCode ? (episodeIdByCode.get(lower(update.episodeCode)) ?? null) : null;
    if (episodeId === null) continue;
    episodeMoves.push({ id: update.id, data: { episodeId } });
  }
  await applyGroupedUpdates(
    episodeMoves,
    (ids, data) => tx.sequence.updateMany({ where: { id: { in: ids } }, data }),
    'Sequence',
  );
  return byCode;
}

const shotKey = (ref: ShotRef) => `${lower(ref.sequenceCode ?? '')}::${lower(ref.code)}`;

async function writeShots(
  tx: Tx,
  projectId: number,
  plan: ImportPlan,
  sequenceIdByCode: Map<string, number>,
) {
  const byKey = new Map<string, number>();
  const codeById = new Map([...sequenceIdByCode].map(([code, id]) => [id, code]));
  for (const batch of chunked(plan.shotsToCreate)) {
    const created = await tx.shot.createManyAndReturn({
      data: batch.map((s) => ({
        projectId,
        sequenceId: s.sequenceCode ? (sequenceIdByCode.get(lower(s.sequenceCode)) ?? null) : null,
        code: s.code,
        name: s.name,
        description: s.description,
        startFrame: s.startFrame,
        endFrame: s.endFrame,
        pipelineStatusId: s.pipelineStatusId,
        order: s.order,
      })),
      select: { id: true, code: true, sequenceId: true },
    });
    // Attachment is made by `(sequence, code)` — the business identity of the shot — and never on the return
    // order of the grouped write, which no contract guarantees.
    for (const row of created) {
      const sequenceCode = row.sequenceId === null ? null : (codeById.get(row.sequenceId) ?? null);
      byKey.set(shotKey({ sequenceCode, code: row.code }), row.id);
    }
  }
  await applyGroupedUpdates(
    plan.shotUpdates,
    (ids, data) => tx.shot.updateMany({ where: { id: { in: ids } }, data }),
    'Shot',
  );
  return byKey;
}

async function writeTasks(tx: Tx, plan: ImportPlan, shotIdByKey: Map<string, number>) {
  const rows: Prisma.TaskCreateManyInput[] = [];
  for (const task of plan.tasksToCreate) {
    const shotId = shotIdByKey.get(shotKey(task.shot));
    if (shotId === undefined) continue;
    rows.push({
      shotId,
      name: task.name,
      type: task.type,
      order: task.order,
      department: task.department,
      departmentId: task.departmentId,
      pipelineStatusId: task.pipelineStatusId,
      assigneeId: task.assigneeId,
      startDate: task.startDate ? atUtcMidnight(task.startDate) : null,
      dueDate: task.dueDate ? atUtcMidnight(task.dueDate) : null,
    });
  }
  for (const batch of chunked(rows)) await tx.task.createMany({ data: batch });

  // Dates are converted BEFORE grouping: two tasks due on the same day must fall into the same group, which
  // an ISO string and its midnight-UTC equivalent would compare poorly.
  const taskUpdates = plan.taskUpdates.map(({ id, data }) => {
    const { startDate, dueDate, ...rest } = data;
    return {
      id,
      data: {
        ...rest,
        ...(startDate ? { startDate: atUtcMidnight(startDate) } : {}),
        ...(dueDate ? { dueDate: atUtcMidnight(dueDate) } : {}),
      },
    };
  });
  await applyGroupedUpdates(
    taskUpdates,
    (ids, data) => tx.task.updateMany({ where: { id: { in: ids } }, data }),
    'Task',
  );
}

/**
 * Downloadable template: the full header and two sample rows. It is the shortest answer to "what format do
 * you expect?", and it re-imports as is.
 */
export function template(): string {
  const header = CSV_FIELDS.map((f) => TEMPLATE_HEADERS[f]).join(',');
  const rows = [
    'EP01,SQ010,SH0010,Rooftop wide,Hero lands on the roof,,ip,1001,1096,96,Anim,ANIMATION,ip,artist@studio.tld,2026-09-01,2026-09-15',
    'EP01,SQ010,SH0020,Rooftop close,,,wtg,1001,1048,48,Comp,COMPOSITING,wtg,,,2026-09-20',
  ];
  return [header, ...rows].join('\n');
}

/** Column name written into the template — the one the documentation cites. */
const TEMPLATE_HEADERS: Record<CsvField, string> = {
  episode: 'episode',
  sequence: 'sequence',
  shot: 'shot',
  name: 'name',
  description: 'description',
  tags: 'tags',
  shotStatus: 'shot_status',
  startFrame: 'start_frame',
  endFrame: 'end_frame',
  frames: 'frames',
  task: 'tasks',
  department: 'department',
  taskStatus: 'task_status',
  assignee: 'assignee',
  startDate: 'start_date',
  dueDate: 'due_date',
};
