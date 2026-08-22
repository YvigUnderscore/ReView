// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reconnaissance des colonnes d'un CSV de pipeline.
 *
 * Un studio n'exporte jamais deux fois le même en-tête : ShotGrid écrit `sg_sequence` et
 * `sg_status_list`, ftrack `Parent`/`Status`, Kitsu `Episode`/`Task type`, un tableur
 * maison « Plan » et « Échéance ». Refuser un fichier parce que son en-tête ne colle pas
 * au nôtre, c'est renvoyer le studio écrire un script — exactement la friction qu'on veut
 * supprimer. On reconnaît donc largement, et ce que l'en-tête ne dit pas, l'utilisateur
 * le corrige à la main (`ColumnOverride`) sans retoucher son fichier.
 *
 * Module PUR : aucune dépendance, entièrement testable.
 */

/** Champs que l'import sait écrire. L'ordre est celui du gabarit exporté. */
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

/** Champs qui décrivent la tâche portée par la ligne, et non le plan. */
export const TASK_FIELDS: readonly CsvField[] = [
  'task',
  'department',
  'taskStatus',
  'assignee',
  'startDate',
  'dueDate',
];

/**
 * Synonymes acceptés, sous leur forme normalisée (minuscules, sans accent ni séparateur).
 * `sg_status_list` arrive ici en `sgstatuslist`, « Échéance » en `echeance`.
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
 * En-têtes de statut qui ne disent pas de QUOI ils parlent. Un fichier « une ligne par
 * tâche » veut dire le statut de la tâche ; un fichier « une ligne par plan » celui du
 * plan. On tranche à la lecture de l'en-tête complet, jamais au hasard.
 */
const AMBIGUOUS_STATUS = ['status', 'state', 'statut', 'etat', 'sgstatuslist', 'statuslist'];

const BY_ALIAS = new Map<string, CsvField>();
for (const field of CSV_FIELDS) for (const alias of ALIASES[field]) BY_ALIAS.set(alias, field);

/**
 * Forme de comparaison d'un en-tête : sans BOM, sans accent, sans casse, sans séparateur.
 * « Cut In », « cut_in » et « CUTIN » désignent la même colonne.
 */
export function normaliseHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Correspondance décidée pour une colonne du fichier. */
export interface DetectedColumn {
  index: number;
  /** En-tête tel qu'écrit dans le fichier — c'est lui qu'on réaffiche. */
  header: string;
  /** Champ visé, ou `null` si la colonne est ignorée. */
  field: CsvField | null;
  /** La correspondance vient-elle de l'utilisateur plutôt que de l'en-tête ? */
  manual: boolean;
}

/** Correspondance imposée par l'utilisateur pour une colonne, par position. */
export interface ColumnOverride {
  index: number;
  field: CsvField | null;
}

/**
 * Attribue un champ à chaque colonne.
 *
 * Trois passes : synonymes exacts, arbitrage des en-têtes de statut ambigus, puis les
 * corrections manuelles — qui priment sur tout et peuvent aussi neutraliser une colonne
 * (`field: null`). Une même cible ne peut être visée qu'une fois : la seconde colonne
 * qui prétend au même champ est ignorée plutôt que d'écraser la première en silence.
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

/** Position de chaque champ reconnu, pour lire une ligne sans reparcourir l'en-tête. */
export function indexByField(columns: DetectedColumn[]): Partial<Record<CsvField, number>> {
  const out: Partial<Record<CsvField, number>> = {};
  for (const c of columns) if (c.field) out[c.field] = c.index;
  return out;
}
