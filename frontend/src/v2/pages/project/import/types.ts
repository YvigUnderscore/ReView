// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contract of the CSV import, as served by `POST /api/projects/:id/import-csv`.
 *
 * The server returns no sentence: each anomaly is a code, a row, a column and a value. It is here,
 * on the reader's side, that it becomes a message: in their language, and in the report they
 * download to correct their file.
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

/** Mapping imposed by the reader for a column: `null` neutralizes it. */
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
  /** `blocked`: the row targets an entity in the trash, so nothing will be written for it. */
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

/** Is there anything to write? A file replayed identically proposes nothing. */
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
