// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { Tr } from '../../../i18n';
import { fieldLabel, isBlocking, issueLabel, toReportCsv } from './report';
import { CSV_FIELDS, type ImportReport } from './types';

/** Test translator: returns the key and its parameters, to read what was requested. */
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
  it('gives a label to each of the sixteen fields, with no missing key', () => {
    for (const field of CSV_FIELDS) {
      const label = fieldLabel(t, field);
      expect(label).toBeTruthy();
      expect(label).not.toContain('(');
    }
  });
});

describe('issueLabel', () => {
  it('passes the faulty column and value to the message', () => {
    expect(issueLabel(t, { code: 'INVALID_DATE', line: 4, column: 'due_date', value: '32/13' })).toBe(
      'csvImport.issue.invalidDate(column=due_date,value=32/13)',
    );
    expect(issueLabel(t, { code: 'UNKNOWN_ASSIGNEE', line: 4, value: 'zoe' })).toBe(
      'csvImport.issue.unknownAssignee(value=zoe)',
    );
  });

  it('never lets "undefined" reach the message', () => {
    expect(issueLabel(t, { code: 'UNKNOWN_COLUMN', line: 1 })).toBe('csvImport.issue.unknownColumn(column=)');
  });
});

describe('isBlocking', () => {
  it('distinguishes a refused row from a mere warning', () => {
    expect(isBlocking('MISSING_SHOT')).toBe(true);
    expect(isBlocking('MISSING_SHOT_COLUMN')).toBe(true);
    expect(isBlocking('UNKNOWN_STATUS')).toBe(false);
    expect(isBlocking('EPISODES_DISABLED')).toBe(false);
  });
});

describe('toReportCsv', () => {
  it('writes one row per anomaly, with its severity', () => {
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

  it('neutralizes formula injection in the report', () => {
    const csv = toReportCsv(t, report([{ code: 'UNKNOWN_STATUS', line: 2, shot: '=cmd()', value: 'x' }]));
    expect(csv).toContain("'=cmd()");
  });

  it('writes only a header when the file is clean', () => {
    expect(toReportCsv(t, report([])).split('\n')).toHaveLength(1);
  });
});
