// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TaskType } from '@prisma/client';
import type { CsvIssue, ParsedEntry, ProjectCsvParse } from '../lib/projectCsvParse';
import { resolveFrameRange } from '../lib/projectCsvParse';
import { inferTaskType } from './PipelineEnsureService';

/**
 * Ce qu'un fichier CSV va réellement faire à un projet, calculé AVANT d'écrire.
 *
 * Le plan est une fonction pure de (fichier lu, état du projet). C'est ce qui rend
 * l'aperçu honnête — l'écran montre le plan, l'écriture applique le même plan — et ce qui
 * rend l'import idempotent : rejouer le fichier reconstruit un plan dont toutes les
 * lignes sont « inchangé ». Aucune requête ici : `ProjectImportService` lit l'état,
 * appelle `buildPlan`, puis applique.
 */

export interface StatusRef {
  id: number;
  code: string;
  name: string;
}
export interface DepartmentRef {
  id: number;
  key: string;
  name: string;
}
export interface MemberRef {
  id: number;
  email: string;
  /** Noms sous lesquels le fichier peut la désigner : pseudo, nom complet, « prénom nom ». */
  aliases: string[];
}
/**
 * Les entités de la corbeille comptent.
 *
 * Le soft-delete ne libère pas la clé : l'index d'unicité `(projet, code)` couvre aussi
 * les lignes supprimées. Les ignorer ferait échouer l'écriture groupée entière sur un
 * P2002 illisible, après qu'un studio a validé un aperçu qui promettait le contraire.
 * On les charge donc, et la ligne concernée est refusée à l'aperçu, motif à l'appui.
 */
export interface ExistingEpisode {
  id: number;
  code: string;
  trashed: boolean;
}
export interface ExistingSequence {
  id: number;
  code: string;
  episodeId: number | null;
  trashed: boolean;
}
export interface ExistingShot {
  id: number;
  code: string;
  trashed: boolean;
  sequenceId: number | null;
  name: string;
  description: string | null;
  startFrame: number | null;
  endFrame: number | null;
  pipelineStatusId: number | null;
  order: number;
}
export interface ExistingTask {
  id: number;
  shotId: number;
  name: string;
  department: string | null;
  departmentId: number | null;
  pipelineStatusId: number | null;
  assigneeId: number | null;
  /** Dates au format ISO `YYYY-MM-DD` — le plan ne manipule jamais d'objet `Date`. */
  startDate: string | null;
  dueDate: string | null;
}

export interface ImportContext {
  projectStartFrame: number;
  episodesEnabled: boolean;
  episodes: ExistingEpisode[];
  sequences: ExistingSequence[];
  shots: ExistingShot[];
  tasks: ExistingTask[];
  shotStatuses: StatusRef[];
  taskStatuses: StatusRef[];
  departments: DepartmentRef[];
  members: MemberRef[];
}

export interface ShotRef {
  sequenceCode: string | null;
  code: string;
}
export interface ShotCreate extends ShotRef {
  name: string;
  description: string | null;
  startFrame: number | null;
  endFrame: number | null;
  pipelineStatusId: number | null;
  order: number;
}
export interface ShotPatch {
  name?: string;
  description?: string;
  startFrame?: number;
  endFrame?: number;
  pipelineStatusId?: number;
}
export interface TaskFields {
  department: string | null;
  departmentId: number | null;
  pipelineStatusId: number | null;
  assigneeId: number | null;
  startDate: string | null;
  dueDate: string | null;
}
export interface TaskCreate extends TaskFields {
  shot: ShotRef;
  name: string;
  type: TaskType;
  order: number;
}
export type TaskPatch = Partial<TaskFields>;

export interface RowOutcome {
  line: number;
  lines: number[];
  episode: string | null;
  sequence: string | null;
  shot: string;
  /** `blocked` : la ligne vise une entité de la corbeille, rien ne sera écrit pour elle. */
  action: 'create' | 'update' | 'unchanged' | 'blocked';
  tasks: { create: number; update: number; unchanged: number };
  issues: CsvIssue[];
}

