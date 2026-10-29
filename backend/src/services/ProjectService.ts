// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, ProjectStatus, TaskType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { softDeleteProject, restoreProject, purgeProject } from '../lib/trash';
import { effectiveThumbnailUrl, firstMediaThumbKeysForProjects } from '../lib/thumbnails';
import { avatarUrl } from '../lib/userView';
import { getNumericSetting, SETTING_KEYS } from '../lib/settings';
import {
  getStudioProjectDefaults,
  overriddenSections,
  patchStoredSettings,
  replaceStoredSettings,
  resolveProjectOverride,
  resolveProjectSettingsById,
  SETTINGS_SECTIONS,
  type ProjectSettingsOverride,
  type ProjectSettingsPatch,
  type SettingsSection,
} from '../lib/projectSettings';
import * as DepartmentService from './DepartmentService';
import { slugify } from '../lib/slug';
import { getProjectStorageUsage } from '../lib/projectQuota';
import { assertProjectWritable } from '../lib/projectGuard';
import { parseShotsCsv, toShotsCsv } from '../lib/projectCsv';
import { notFound, badRequest } from '../lib/errors';
import { type PaginationParams, type Paginated, pageArgs, paginate, orderByFrom } from '../lib/pagination';

/**
 * Project business logic (list with thumbnails, CRUD, members, settings, trash, activity). The routes only
 * validate, call and respond (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isGlobal = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** `OR` selector for the entities (versions/media) attached to a given project. */
const versionInProject = (projectId: number) => ({
  OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
});

/**
 * Splits a list of grouped writes. A `createMany` passes one parameter per column and per row: ten thousand
 * tasks exceed PostgreSQL's limit of 65,535 parameters.
 */
function chunked<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A structural transaction (duplication, CSV import) writes thousands of rows: Prisma's default 5 s makes it
 * fail with P2028 after having written everything and then rolled everything back.
 * Two minutes cover a feature film (2,000 shots, 10,000 tasks).
 */
const STRUCTURE_TX = { timeout: 120_000, maxWait: 15_000 };

/** Batched grouped write, retrieving the created rows (id + attachment key). */
async function createManyReturning<TIn, TOut>(
  data: TIn[],
  write: (batch: TIn[]) => Promise<TOut[]>,
): Promise<TOut[]> {
  const out: TOut[] = [];
  for (const batch of chunked(data)) out.push(...(await write(batch)));
  return out;
}

/** Identity of a shot within its project: `(sequenceId, code)` — `code` alone is not enough. */
const shotKey = (sequenceId: number | null, code: string) => `${sequenceId ?? 'none'}::${code}`;

/**
 * Paginated list of visible projects (global for admin/supervisor, membership otherwise) + thumbnails. By
 * default ARCHIVED projects (38.B) are excluded; `onlyArchived` inverts the filter for the "Archived" tab.
 */
export async function listProjects(
  user: SessionUser,
  p: PaginationParams,
  onlyArchived = false,
): Promise<Paginated<unknown>> {
  const statusFilter = onlyArchived
    ? { status: ProjectStatus.ARCHIVED }
    : { status: { not: ProjectStatus.ARCHIVED } };
  const where = isGlobal(user.role)
    ? { deletedAt: null, ...statusFilter }
    : { deletedAt: null, ...statusFilter, memberships: { some: { userId: user.id } } };
  const orderBy = orderByFrom(p, ['updatedAt', 'createdAt', 'name'], { updatedAt: 'desc' });
  const [projects, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy, ...pageArgs(p) }),
    prisma.project.count({ where }),
  ]);
  const fallbacks = await firstMediaThumbKeysForProjects(projects.map((proj) => proj.id));
  const items = await Promise.all(
    projects.map(async (proj) => ({
      ...proj,
      thumbnailUrl: await effectiveThumbnailUrl(proj.thumbnailKey, fallbacks.get(proj.id) ?? null),
    })),
  );
  return paginate(items, total, p);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  startFrame?: number;
}

