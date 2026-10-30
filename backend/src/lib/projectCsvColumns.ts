// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recognition of the columns of a pipeline CSV.
 *
 * A studio never exports the same header twice: ShotGrid writes `sg_sequence` and `sg_status_list`, ftrack `Parent`/`Status`,
 * Kitsu `Episode`/`Task type`, a home-made spreadsheet "Plan" and "Échéance". Refusing a file because its header does not match
 * ours means sending the studio off to write a script — exactly the friction we want to remove. We therefore recognise broadly,
 * and what the header does not say, the user corrects by hand (`ColumnOverride`) without touching their file.
 *
 * PURE module: no dependency, fully testable.
 */

/** Fields the import knows how to write. The order is that of the exported template. */
export const CSV_FIELDS = [
  'episode',
  'sequence',
  'shot',
  'name',
  'description',
  'tags',
  'shotStatus',
  'startFrame',
  'endFrame',
  'frames',
  'task',
  'department',
  'taskStatus',
  'assignee',
  'startDate',
  'dueDate',
] as const;

export type CsvField = (typeof CSV_FIELDS)[number];

/** Fields that describe the task carried by the row, not the shot. */
export const TASK_FIELDS: readonly CsvField[] = [
  'task',
  'department',
  'taskStatus',
  'assignee',
  'startDate',
  'dueDate',
];

/**
 * Accepted synonyms, in their normalised form (lowercase, without accent or separator).
 * `sg_status_list` arrives here as `sgstatuslist`, "Échéance" as `echeance`.
 */
const ALIASES: Record<CsvField, readonly string[]> = {
  episode: ['episode', 'ep', 'episodecode', 'epcode', 'sgepisode', 'episodename'],
  sequence: ['sequence', 'seq', 'sq', 'sequencecode', 'seqcode', 'sgsequence', 'scene', 'scenecode'],
  shot: ['shot', 'shotcode', 'plan', 'sgshot', 'code', 'shotnumber', 'plancode'],
  name: ['name', 'nom', 'title', 'titre', 'label', 'shotname', 'longname', 'displayname'],
  description: ['description', 'desc', 'notes', 'note', 'brief', 'synopsis', 'comment', 'sgdescription'],
  tags: ['tags', 'tag', 'keywords', 'labels', 'motscles'],
  shotStatus: ['shotstatus', 'statusshot', 'statutplan', 'sgshotstatus'],
  startFrame: ['startframe', 'framein', 'cutin', 'headin', 'firstframe', 'framestart', 'in', 'sgcutin'],
  endFrame: ['endframe', 'frameout', 'cutout', 'tailout', 'lastframe', 'frameend', 'out', 'sgcutout'],
  frames: ['frames', 'framecount', 'nbframes', 'duration', 'durationframes', 'length', 'cutduration'],
  task: ['task', 'tasks', 'taskname', 'tasknames', 'sgtask', 'activity', 'tache', 'taches'],
  department: [
    'department',
    'dept',
    'discipline',
    'pipelinestep',
    'step',
    'sgstep',
    'taskdepartment',
    'tasktype',
    'departement',
  ],
  taskStatus: ['taskstatus', 'statustask', 'statuttache', 'sgtaskstatus'],
  assignee: [
    'assignee',
    'assignedto',
    'assigned',
    'artist',
    'owner',
    'user',
    'taskassignee',
    'sgassignedto',
    'responsable',
  ],
  startDate: ['startdate', 'begin', 'begindate', 'datedebut', 'taskstart', 'startson', 'debut'],
  dueDate: ['duedate', 'due', 'deadline', 'echeance', 'datefin', 'enddate', 'delivery', 'deliverydate'],
};

/**
 * Status headers that do not say WHAT they are about. A file "one row per task" means the status of the task; a file "one
 * row per shot" that of the shot. We decide on reading the complete header, never at random.
 */
const AMBIGUOUS_STATUS = ['status', 'state', 'statut', 'etat', 'sgstatuslist', 'statuslist'];

const BY_ALIAS = new Map<string, CsvField>();
for (const field of CSV_FIELDS) for (const alias of ALIASES[field]) BY_ALIAS.set(alias, field);

/**
 * Comparison form of a header: without BOM, accent, case or separator.
 * "Cut In", "cut_in" and "CUTIN" designate the same column.
 */
export function normaliseHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Match decided for a column of the file. */
export interface DetectedColumn {
  index: number;
  /** Header as written in the file — it is what is redisplayed. */
  header: string;
  /** Targeted field, or `null` if the column is ignored. */
  field: CsvField | null;
  /** Does the match come from the user rather than from the header? */
  manual: boolean;
}

/** Match imposed by the user for a column, by position. */
export interface ColumnOverride {
  index: number;
  field: CsvField | null;
}

/**
 * Assigns a field to each column.
 *
 * Three passes: exact synonyms, arbitration of ambiguous status headers, then the manual corrections — which take precedence
 * over everything and can also neutralise a column (`field: null`). A given target can only be aimed at once: a second column
 * claiming the same field is ignored rather than silently overwriting the first.
 */
export function detectColumns(headers: string[], overrides: ColumnOverride[] = []): DetectedColumn[] {
  const columns: DetectedColumn[] = headers.map((header, index) => ({
    index,
    header,
    field: BY_ALIAS.get(normaliseHeader(header)) ?? null,
    manual: false,
  }));

  const hasTaskColumn = columns.some((c) => c.field === 'task');
  const taken = new Set(columns.map((c) => c.field).filter((f): f is CsvField => f !== null));
  for (const column of columns) {
    if (column.field !== null || !AMBIGUOUS_STATUS.includes(normaliseHeader(column.header))) continue;
    const preferred: CsvField = hasTaskColumn ? 'taskStatus' : 'shotStatus';
    const fallback: CsvField = hasTaskColumn ? 'shotStatus' : 'taskStatus';
    const chosen = !taken.has(preferred) ? preferred : !taken.has(fallback) ? fallback : null;
    if (chosen) {
      column.field = chosen;
      taken.add(chosen);
    }
  }

  const byIndex = new Map(overrides.map((o) => [o.index, o.field]));
  for (const column of columns) {
    if (!byIndex.has(column.index)) continue;
    column.field = byIndex.get(column.index) ?? null;
    column.manual = true;
  }

  const used = new Set<CsvField>();
  for (const column of columns) {
    if (column.field === null) continue;
    if (used.has(column.field)) column.field = null;
    else used.add(column.field);
  }
  return columns;
}

/** Position of each recognised field, to read a row without rescanning the header. */
export function indexByField(columns: DetectedColumn[]): Partial<Record<CsvField, number>> {
  const out: Partial<Record<CsvField, number>> = {};
  for (const c of columns) if (c.field) out[c.field] = c.index;
  return out;
}