export interface ImportCounts {
  episodesToCreate: number;
  sequencesToCreate: number;
  shotsToCreate: number;
  shotsToUpdate: number;
  shotsUnchanged: number;
  tasksToCreate: number;
  tasksToUpdate: number;
  tasksUnchanged: number;
  rowsRejected: number;
  warnings: number;
}

export interface ImportPlan {
  counts: ImportCounts;
  episodesToCreate: string[];
  sequencesToCreate: { code: string; episodeCode: string | null }[];
  sequenceEpisodeUpdates: { id: number; episodeCode: string | null }[];
  shotsToCreate: ShotCreate[];
  shotUpdates: { id: number; data: ShotPatch }[];
  tasksToCreate: TaskCreate[];
  taskUpdates: { id: number; data: TaskPatch }[];
  rows: RowOutcome[];
  /** Anomalies de fichier et lignes rejetées, hors anomalies déjà portées par une ligne. */
  issues: CsvIssue[];
}

/** Forme de comparaison des libellés : sans casse, sans accent, sans séparateur. */
const squash = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const lower = (v: string) => v.trim().toLowerCase();

function findStatus(list: StatusRef[], value: string): StatusRef | null {
  const needle = squash(value);
  return list.find((s) => squash(s.code) === needle) ?? list.find((s) => squash(s.name) === needle) ?? null;
}

function findDepartment(list: DepartmentRef[], value: string): DepartmentRef | null {
  const needle = squash(value);
  return list.find((d) => squash(d.key) === needle) ?? list.find((d) => squash(d.name) === needle) ?? null;
}

function findMember(list: MemberRef[], value: string): MemberRef | null {
  const needle = lower(value);
  return (
    list.find((m) => lower(m.email) === needle) ??
    list.find((m) => m.aliases.some((a) => lower(a) === needle)) ??
    null
  );
}

/** Clé d'identité d'un plan : sa séquence (par code) et son code, insensibles à la casse. */
const shotKey = (sequenceCode: string | null, code: string) => `${lower(sequenceCode ?? '')}::${lower(code)}`;

/** Comptes d'un plan vide, à alimenter au fil de la construction. */
function emptyCounts(): ImportCounts {
  return {
    episodesToCreate: 0,
    sequencesToCreate: 0,
    shotsToCreate: 0,
    shotsToUpdate: 0,
    shotsUnchanged: 0,
    tasksToCreate: 0,
    tasksToUpdate: 0,
    tasksUnchanged: 0,
    rowsRejected: 0,
    warnings: 0,
  };
}

export function buildPlan(parse: ProjectCsvParse, ctx: ImportContext): ImportPlan {
  const plan: ImportPlan = {
    counts: emptyCounts(),
    episodesToCreate: [],
    sequencesToCreate: [],
    sequenceEpisodeUpdates: [],
    shotsToCreate: [],
    shotUpdates: [],
    tasksToCreate: [],
    taskUpdates: [],
    rows: [],
    issues: [...parse.issues],
  };
  plan.counts.rowsRejected = parse.issues.filter((i) => i.code === 'MISSING_SHOT').length;

  const episodeColumn = parse.columns.some((c) => c.field === 'episode');
  const tagsColumn = parse.columns.some((c) => c.field === 'tags');
  const useEpisodes = ctx.episodesEnabled && episodeColumn;
  if (episodeColumn && !ctx.episodesEnabled) plan.issues.push({ code: 'EPISODES_DISABLED', line: null });
  // Aucun modèle d'étiquette n'existe côté ReView : la colonne est reconnue pour ne pas
  // passer pour une faute de frappe, et son contenu est explicitement laissé de côté.
  if (tagsColumn && parse.entries.some((e) => e.tags.length > 0))
    plan.issues.push({ code: 'TAGS_UNSUPPORTED', line: null });

  planStructure(parse.entries, ctx, plan, useEpisodes);
  planShotsAndTasks(parse.entries, ctx, plan);

  plan.counts.warnings =
    plan.issues.filter((i) => i.code !== 'MISSING_SHOT').length +
    plan.rows.reduce((n, r) => n + r.issues.length, 0);
  return plan;
}