export async function createProject(user: SessionUser, input: CreateProjectInput) {
  const studio = await prisma.studio.findFirst();
  if (!studio) throw notFound('Studio not set up');

  const slug = slugify(input.name);
  if (!slug) throw badRequest('Invalid project name');
  if (await prisma.project.findUnique({ where: { studioId_slug: { studioId: studio.id, slug } } }))
    throw badRequest('A project with this name already exists', 'SLUG_TAKEN');

  const defaultStartFrame = await getNumericSetting(SETTING_KEYS.DEFAULT_START_FRAME);
  const project = await prisma.project.create({
    data: {
      studioId: studio.id,
      name: input.name,
      slug,
      description: input.description ?? null,
      startFrame: input.startFrame ?? defaultStartFrame,
      memberships: { create: { userId: user.id } },
    },
  });
  logAudit({
    userId: user.id,
    action: 'PROJECT_CREATE',
    entityType: 'Project',
    entityId: project.id,
    metadata: { name: input.name },
  });
  return project;
}

/**
 * Duplicates a project's structure (38.A): sequences, shots and — if `includeTasks` — the tasks attached to
 * the shots (status reset to TODO, no assignee). Copies the project settings. Copies NEITHER media NOR
 * versions NOR assets. Also serves as "creation from a template" (a project marked `settings.isTemplate`).
 */
export async function duplicateProject(
  user: SessionUser,
  sourceId: number,
  name: string,
  includeTasks: boolean,
) {
  const source = await prisma.project.findFirst({
    where: { id: sourceId, deletedAt: null },
    include: {
      sequences: { where: { deletedAt: null } },
      shots: {
        where: { deletedAt: null },
        include: includeTasks ? { tasks: true } : undefined,
      },
    },
  });
  if (!source) throw notFound('Source project not found');

  const slug = slugify(name);
  if (!slug) throw badRequest('Invalid project name');
  if (await prisma.project.findUnique({ where: { studioId_slug: { studioId: source.studioId, slug } } }))
    throw badRequest('A project with this name already exists', 'SLUG_TAKEN');

  // The settings are copied as is, except the template marker (the new project is a concrete project, not a
  // model).
  const settings = { ...(source.settings as Record<string, unknown>) };
  delete settings.isTemplate;

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        studioId: source.studioId,
        name,
        slug,
        description: source.description,
        startFrame: source.startFrame,
        settings: settings as Prisma.InputJsonValue,
        memberships: { create: { userId: user.id } },
      },
    });
    // Sequences: a single write; `code` (unique per project) remaps the shots.
    const newSeqs = await createManyReturning(
      source.sequences.map((seq) => ({
        projectId: project.id,
        name: seq.name,
        code: seq.code,
        order: seq.order,
        settings: seq.settings as Prisma.InputJsonValue,
      })),
      (data) => tx.sequence.createManyAndReturn({ data, select: { id: true, code: true } }),
    );
    const seqIdByCode = new Map(newSeqs.map((s) => [s.code, s.id]));
    const srcSeqById = new Map(source.sequences.map((s) => [s.id, s.code]));
    const seqIdOf = (sequenceId: number | null) =>
      sequenceId != null ? (seqIdByCode.get(srcSeqById.get(sequenceId) ?? '') ?? null) : null;

    const newShots = await createManyReturning(
      source.shots.map((shot) => ({
        projectId: project.id,
        sequenceId: seqIdOf(shot.sequenceId),
        name: shot.name,
        code: shot.code,
        startFrame: shot.startFrame,
        endFrame: shot.endFrame,
        order: shot.order,
        settings: shot.settings as Prisma.InputJsonValue,
      })),
      (data) => tx.shot.createManyAndReturn({ data, select: { id: true, code: true, sequenceId: true } }),
    );
    // `(sequenceId, code)` identifies a shot within a project: we cannot bet on the return order of the
    // grouped write to attach the tasks.
    const shotIdByKey = new Map(newShots.map((s) => [shotKey(s.sequenceId, s.code), s.id]));

    if (includeTasks) {
      const tasks: Prisma.TaskCreateManyInput[] = [];
      for (const shot of source.shots) {
        const shotId = shotIdByKey.get(shotKey(seqIdOf(shot.sequenceId), shot.code));
        const sourceTasks = (
          shot as { tasks?: { name: string; type: TaskType; order: number; checklist: unknown }[] }
        ).tasks;
        if (shotId === undefined || !sourceTasks) continue;
        for (const t of sourceTasks) {
          tasks.push({
            shotId,
            name: t.name,
            type: t.type,
            order: t.order,
            checklist: t.checklist as Prisma.InputJsonValue,
          });
        }
      }
      for (const batch of chunked(tasks)) await tx.task.createMany({ data: batch });
    }
    return project;
  }, STRUCTURE_TX);

  logAudit({
    userId: user.id,
    action: 'PROJECT_DUPLICATE',
    entityType: 'Project',
    entityId: created.id,
    metadata: { sourceId, includeTasks },
  });
  return created;
}

