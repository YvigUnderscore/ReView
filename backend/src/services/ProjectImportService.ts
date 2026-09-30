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
 * Entrée d'un studio dans ReView par un fichier CSV.
 *
 * Trois garanties, dans cet ordre :
 *
 * 1. **Aperçu avant écriture.** `preview` rend le plan exact — créations, mises à jour,
 *    lignes inchangées, lignes rejetées et leur motif — sans toucher à la base.
 * 2. **Idempotence.** L'identité métier (`(projet, séquence, code)` pour un plan,
 *    `(plan, nom)` pour une tâche) est celle des index d'unicité : rejouer le fichier
 *    reconstruit le même plan, entièrement « inchangé ». Une colonne absente n'efface
 *    jamais une valeur — un import n'est pas un remplacement.
 * 3. **Écritures groupées, transaction bornée.** Un long-métrage, c'est deux mille plans
 *    et dix mille tâches : tout ce qui se crée passe par `createMany`, tout ce qui se
 *    modifie par `updateMany` regroupé par charge utile (`applyGroupedUpdates`), et la
 *    transaction porte un `timeout` explicite (les 5 s par défaut de Prisma la feraient
 *    avorter après avoir tout écrit puis tout annulé). Ce groupement n'est pas une course
 *    à la vitesse : il raccourcit la durée pendant laquelle l'import tient ses verrous.
 */

type SessionUser = { id: number; role: Role };

/** Deux minutes : la même enveloppe que la duplication de projet, pour la même raison. */
const IMPORT_TX = { timeout: 120_000, maxWait: 15_000 };

/** PostgreSQL plafonne à 65 535 paramètres par requête : on écrit par lots. */
function chunked<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Une mise à jour planifiée : la ligne visée et ce qu'on y écrit. */
interface PlannedUpdate<D> {
  id: number;
  data: D;
}

/**
 * Clé de regroupement d'une charge utile. Les clés sont triées pour que deux retouches
 * identiques écrites dans un ordre différent (`{name, endFrame}` et `{endFrame, name}`)
 * tombent bien dans le même groupe. Les charges sont plates et sérialisables — champs
 * scalaires, dates, `null` — ce que le typage de `ShotPatch`/`TaskPatch` garantit.
 */
const payloadKey = (data: object): string => JSON.stringify(data, Object.keys(data).sort());

/**
 * Applique des mises à jour en les groupant par charge utile identique.
 *
 * Les créations étaient déjà groupées ; les mises à jour restaient unitaires et
 * séquentielles **à l'intérieur** de la transaction d'import. Or ce qui coûte ici n'est
 * pas la vitesse de l'import : c'est la durée pendant laquelle il tient ses verrous de
 * ligne et une connexion du pool, pendant laquelle toute autre écriture sur ces plans
 * (une version publiée, une synchronisation ShotGrid) attend. Un réimport de suivi écrit
 * massivement la même valeur — même statut, même échéance de département — donc quelques
 * `updateMany` remplacent des milliers d'allers-retours.
 *
 * Deux invariants à ne pas perdre :
 *
 * - **Le résultat est le même.** Dans un groupe, les identifiants sont distincts : les
 *   lignes touchées sont disjointes, l'ordre entre elles n'a donc aucun effet. Si un même
 *   identifiant revenait, on referme le lot avant de repartir, ce qui conserve « la
 *   dernière écriture l'emporte ».
 * - **L'échec reste un échec.** `update` levait `P2025` quand la ligne avait disparu entre
 *   le plan et l'écriture, et faisait avorter tout l'import ; `updateMany` l'ignorerait en
 *   silence. On compare donc le nombre de lignes touchées au nombre demandé.
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
          // Concaténation : l'entité nomme une table, pas un texte d'interface.
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

/** Le rapport rendu à l'appelant : le plan, sans les charges utiles d'écriture. */
export interface ImportReport {
  committed: boolean;
  counts: ImportCounts;
  columns: { index: number; header: string; field: CsvField | null; manual: boolean }[];
  issues: CsvIssue[];
  rows: RowOutcome[];
  /** Le fichier a-t-il plus de lignes que le rapport n'en détaille ? */
  truncated: boolean;
}

/** Bornes de la réponse : un fichier de vingt mille lignes ne rentre pas dans un JSON d'écran. */
const MAX_REPORT_ROWS = 1000;
const MAX_REPORT_ISSUES = 2000;

const isoDay = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
const atUtcMidnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** État du projet nécessaire au calcul du plan — une passe de lectures, aucune boucle. */
export async function loadContext(projectId: number): Promise<ImportContext> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, startFrame: true, episodesEnabled: true },
  });
  if (!project) throw notFound('Project not found');

  const [episodes, sequences, shots, tasks, shotStatuses, taskStatuses, departments, members] =
    await Promise.all([
      // La corbeille est lue avec le reste : le soft-delete ne libère pas la clé
      // d'unicité, et une ligne qui viserait une entité supprimée doit être refusée à
      // l'aperçu plutôt que de faire tomber l'écriture groupée sur un P2002.
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
    // `shotId` est nullable au schéma (une tâche peut porter un asset) ; le filtre de
    // lecture garantit le contraire, la garde ne fait que le dire au typage.
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
 * Personnes qu'un fichier peut désigner : les membres du projet, plus les comptes
 * globaux (admin/superviseur) qui n'ont pas besoin d'appartenance pour travailler. Les
 * identités machine et les comptes désactivés en sont exclus — leur assigner du travail
 * ne veut rien dire.
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

/** Réduit le plan à ce qui s'affiche et se télécharge, bornes comprises. */
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

/** Lit le fichier et calcule le plan sans rien écrire. */
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
 * Applique le fichier. Le plan est recalculé sur l'état courant juste avant d'écrire :
 * l'aperçu vu à l'écran n'engage rien, seul ce recalcul décide.
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
  // Un fichier rattache en général tout un bloc de séquences au même épisode : autant de
  // `update` identiques, que le regroupement ramène à un `updateMany` par épisode.
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
    // Le rattachement se fait par `(séquence, code)` — l'identité métier du plan — et
    // jamais sur l'ordre de retour de l'écriture groupée, qu'aucun contrat ne garantit.
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

  // Les dates sont converties AVANT le regroupement : deux tâches dues le même jour
  // doivent tomber dans le même groupe, ce que compareraient mal une chaîne ISO et son
  // équivalent minuit UTC.
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
 * Gabarit téléchargeable : l'en-tête complet et deux lignes d'exemple. C'est la réponse
 * la plus courte à « quel format attendez-vous ? », et il se ré-importe tel quel.
 */
export function template(): string {
  const header = CSV_FIELDS.map((f) => TEMPLATE_HEADERS[f]).join(',');
  const rows = [
    'EP01,SQ010,SH0010,Rooftop wide,Hero lands on the roof,,ip,1001,1096,96,Anim,ANIMATION,ip,artist@studio.tld,2026-09-01,2026-09-15',
    'EP01,SQ010,SH0020,Rooftop close,,,wtg,1001,1048,48,Comp,COMPOSITING,wtg,,,2026-09-20',
  ];
  return [header, ...rows].join('\n');
}

/** Nom de colonne écrit dans le gabarit — celui que la documentation cite. */
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
