// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, ProjectStatus, TaskType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logAudit } from './AuditService';
import { softDeleteProject, restoreProject, purgeProject } from '../lib/trash';
import { effectiveThumbnailUrl } from '../lib/thumbnails';
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
 * Logique métier des projets (liste avec miniatures, CRUD, membres, réglages,
 * corbeille, activité). Les routes ne font que valider → appeler → répondre (10.D8).
 */

type SessionUser = { id: number; role: Role };

const isGlobal = (role: Role) => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Sélecteur `OR` des entités (versions/médias) rattachées à un projet donné. */
const versionInProject = (projectId: number) => ({
  OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
});

/**
 * Découpe une liste d'écritures groupées. Un `createMany` passe un paramètre par colonne
 * et par ligne : dix mille tâches dépassent la limite de 65 535 paramètres de PostgreSQL.
 */
function chunked<T>(items: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Une transaction de structure (duplication, import CSV) écrit des milliers de lignes :
 * les 5 s par défaut de Prisma la font échouer en P2028 après avoir tout écrit puis tout
 * annulé. Deux minutes couvrent un long-métrage (2000 plans, 10 000 tâches).
 */
const STRUCTURE_TX = { timeout: 120_000, maxWait: 15_000 };

/** Écriture groupée par lots, en récupérant les lignes créées (id + clé de rattachement). */
async function createManyReturning<TIn, TOut>(
  data: TIn[],
  write: (batch: TIn[]) => Promise<TOut[]>,
): Promise<TOut[]> {
  const out: TOut[] = [];
  for (const batch of chunked(data)) out.push(...(await write(batch)));
  return out;
}

/** Identité d'un plan dans son projet : `(sequenceId, code)` — `code` seul ne suffit pas. */
const shotKey = (sequenceId: number | null, code: string) => `${sequenceId ?? 'none'}::${code}`;

/**
 * Miniature de repli de chaque projet de la page, en UNE requête.
 *
 * La liste appelait `firstMediaThumbKeyForProject` dans un `.map` : cent projets, cent
 * `findFirst` portant chacun un triple OR version → tâche → plan/asset → projet. Or la
 * barre latérale appelle cette route sur presque chaque écran. `DISTINCT ON` élit le
 * premier média publié de chaque projet côté PostgreSQL, sans rapatrier le reste.
 */
async function firstMediaThumbKeysForProjects(projectIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (projectIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ projectId: number; thumbnailKey: string }[]>`
    SELECT DISTINCT ON (COALESCE(sh."projectId", ta."projectId", va."projectId"))
           COALESCE(sh."projectId", ta."projectId", va."projectId") AS "projectId",
           m."thumbnailKey"                                        AS "thumbnailKey"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id  = m."versionId"
    LEFT JOIN "Task" t    ON t.id  = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId"
    LEFT JOIN "Asset" va  ON va.id = v."assetId"
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."thumbnailKey" IS NOT NULL
      AND COALESCE(sh."projectId", ta."projectId", va."projectId") IN (${Prisma.join(projectIds)})
    ORDER BY COALESCE(sh."projectId", ta."projectId", va."projectId"), m."createdAt" ASC
  `;
  for (const row of rows) out.set(row.projectId, row.thumbnailKey);
  return out;
}

/**
 * Liste paginée des projets visibles (globale pour admin/superviseur, membership sinon) +
 * miniatures. Par défaut les projets ARCHIVED (38.B) sont exclus ; `onlyArchived` inverse
 * le filtre pour l'onglet « Archivés ».
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
 * Duplique la structure d'un projet (38.A) : séquences, shots et — si `includeTasks` —
 * les tâches rattachées aux shots (statut réinitialisé à TODO, sans assigné). Copie les
 * réglages projet. NE copie NI médias NI versions NI assets. Sert aussi de « création
 * depuis un template » (un projet marqué `settings.isTemplate`).
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

  // Les réglages sont copiés à l'identique, sauf le marqueur de template (le nouveau
  // projet est un projet concret, pas un modèle).
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
    // Séquences : une seule écriture, `code` (unique par projet) remappe les shots.
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
    // `(sequenceId, code)` identifie un plan dans un projet : on n'a pas à parier sur
    // l'ordre de retour de l'écriture groupée pour rattacher les tâches.
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
 * Import CSV de shots/tâches (38.F). `commit=false` = dry-run (aperçu + erreurs sans écrire).
 * Crée les séquences manquantes, les shots absents (unicité code par séquence) et leurs
 * tâches (type OTHER). Les shots déjà présents sont ignorés (non écrasés).
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
    // Séquences préexistantes utilisées par l'import : une seule requête pour toutes.
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

/** Export CSV des shots/tâches d'un projet (38.G), ré-importable par `importCsv`. */
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
          // username exposé pour l'autocomplete des mentions @user (32.B) ; `isService`
          // pour que l'interface n'offre pas d'assigner du travail à une identité machine.
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              username: true,
              isService: true,
            },
          },
        },
      },
    },
  });
  if (!project) throw notFound('Project not found');
  return project;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  thumbnailKey?: string | null;
  startFrame?: number;
  // Quota de stockage en octets (38.D) — null = illimité.
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