/**
 * CSV import of shots/tasks (38.F). `commit=false` = dry-run (preview + errors without writing).
 * Creates the missing sequences, the absent shots (code unique per sequence) and their tasks (type OTHER).
 * Shots already present are ignored (not overwritten).
 */
export async function importCsv(user: SessionUser, projectId: number, csv: string, commit: boolean) {
  const { rows, errors } = parseShotsCsv(csv);
  const [existingSeqs, existingShots] = await Promise.all([
    prisma.sequence.findMany({ where: { projectId, deletedAt: null }, select: { code: true } }),
    prisma.shot.findMany({ where: { projectId, deletedAt: null }, select: { code: true, sequenceId: true } }),
  ]);
  const seqCodes = new Set(existingSeqs.map((s) => s.code));
  const shotCodes = new Set(existingShots.map((s) => s.code));
  const newSeqCodes = [
    ...new Set(rows.map((r) => r.sequence).filter((c): c is string => !!c && !seqCodes.has(c))),
  ];
  const newRows = rows.filter((r) => !shotCodes.has(r.shot));
  const preview = {
    sequencesToCreate: newSeqCodes.length,
    shotsToCreate: newRows.length,
    tasksToCreate: newRows.reduce((n, r) => n + r.tasks.length, 0),
    shotsSkipped: rows.length - newRows.length,
    errors,
  };
  if (!commit) return { committed: false, ...preview };

  await assertProjectWritable(projectId); // 38.B
  await prisma.$transaction(async (tx) => {
    const newSeqs = await createManyReturning(
      newSeqCodes.map((code) => ({ projectId, name: code, code })),
      (data) => tx.sequence.createManyAndReturn({ data, select: { id: true, code: true } }),
    );
    const seqIdByCode = new Map(newSeqs.map((s) => [s.code, s.id]));
    // Pre-existing sequences used by the import: a single query for all of them.
    const reusedCodes = [
      ...new Set(rows.map((r) => r.sequence).filter((c): c is string => !!c && !seqIdByCode.has(c))),
    ];
    if (reusedCodes.length > 0) {
      const existing = await tx.sequence.findMany({
        where: { projectId, code: { in: reusedCodes } },
        select: { id: true, code: true },
      });
      for (const s of existing) if (!seqIdByCode.has(s.code)) seqIdByCode.set(s.code, s.id);
    }

    const createdShots = await createManyReturning(
      newRows.map((r) => ({
        projectId,
        sequenceId: r.sequence ? (seqIdByCode.get(r.sequence) ?? null) : null,
        name: r.name,
        code: r.shot,
      })),
      (data) => tx.shot.createManyAndReturn({ data, select: { id: true, code: true, sequenceId: true } }),
    );
    const shotIdByKey = new Map(createdShots.map((s) => [shotKey(s.sequenceId, s.code), s.id]));

    const tasks: Prisma.TaskCreateManyInput[] = [];
    for (const r of newRows) {
      const sequenceId = r.sequence ? (seqIdByCode.get(r.sequence) ?? null) : null;
      const shotId = shotIdByKey.get(shotKey(sequenceId, r.shot));
      if (shotId === undefined) continue;
      for (const t of r.tasks) tasks.push({ shotId, name: t, type: TaskType.OTHER });
    }
    for (const batch of chunked(tasks)) await tx.task.createMany({ data: batch });
  }, STRUCTURE_TX);
  logAudit({
    userId: user.id,
    action: 'PROJECT_IMPORT_CSV',
    entityType: 'Project',
    entityId: projectId,
    metadata: preview,
  });
  return { committed: true, ...preview };
}

