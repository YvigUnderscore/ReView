// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Tr } from '../../../i18n';
import type { CsvField, CsvIssue, ImportReport } from './types';

/**
 * Wording the import report.
 *
 * A studio corrects its file and replays it, so the report must leave the browser as a table: one
 * row per anomaly, with the row number of the original file. The functions are pure (they receive
 * the translator) so that they can be tested, and so as not to freeze the language when the module
 * loads.
 */

/** Label of a recognized field. The production vocabulary stays in English. */
export function fieldLabel(t: Tr, field: CsvField): string {
  switch (field) {
    case 'episode':
      return t('csvImport.field.episode');
    case 'sequence':
      return t('common.sequence');
    case 'shot':
      return t('csvImport.field.shot');
    case 'name':
      return t('common.name');
    case 'description':
      return t('common.description');
    case 'tags':
      return t('csvImport.field.tags');
    case 'shotStatus':
      return t('csvImport.field.shotStatus');
    case 'startFrame':
      return t('shot.startFrame');
    case 'endFrame':
      return t('shot.endFrame');
    case 'frames':
      return t('csvImport.field.frames');
    case 'task':
      return t('csvImport.field.task');
    case 'department':
      return t('common.department');
    case 'taskStatus':
      return t('csvImport.field.taskStatus');
    case 'assignee':
      return t('csvImport.field.assignee');
    case 'startDate':
      return t('csvImport.field.startDate');
    case 'dueDate':
      return t('csvImport.field.dueDate');
  }
}

/** Reason for an anomaly, with the faulty column and value when they exist. */
export function issueLabel(t: Tr, issue: CsvIssue): string {
  const column = issue.column ?? '';
  const value = issue.value ?? '';
  switch (issue.code) {
    case 'EMPTY_FILE':
      return t('csvImport.issue.emptyFile');
    case 'MISSING_SHOT_COLUMN':
      return t('csvImport.issue.missingShotColumn');
    case 'UNKNOWN_COLUMN':
      return t('csvImport.issue.unknownColumn', { column });
    case 'MISSING_SHOT':
      return t('csvImport.issue.missingShot');
    case 'INVALID_NUMBER':
      return t('csvImport.issue.invalidNumber', { column, value });
    case 'INVALID_DATE':
      return t('csvImport.issue.invalidDate', { column, value });
    case 'FRAME_RANGE_MISMATCH':
      return t('csvImport.issue.frameRangeMismatch', { value });
    case 'CONFLICTING_VALUE':
      return t('csvImport.issue.conflictingValue', { column, value });
    case 'TRUNCATED_VALUE':
      return t('csvImport.issue.truncatedValue', { column });
    case 'DUPLICATE_TASK':
      return t('csvImport.issue.duplicateTask', { value });
    case 'TOO_MANY_ROWS':
      return t('csvImport.issue.tooManyRows', { value });
    case 'EPISODES_DISABLED':
      return t('csvImport.issue.episodesDisabled');
    case 'TAGS_UNSUPPORTED':
      return t('csvImport.issue.tagsUnsupported');
    case 'UNKNOWN_STATUS':
      return t('csvImport.issue.unknownStatus', { value });
    case 'UNKNOWN_DEPARTMENT':
      return t('csvImport.issue.unknownDepartment', { value });
    case 'UNKNOWN_ASSIGNEE':
      return t('csvImport.issue.unknownAssignee', { value });
    case 'IN_TRASH':
      return t('csvImport.issue.inTrash', { value });
  }
}

/** Does an anomaly prevent the row from existing, or is it only a warning? */
export function isBlocking(code: CsvIssue['code']): boolean {
  return (
    code === 'EMPTY_FILE' || code === 'MISSING_SHOT_COLUMN' || code === 'MISSING_SHOT' || code === 'IN_TRASH'
  );
}

/**
 * Escaped CSV field, with the same formula guard as on the server side: a spreadsheet must not
 * execute the content of an error report.
 */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as a table: file row, shot, severity, reason. */
export function toReportCsv(t: Tr, report: ImportReport): string {
  const header = [
    t('common.line'),
    t('csvImport.field.shot'),
    t('csvImport.report.severity'),
    t('csvImport.report.reason'),
  ];
  const lines = [header.map(csvField).join(',')];
  for (const issue of report.issues) {
    lines.push(
      [
        issue.line === null ? '' : String(issue.line),
        issue.shot ?? '',
        isBlocking(issue.code) ? t('csvImport.report.rejected') : t('csvImport.report.warning'),
        issueLabel(t, issue),
      ]
        .map(csvField)
        .join(','),
    );
  }
  return lines.join('\n');
}