/** Usage/quota de stockage d'un projet (38.D) — octets consommés + quota (null = illimité). */
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
 * Octets consommés par projet, en une agrégation. Le panel appelait
 * `getProjectStorageUsage` par projet, chacune balayant les médias du studio entier
 * derrière son triple OR : cent projets, cent balayages.
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

/** Conso de stockage de tous les projets (38.D, admin) — pour le panel Système. */
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

export async function addMember(projectId: number, userId: number, role?: Role) {
  return prisma.projectMembership.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: { role: role ?? null },
    create: { userId, projectId, role: role ?? null },
  });
}

export async function removeMember(projectId: number, userId: number) {
  await prisma.projectMembership.delete({ where: { userId_projectId: { userId, projectId } } });
}

/* --- Réglages : lecture effective vs lecture d'override (voir lib/projectSettings) --- */

/** JSON d'override brut d'un projet vivant, ou 404. */
async function storedSettings(projectId: number): Promise<Prisma.JsonValue> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { settings: true },
  });
  if (!project) throw notFound('Project not found');
  return project.settings;
}

/** Le projet a-t-il son propre pipe (lignes `Department` à sa portée) ? */
async function hasOwnDepartments(projectId: number): Promise<boolean> {
  return (await prisma.department.count({ where: { projectId, deletedAt: null } })) > 0;
}

/**
 * Sections réellement surchargées. Les départements sont des entités depuis B1 : ce sont
 * les lignes propres au projet qui font foi, pas le JSON qui n'en est que le reflet.
 */
function sectionsOf(override: ProjectSettingsOverride, ownDepartments: boolean): SettingsSection[] {
  const sections = new Set<SettingsSection>(overriddenSections(override));
  if (ownDepartments) sections.add('departments');
  else sections.delete('departments');
  return SETTINGS_SECTIONS.filter((section) => sections.has(section));
}

/**
 * Réglages EFFECTIFS d'un projet (héritage studio appliqué) + la liste des sections qu'il
 * surcharge. C'est cette liste qui permet à l'écran de dire « hérité du studio » plutôt que
 * de laisser croire que tout appartient au projet.
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
 * Lecture d'OVERRIDE : ce que le projet stocke réellement, plus les défauts studio dont il
 * hérite. Réservée à qui peut gérer le projet — c'est la vue d'édition, pas la vue de
 * consultation.
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
 * Rend au projet le pipe du studio : ses départements propres sont retirés logiquement,
 * `DepartmentService.listForProject` retombe alors sur ceux du studio. Écriture directe
 * assumée ici : c'est le pendant de `syncFromSettings`, qui n'a pas d'inverse.
 */
async function inheritDepartments(projectId: number) {
  await prisma.department.updateMany({
    where: { projectId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

/** Les départements sont des entités depuis B1 : la liste éditée est traduite en base. */
async function writeDepartments(projectId: number, departments: { key: string; name: string }[] | null) {
  if (departments === null) await inheritDepartments(projectId);
  else await DepartmentService.syncFromSettings(projectId, departments);
}

/**
 * PUT : remplace l'override ENTIER. Seules les sections présentes dans le corps restent
 * surchargées ; les autres retournent à l'héritage studio. L'ancien code écrivait le corps
 * tel quel — or l'écran envoyait les réglages effectifs, ce qui figeait dans le projet tout
 * ce qu'il ne faisait qu'hériter.
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
 * PATCH : écriture SECTION PAR SECTION. Une section absente du corps reste ce qu'elle
 * était, une section à `null` retourne à l'héritage studio. C'est ce qui permet
 * d'enregistrer la nomenclature d'un projet sans y figer au passage sa résolution.
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

/** Éléments en corbeille d'un projet (séquences, shots, assets, versions, médias). */
export async function getTrash(projectId: number) {
  const mediaWhere = { deletedAt: { not: null }, version: versionInProject(projectId) };
  const [sequences, shots, assets, versions, media] = await Promise.all([
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
  return { sequences, shots, assets, versions, media: media.map((m) => ({ ...m, size: Number(m.size) })) };
}

/** Localisation lisible d'une tâche/version (shot·séquence ou asset). */
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

/** Flux d'activité (dernières versions + médias publiés) + tâches du projet. */
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
      // Sans le statut du référentiel, l'écran retombe sur l'énumération et propose six
      // valeurs figées là où le projet en a quinze : le vocabulaire du site est perdu
      // entre la base et l'affichage.
      pipelineStatusId: t.pipelineStatusId,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      location: loc(t),
    })),
  };
}
