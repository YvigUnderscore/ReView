// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { Tr } from '../../../i18n';
import { fieldLabel, isBlocking, issueLabel, toReportCsv } from './report';
import { CSV_FIELDS, type ImportReport } from './types';

/** Traducteur d'essai : rend la clé et ses paramètres, pour lire ce qui a été demandé. */
const t = ((key: string, params?: Record<string, string | number>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(',')})`
    : key) as unknown as Tr;

const report = (issues: ImportReport['issues']): ImportReport => ({
  committed: false,
  counts: {
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
  },
  columns: [],
  issues,
  rows: [],
  truncated: false,
});

describe('fieldLabel', () => {
  it('donne un libellé à chacun des seize champs, sans clé manquante', () => {
    for (const field of CSV_FIELDS) {
      const label = fieldLabel(t, field);
      expect(label).toBeTruthy();
      expect(label).not.toContain('(');
    }
  });
});

describe('issueLabel', () => {
  it('passe la colonne et la valeur fautives au message', () => {
    expect(issueLabel(t, { code: 'INVALID_DATE', line: 4, column: 'due_date', value: '32/13' })).toBe(
      'csvImport.issue.invalidDate(column=due_date,value=32/13)',
    );
    expect(issueLabel(t, { code: 'UNKNOWN_ASSIGNEE', line: 4, value: 'zoe' })).toBe(
      'csvImport.issue.unknownAssignee(value=zoe)',
    );
  });

  it('ne laisse jamais « undefined » atteindre le message', () => {
    expect(issueLabel(t, { code: 'UNKNOWN_COLUMN', line: 1 })).toBe('csvImport.issue.unknownColumn(column=)');
  });
});

describe('isBlocking', () => {
  it('distingue le refus de la ligne du simple avertissement', () => {
    expect(isBlocking('MISSING_SHOT')).toBe(true);
    expect(isBlocking('MISSING_SHOT_COLUMN')).toBe(true);
    expect(isBlocking('UNKNOWN_STATUS')).toBe(false);
    expect(isBlocking('EPISODES_DISABLED')).toBe(false);
  });
});

describe('toReportCsv', () => {
  it('écrit une ligne par anomalie, avec sa gravité', () => {
    const csv = toReportCsv(
      t,
      report([
        { code: 'MISSING_SHOT', line: 3 },
        { code: 'UNKNOWN_STATUS', line: 5, value: 'livre', shot: 'SH0010' },
      ]),
    );
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('csvImport.report.rejected');
    expect(lines[2]).toContain('SH0010');
    expect(lines[2]).toContain('csvImport.report.warning');
  });

  it('neutralise l’injection de formule dans le rapport', () => {
    const csv = toReportCsv(t, report([{ code: 'UNKNOWN_STATUS', line: 2, shot: '=cmd()', value: 'x' }]));
    expect(csv).toContain("'=cmd()");
  });

  it('n’écrit qu’un en-tête quand le fichier est sain', () => {
    expect(toReportCsv(t, report([])).split('\n')).toHaveLength(1);
  });
});