/** Épisodes et séquences : ce qui manque est créé, ce qui a changé de parent est recollé. */
function planStructure(
  entries: ParsedEntry[],
  ctx: ImportContext,
  plan: ImportPlan,
  useEpisodes: boolean,
): void {
  const knownEpisodes = new Set(ctx.episodes.map((e) => lower(e.code)));
  const trashedEpisodes = new Set(ctx.episodes.filter((e) => e.trashed).map((e) => lower(e.code)));
  if (useEpisodes) {
    for (const entry of entries) {
      if (!entry.episode || knownEpisodes.has(lower(entry.episode))) continue;
      knownEpisodes.add(lower(entry.episode));
      plan.episodesToCreate.push(entry.episode);
    }
    // Un épisode en corbeille garde sa clé : on ne peut pas le recréer. Le niveau étant
    // facultatif, la séquence est simplement laissée hors épisode — pas de ligne perdue.
    for (const code of trashedEpisodes)
      if (entries.some((e) => e.episode && lower(e.episode) === code))
        plan.issues.push({ code: 'IN_TRASH', line: null, value: code });
  }

  const episodeIdByCode = new Map(ctx.episodes.filter((e) => !e.trashed).map((e) => [lower(e.code), e.id]));
  const existingSequences = new Map(ctx.sequences.map((s) => [lower(s.code), s]));
  const created = new Set<string>();
  for (const entry of entries) {
    if (!entry.sequence) continue;
    const key = lower(entry.sequence);
    const episodeCode =
      useEpisodes && !trashedEpisodes.has(lower(entry.episode ?? '')) ? entry.episode : null;
    const existing = existingSequences.get(key);
    if (existing?.trashed) continue; // séquence en corbeille : ses plans seront refusés
    if (!existing) {
      if (created.has(key)) continue;
      created.add(key);
      plan.sequencesToCreate.push({ code: entry.sequence, episodeCode });
      continue;
    }
    // Une séquence déplacée d'un épisode à l'autre est un fait de production courant :
    // on la recolle, mais jamais on ne la détache faute d'information dans le fichier.
    if (!episodeCode) continue;
    const target = episodeIdByCode.get(lower(episodeCode)) ?? null;
    const alreadyPlanned = plan.sequenceEpisodeUpdates.some((u) => u.id === existing.id);
    if (!alreadyPlanned && (target === null || target !== existing.episodeId))
      plan.sequenceEpisodeUpdates.push({ id: existing.id, episodeCode });
  }
  plan.counts.episodesToCreate = plan.episodesToCreate.length;
  plan.counts.sequencesToCreate = plan.sequencesToCreate.length;
}

/** Plans et tâches : création, mise à jour ciblée, ou rien du tout. */
function planShotsAndTasks(entries: ParsedEntry[], ctx: ImportContext, plan: ImportPlan): void {
  const sequenceCodeById = new Map(ctx.sequences.map((s) => [s.id, lower(s.code)]));
  const shotByKey = new Map(
    ctx.shots.map((s) => [
      shotKey(s.sequenceId === null ? null : (sequenceCodeById.get(s.sequenceId) ?? null), s.code),
      s,
    ]),
  );
  const tasksByShot = new Map<number, ExistingTask[]>();
  for (const task of ctx.tasks) {
    const list = tasksByShot.get(task.shotId);
    if (list) list.push(task);
    else tasksByShot.set(task.shotId, [task]);
  }
  const nextOrder = new Map<string, number>();
  for (const shot of ctx.shots) {
    const key = lower(shot.sequenceId === null ? '' : (sequenceCodeById.get(shot.sequenceId) ?? ''));
    nextOrder.set(key, Math.max(nextOrder.get(key) ?? 0, shot.order + 1));
  }

  const trashedSequences = new Set(ctx.sequences.filter((s) => s.trashed).map((s) => lower(s.code)));

  for (const entry of entries) {
    const issues = [...entry.issues];
    const range = resolveFrameRange(entry, ctx.projectStartFrame);
    if (range.issue) issues.push(range.issue);
    const status = resolveStatus(entry, ctx, issues);
    const existing = shotByKey.get(shotKey(entry.sequence, entry.shot)) ?? null;
    const ref: ShotRef = { sequenceCode: entry.sequence, code: entry.shot };

    // La clé d'un plan ou d'une séquence reste prise tant qu'ils sont en corbeille :
    // écrire quand même échouerait sur l'index d'unicité, tout l'import avec.
    if (existing?.trashed || trashedSequences.has(lower(entry.sequence ?? ' '))) {
      issues.push({ code: 'IN_TRASH', line: entry.line, value: entry.shot, shot: entry.shot });
      plan.counts.rowsRejected++;
      plan.rows.push(outcome(entry, 'blocked', { create: 0, update: 0, unchanged: 0 }, issues));
      continue;
    }

    let action: RowOutcome['action'];
    if (!existing) {
      const bucket = lower(entry.sequence ?? '');
      const order = nextOrder.get(bucket) ?? 0;
      nextOrder.set(bucket, order + 1);
      plan.shotsToCreate.push({
        ...ref,
        name: entry.name ?? entry.shot,
        description: entry.description,
        startFrame: range.startFrame,
        endFrame: range.endFrame,
        pipelineStatusId: status,
        order,
      });
      plan.counts.shotsToCreate++;
      action = 'create';
    } else {
      const data = shotPatch(entry, range, status, existing);
      if (Object.keys(data).length > 0) {
        plan.shotUpdates.push({ id: existing.id, data });
        plan.counts.shotsToUpdate++;
        action = 'update';
      } else {
        plan.counts.shotsUnchanged++;
        action = 'unchanged';
      }
    }

    const tasks = planTasks(
      entry,
      ctx,
      plan,
      ref,
      existing ? (tasksByShot.get(existing.id) ?? []) : [],
      issues,
    );
    plan.rows.push(outcome(entry, action, tasks, issues));
  }
}