/** CSV export of a project's shots/tasks (38.G), re-importable by `importCsv`. */
export async function exportCsv(projectId: number): Promise<string> {
  const shots = await prisma.shot.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sequenceId: 'asc' }, { order: 'asc' }],
    select: {
      code: true,
      name: true,
      sequence: { select: { code: true } },
      tasks: { select: { name: true }, orderBy: { order: 'asc' } },
    },
  });
  return toShotsCsv(
    shots.map((s) => ({
      sequence: s.sequence?.code ?? null,
      shot: s.code,
      name: s.name,
      tasks: s.tasks.map((t) => t.name),
    })),
  );
}

export async function getProject(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      memberships: {
        include: {
          // username exposed for the autocomplete of @user mentions (32.B); `isService` so that the interface
          // does not offer to assign work to a machine identity.
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              username: true,
              isService: true,
              // Profile photo: assignment screens show faces, not lines of text — among twenty similar names,
              // it is the only way to recognise someone at a glance.
              firstName: true,
              lastName: true,
              avatarKey: true,
              // The person's departments, bounded to THIS project's vocabulary (batch 10): the full list
              // would mix steps from other projects, which this screen can neither
              // display nor remove. One instance = one studio, so `projectId: null` unambiguously designates
              // the inherited reference.
              departments: {
                where: { deletedAt: null, OR: [{ projectId }, { projectId: null }] },
                select: { id: true, key: true, name: true, color: true },
                orderBy: [{ order: 'asc' }, { key: 'asc' }],
              },
            },
          },
        },
      },
    },
  });
  if (!project) throw notFound('Project not found');
  // Photos are signed here, once per person: the project sheet is the source of the assignment lists, and
  // each would otherwise have signed the same avatars on its own.
  const memberships = await Promise.all(
    project.memberships.map(async ({ user, ...m }) => {
      const { avatarKey, ...rest } = user;
      return { ...m, user: { ...rest, avatarUrl: await avatarUrl(avatarKey) } };
    }),
  );
  return { ...project, memberships };
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  thumbnailKey?: string | null;
  startFrame?: number;
  // Storage quota in bytes (38.D) — null = unlimited.
  storageQuota?: number | null;
}

export async function updateProject(projectId: number, data: UpdateProjectInput) {
  if (!(await prisma.project.findFirst({ where: { id: projectId, deletedAt: null } })))
    throw notFound('Project not found');
  const { storageQuota, ...rest } = data;
  return prisma.project.update({
    where: { id: projectId },
    data: {
      ...rest,
      ...(storageQuota !== undefined
        ? { storageQuota: storageQuota === null ? null : BigInt(storageQuota) }
        : {}),
    },
  });
}

/** Storage usage/quota of a project (38.D) — bytes consumed + quota (null = unlimited). */
export async function getProjectUsage(projectId: number) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { storageQuota: true },
  });
  if (!project) throw notFound('Project not found');
  const usage = await getProjectStorageUsage(projectId);
  return { usage: Number(usage), quota: project.storageQuota != null ? Number(project.storageQuota) : null };
}

/**
 * Bytes consumed per project, in a single aggregation. The panel used to call
 * `getProjectStorageUsage` per project, each sweeping the media of the whole studio behind its triple OR: a
 * hundred projects, a hundred sweeps.
 */
