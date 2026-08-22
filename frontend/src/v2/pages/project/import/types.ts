// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contrat de l'import CSV, tel que le sert `POST /api/projects/:id/import-csv`.
 *
 * Le serveur ne renvoie aucune phrase : chaque anomalie est un code, une ligne, une
 * colonne et une valeur. C'est ici, côté lecteur, qu'elle devient un message — dans sa
 * langue, et dans le rapport qu'il télécharge pour corriger son fichier.
 */

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

export type CsvIssueCode =
  | 'EMPTY_FILE'
  | 'MISSING_SHOT_COLUMN'
  | 'UNKNOWN_COLUMN'
  | 'MISSING_SHOT'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'FRAME_RANGE_MISMATCH'
  | 'CONFLICTING_VALUE'
  | 'TRUNCATED_VALUE'
  | 'DUPLICATE_TASK'
  | 'TOO_MANY_ROWS'
  | 'EPISODES_DISABLED'
  | 'TAGS_UNSUPPORTED'
  | 'IN_TRASH'
  | 'UNKNOWN_STATUS'
  | 'UNKNOWN_DEPARTMENT'
  | 'UNKNOWN_ASSIGNEE';

export interface CsvIssue {
  code: CsvIssueCode;
  line: number | null;
  column?: string;
  value?: string;
  shot?: string;
}

export interface DetectedColumn {
  index: number;
  header: string;
  field: CsvField | null;
  manual: boolean;
}

/** Correspondance imposée par le lecteur pour une colonne — `null` la neutralise. */
export interface ColumnOverride {
  index: number;
  field: CsvField | null;
}

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

export interface ImportReport {
  committed: boolean;
  counts: ImportCounts;
  columns: DetectedColumn[];
  issues: CsvIssue[];
  rows: RowOutcome[];
  truncated: boolean;
}

/** Y a-t-il quelque chose à écrire ? Un fichier rejoué à l'identique ne propose rien. */
export function hasWork(counts: ImportCounts): boolean {
  return (
    counts.episodesToCreate +
      counts.sequencesToCreate +
      counts.shotsToCreate +
      counts.shotsToUpdate +
      counts.tasksToCreate +
      counts.tasksToUpdate >
    0
  );
}