/** Ligne de rapport d'un plan. */
function outcome(
  entry: ParsedEntry,
  action: RowOutcome['action'],
  tasks: RowOutcome['tasks'],
  issues: CsvIssue[],
): RowOutcome {
  return {
    line: entry.line,
    lines: entry.lines,
    episode: entry.episode,
    sequence: entry.sequence,
    shot: entry.shot,
    action,
    tasks,
    issues,
  };
}

/** Statut de plan demandé par la ligne, s'il figure au vocabulaire du projet. */
function resolveStatus(entry: ParsedEntry, ctx: ImportContext, issues: CsvIssue[]): number | null {
  if (!entry.status) return null;
  const found = findStatus(ctx.shotStatuses, entry.status);
  if (found) return found.id;
  issues.push({ code: 'UNKNOWN_STATUS', line: entry.line, value: entry.status, shot: entry.shot });
  return null;
}

/** Champs du plan que le fichier change réellement — une valeur absente ne vide jamais rien. */
function shotPatch(
  entry: ParsedEntry,
  range: { startFrame: number | null; endFrame: number | null },
  status: number | null,
  existing: ExistingShot,
): ShotPatch {
  const data: ShotPatch = {};
  if (entry.name !== null && entry.name !== existing.name) data.name = entry.name;
  if (entry.description !== null && entry.description !== existing.description)
    data.description = entry.description;
  if (range.startFrame !== null && range.startFrame !== existing.startFrame)
    data.startFrame = range.startFrame;
  if (range.endFrame !== null && range.endFrame !== existing.endFrame) data.endFrame = range.endFrame;
  if (status !== null && status !== existing.pipelineStatusId) data.pipelineStatusId = status;
  return data;
}

/** Tâches de la ligne : création de celles qui manquent, retouche de celles qui bougent. */
function planTasks(
  entry: ParsedEntry,
  ctx: ImportContext,
  plan: ImportPlan,
  ref: ShotRef,
  existingTasks: ExistingTask[],
  issues: CsvIssue[],
): RowOutcome['tasks'] {
  const counts = { create: 0, update: 0, unchanged: 0 };
  let order = existingTasks.length;
  for (const task of entry.tasks) {
    const fields = taskFields(task, entry.shot, ctx, issues);
    const existing = matchTask(existingTasks, task.name, task.department ? fields.departmentId : null);
    if (!existing) {
      plan.tasksToCreate.push({
        shot: ref,
        name: task.name,
        type: inferTaskType(task.name),
        order: order++,
        ...fields,
        // Sans colonne « department », l'étape se devine du nom de la tâche — mais
        // seulement si le projet la connaît déjà : une devinette n'enrichit pas le pipe.
        ...(task.department === null ? inferDepartment(task.name, ctx) : {}),
      });
      counts.create++;
      plan.counts.tasksToCreate++;
      continue;
    }
    const data = taskPatch(task, fields, existing);
    if (Object.keys(data).length > 0) {
      plan.taskUpdates.push({ id: existing.id, data });
      counts.update++;
      plan.counts.tasksToUpdate++;
    } else {
      counts.unchanged++;
      plan.counts.tasksUnchanged++;
    }
  }
  return counts;
}