async function storageUsageByProject(): Promise<Map<number, bigint>> {
  const rows = await prisma.$queryRaw<{ projectId: number | null; bytes: bigint | null }[]>`
    SELECT COALESCE(sh."projectId", ta."projectId", va."projectId") AS "projectId",
           COALESCE(SUM(m.size), 0)::bigint                         AS "bytes"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id  = m."versionId"
    LEFT JOIN "Task" t    ON t.id  = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId"
    LEFT JOIN "Asset" va  ON va.id = v."assetId"
    WHERE m."deletedAt" IS NULL
    GROUP BY 1
  `;
  const out = new Map<number, bigint>();
  for (const row of rows) if (row.projectId != null) out.set(row.projectId, BigInt(row.bytes ?? 0));
  return out;
}

/** Storage consumption of all projects (38.D, admin) — for the System panel. */
export async function listUsage() {
  const [projects, usage] = await Promise.all([
    prisma.project.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, slug: true, storageQuota: true },
      orderBy: { name: 'asc' },
    }),
    storageUsageByProject(),
  ]);
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    usage: Number(usage.get(p.id) ?? 0n),
    quota: p.storageQuota != null ? Number(p.storageQuota) : null,
  }));
}

export async function softDelete(user: SessionUser, projectId: number) {
  await softDeleteProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_DELETE', entityType: 'Project', entityId: projectId });
}

export async function restore(user: SessionUser, projectId: number) {
  await restoreProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_RESTORE', entityType: 'Project', entityId: projectId });
}

export async function purge(user: SessionUser, projectId: number) {
  await purgeProject(projectId);
  logAudit({ userId: user.id, action: 'PROJECT_PURGE', entityType: 'Project', entityId: projectId });
}

/**
 * Adds a member — or changes their local role, which the same `upsert` covers.
 *
 * A5-03: this is the escalation gesture of finding A1-03 (a local supervisor demotes an ARTIST to CLIENT on
 * an account they control), and it left no trace. We therefore read the state BEFORE the write: it is the
 * only way to distinguish an arrival from a role change, and to say from which role — the detail that makes
 * the trace useful.
 *
 * The actor is optional because the ShotGrid sync calls without a human session (`ShotgridCrewService`); the
 * entry is written in every case, without an author if needed — an anonymous
 * trace is worth more than none.
 */
export async function addMember(projectId: number, userId: number, role?: Role, actor?: SessionUser | null) {
  const before = await prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { role: true },
  });
  const membership = await prisma.projectMembership.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: { role: role ?? null },
    create: { userId, projectId, role: role ?? null },
  });
  logAudit({
    userId: actor?.id ?? null,
    action: before ? 'PROJECT_MEMBER_UPDATE' : 'PROJECT_MEMBER_ADD',
    entityType: 'Project',
    entityId: projectId,
    metadata: { targetUserId: userId, role: role ?? null, previousRole: before?.role ?? null },
  });
  return membership;
}

/** Access removal: logged for the same reasons as the grant (A5-03). */
export async function removeMember(projectId: number, userId: number, actor?: SessionUser | null) {
  const membership = await prisma.projectMembership.delete({
    where: { userId_projectId: { userId, projectId } },
  });
  logAudit({
    userId: actor?.id ?? null,
    action: 'PROJECT_MEMBER_REMOVE',
    entityType: 'Project',
    entityId: projectId,
    metadata: { targetUserId: userId, role: membership.role ?? null },
  });
}

/* --- Settings: effective reading vs override reading (see lib/projectSettings) --- */

/** Raw override JSON of a live project, or 404. */
async function storedSettings(projectId: number): Promise<Prisma.JsonValue> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { settings: true },
  });
  if (!project) throw notFound('Project not found');
  return project.settings;
}

/** Does the project have its own pipe (`Department` rows at its scope)? */
async function hasOwnDepartments(projectId: number): Promise<boolean> {
  return (await prisma.department.count({ where: { projectId, deletedAt: null } })) > 0;
}

