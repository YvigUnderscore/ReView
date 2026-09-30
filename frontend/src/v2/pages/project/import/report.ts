// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Tr } from '../../../i18n';
import type { CsvField, CsvIssue, ImportReport } from './types';

/**
 * Mise en mots du rapport d'import.
 *
 * Un studio corrige son fichier et le rejoue : le rapport doit donc sortir du navigateur
 * sous forme de tableau, une ligne par anomalie, avec le numéro de ligne du fichier
 * d'origine. Les fonctions sont pures — elles reçoivent le traducteur — pour être
 * testables et pour ne pas figer la langue au chargement du module.
 */

/** Libellé d'un champ reconnu. Le vocabulaire de production reste en anglais. */
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

/** Motif d'une anomalie, avec la colonne et la valeur fautives quand elles existent. */
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

/** Une anomalie empêche-t-elle la ligne d'exister, ou n'est-ce qu'un avertissement ? */
export function isBlocking(code: CsvIssue['code']): boolean {
  return (
    code === 'EMPTY_FILE' || code === 'MISSING_SHOT_COLUMN' || code === 'MISSING_SHOT' || code === 'IN_TRASH'
  );
}

/**
 * Champ CSV échappé, avec la même garde anti-formule que côté serveur : un tableur ne
 * doit pas exécuter le contenu d'un rapport d'erreurs.
 */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Le rapport en tableau : ligne du fichier, plan, gravité, motif. */
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