/**
 * La tâche que la ligne désigne, s'il y en a une.
 *
 * L'identité d'une tâche est `(plan, étape, nom)` — c'est l'index d'unicité du schéma, et
 * c'est aussi la réalité du pipe : `Anim` en animation et `Anim` en compositing sont deux
 * travaux. Chercher sur le seul nom ferait basculer l'étape de la première trouvée, au
 * risque d'entrer en collision avec la seconde. Sans étape déclarée, le nom suffit ; avec
 * une étape déclarée, une tâche homonyme encore sans étape est rattrapée au passage.
 */
function matchTask(tasks: ExistingTask[], name: string, departmentId: number | null): ExistingTask | null {
  const sameName = tasks.filter((t) => lower(t.name) === lower(name));
  if (departmentId === null) return sameName[0] ?? null;
  return (
    sameName.find((t) => t.departmentId === departmentId) ??
    sameName.find((t) => t.departmentId === null) ??
    null
  );
}

/** Valeurs de tâche résolues dans le vocabulaire du projet (étape, statut, personne). */
function taskFields(
  task: ParsedEntry['tasks'][number],
  shot: string,
  ctx: ImportContext,
  issues: CsvIssue[],
): TaskFields {
  const fields: TaskFields = {
    department: null,
    departmentId: null,
    pipelineStatusId: null,
    assigneeId: null,
    startDate: task.startDate,
    dueDate: task.dueDate,
  };
  if (task.department) {
    const found = findDepartment(ctx.departments, task.department);
    if (found) {
      fields.department = found.key;
      fields.departmentId = found.id;
    } else issues.push({ code: 'UNKNOWN_DEPARTMENT', line: task.line, value: task.department, shot });
  }
  if (task.status) {
    const found = findStatus(ctx.taskStatuses, task.status);
    if (found) fields.pipelineStatusId = found.id;
    else issues.push({ code: 'UNKNOWN_STATUS', line: task.line, value: task.status, shot });
  }
  if (task.assignee) {
    const found = findMember(ctx.members, task.assignee);
    if (found) fields.assigneeId = found.id;
    else issues.push({ code: 'UNKNOWN_ASSIGNEE', line: task.line, value: task.assignee, shot });
  }
  return fields;
}

/** Étape devinée du nom d'une tâche, si le projet la déclare déjà. */
function inferDepartment(name: string, ctx: ImportContext): Partial<TaskFields> {
  const guessed = inferTaskType(name);
  if (guessed === TaskType.OTHER) return {};
  const found = findDepartment(ctx.departments, guessed);
  return found ? { department: found.key, departmentId: found.id } : {};
}

/** Ce qui change sur une tâche déjà là — les colonnes absentes du fichier n'effacent rien. */
function taskPatch(
  task: ParsedEntry['tasks'][number],
  fields: TaskFields,
  existing: ExistingTask,
): TaskPatch {
  const data: TaskPatch = {};
  if (task.department && fields.departmentId !== null && fields.departmentId !== existing.departmentId) {
    data.department = fields.department;
    data.departmentId = fields.departmentId;
  }
  if (fields.pipelineStatusId !== null && fields.pipelineStatusId !== existing.pipelineStatusId)
    data.pipelineStatusId = fields.pipelineStatusId;
  if (fields.assigneeId !== null && fields.assigneeId !== existing.assigneeId)
    data.assigneeId = fields.assigneeId;
  if (fields.startDate !== null && fields.startDate !== existing.startDate) data.startDate = fields.startDate;
  if (fields.dueDate !== null && fields.dueDate !== existing.dueDate) data.dueDate = fields.dueDate;
  return data;
}