/**
 * Sections actually overridden. Departments have been entities since B1: it is the rows specific to the
 * project that count, not the JSON which is only their reflection.
 */
function sectionsOf(override: ProjectSettingsOverride, ownDepartments: boolean): SettingsSection[] {
  const sections = new Set<SettingsSection>(overriddenSections(override));
  if (ownDepartments) sections.add('departments');
  else sections.delete('departments');
  return SETTINGS_SECTIONS.filter((section) => sections.has(section));
}

/**
 * EFFECTIVE settings of a project (studio inheritance applied) + the list of sections it overrides. It is
 * this list that lets the screen say "inherited from the studio" rather than
 * letting it appear that everything belongs to the project.
 */
export async function getSettings(projectId: number) {
  const stored = await storedSettings(projectId);
  const [settings, override, own] = await Promise.all([
    resolveProjectSettingsById(projectId),
    resolveProjectOverride(stored),
    hasOwnDepartments(projectId),
  ]);
  return { settings, overrides: sectionsOf(override, own) };
}

/**
 * OVERRIDE reading: what the project actually stores, plus the studio defaults it inherits. Reserved to
 * whoever can manage the project — this is the edit view, not the browse view.
 */
export async function getSettingsOverride(projectId: number) {
  const stored = await storedSettings(projectId);
  const [override, studio, own] = await Promise.all([
    resolveProjectOverride(stored),
    getStudioProjectDefaults(),
    hasOwnDepartments(projectId),
  ]);
  return { override, studio, overrides: sectionsOf(override, own) };
}

/**
 * Gives the project back the studio's pipe: its own departments are removed logically, and
 * `DepartmentService.listForProject` then falls back on the studio's. The direct write is
 * deliberate here: it is the counterpart of `syncFromSettings`, which has no inverse.
 */
async function inheritDepartments(projectId: number) {
  await prisma.department.updateMany({
    where: { projectId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/** Departments have been entities since B1: the edited list is translated into the database. */
async function writeDepartments(projectId: number, departments: { key: string; name: string }[] | null) {
  if (departments === null) await inheritDepartments(projectId);
  else await DepartmentService.syncFromSettings(projectId, departments);
}

/**
 * PUT: replaces the WHOLE override. Only the sections present in the body remain overridden; the others
 * return to the studio inheritance. The old code wrote the body as is — yet the
 * screen sent the effective settings, which froze into the project everything it merely inherited.
 */
export async function updateSettings(user: SessionUser, projectId: number, body: object) {
  const stored = await storedSettings(projectId);
  const studio = await getStudioProjectDefaults();
  const next = replaceStoredSettings(stored, body, studio);
  await prisma.project.update({
    where: { id: projectId },
    data: { settings: next as Prisma.InputJsonValue },
  });
  const departments = (body as { departments?: { key: string; name: string }[] }).departments;
  if (Array.isArray(departments)) await writeDepartments(projectId, departments);
  logAudit({
    userId: user.id,
    action: 'PROJECT_SETTINGS_UPDATE',
    entityType: 'Project',
    entityId: projectId,
    metadata: { sections: SETTINGS_SECTIONS.filter((section) => section in next) },
  });
  return getSettings(projectId);
}

/**
 * PATCH: SECTION-BY-SECTION write. A section absent from the body remains what it was; a section set to
 * `null` returns to the studio inheritance. This is what makes it possible to save
 * a project's nomenclature without freezing its resolution along the way.
 */
export async function patchSettings(user: SessionUser, projectId: number, patch: ProjectSettingsPatch) {
  const stored = await storedSettings(projectId);
  const studio = await getStudioProjectDefaults();
  const next = patchStoredSettings(stored, patch, studio);
  await prisma.project.update({
    where: { id: projectId },
    data: { settings: next as Prisma.InputJsonValue },
  });
  if ('departments' in patch) await writeDepartments(projectId, patch.departments ?? null);
  logAudit({
    userId: user.id,
    action: 'PROJECT_SETTINGS_UPDATE',
    entityType: 'Project',
    entityId: projectId,
    metadata: { sections: Object.keys(patch) },
  });
  return getSettings(projectId);
}

/**
 * A project's trashed items (episodes, sequences, shots, assets, versions, media).
 *
 * Episodes only appear there if the project has trashed some: a feature film, which never enabled the level,
 * does not see the section.
 */
export async function getTrash(projectId: number) {
  const mediaWhere = { deletedAt: { not: null }, version: versionInProject(projectId) };
  // Episode level switched off: the section does not exist, even if episodes lie dormant in the trash —
  // switching it off destroys nothing, and must not display anything either.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { episodesEnabled: true },
  });
  const [episodes, sequences, shots, assets, versions, media] = await Promise.all([
    project?.episodesEnabled
      ? prisma.episode.findMany({
          where: { projectId, deletedAt: { not: null } },
          orderBy: { deletedAt: 'desc' },
        })
      : [],
    prisma.sequence.findMany({
      where: { projectId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.shot.findMany({ where: { projectId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    prisma.asset.findMany({ where: { projectId, deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    prisma.version.findMany({
      where: { deletedAt: { not: null }, ...versionInProject(projectId) },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.mediaObject.findMany({ where: mediaWhere, orderBy: { deletedAt: 'desc' } }),
  ]);
  return {
    episodes,
    sequences,
    shots,
    assets,
    versions,
    media: media.map((m) => ({ ...m, size: Number(m.size) })),
  };
}

/** Readable location of a task/version (shot·sequence or asset). */
function loc(
  t: {
    shot?: { code: string; sequence?: { code: string } | null } | null;
    asset?: { name: string } | null;
  } | null,
): string {
  if (!t) return '';
  if (t.shot) return `${t.shot.sequence ? t.shot.sequence.code + ' · ' : ''}${t.shot.code}`;
  if (t.asset) return t.asset.name;
  return '';
}

/** Activity feed (latest versions + published media) + the project's tasks. */
export async function getActivity(projectId: number) {
  const inProject = versionInProject(projectId);
  const [versions, media, tasks] = await Promise.all([
    prisma.version.findMany({
      where: { deletedAt: null, ...inProject },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        author: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            name: true,
            shot: { select: { code: true, sequence: { select: { code: true } } } },
            asset: { select: { name: true } },
          },
        },
        asset: { select: { name: true } },
      },
    }),
    prisma.mediaObject.findMany({
      where: { deletedAt: null, published: true, version: inProject },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        uploader: { select: { id: true, name: true } },
        version: {
          select: {
            name: true,
            task: {
              select: {
                id: true,
                name: true,
                shot: { select: { code: true, sequence: { select: { code: true } } } },
                asset: { select: { name: true } },
              },
            },
            asset: { select: { name: true } },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: { OR: [{ shot: { projectId } }, { asset: { projectId } }] },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        assignee: { select: { id: true, name: true } },
        shot: { select: { id: true, code: true, sequence: { select: { code: true } } } },
        asset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const recent = [
    ...versions.map((v) => ({
      type: 'version' as const,
      id: v.id,
      at: v.createdAt,
      label: `${v.name}${v.task ? ' — ' + v.task.name : ''}`,
      location: loc(v.task),
      versionId: v.id,
      taskId: v.task?.id ?? null,
      author: v.author?.name ?? null,
    })),
    ...media.map((m) => ({
      type: 'media' as const,
      id: m.id,
      at: m.createdAt,
      label: m.originalName,
      kind: m.kind,
      location: loc(m.version?.task ?? null) || (m.version?.asset?.name ?? ''),
      mediaId: m.id,
      taskId: m.version?.task?.id ?? null,
      author: m.uploader?.name ?? null,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 20);

  return {
    recent,
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: t.status,
      // Without the repository's status, the screen falls back on the enumeration and offers six frozen
      // values where the project has fifteen: the site's vocabulary is lost
      // between the database and the display.
      pipelineStatusId: t.pipelineStatusId,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      location: loc(t),
    })),
  };
}
