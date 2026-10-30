// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectColumns, indexByField, normaliseHeader } from './projectCsvColumns';

const fields = (headers: string[], overrides?: Parameters<typeof detectColumns>[1]) =>
  detectColumns(headers, overrides).map((c) => c.field);

describe('normaliseHeader', () => {
  it('ignores case, accents, separators and BOM', () => {
    expect(normaliseHeader('﻿Échéance')).toBe('echeance');
    expect(normaliseHeader('Cut In')).toBe('cutin');
    expect(normaliseHeader('sg_status_list')).toBe('sgstatuslist');
  });
});

describe('detectColumns', () => {
  it('recognises the headers of the usual trackers', () => {
    expect(fields(['sg_sequence', 'Shot Code', 'Shot Name', 'sg_cut_in', 'sg_cut_out'])).toEqual([
      'sequence',
      'shot',
      'name',
      'startFrame',
      'endFrame',
    ]);
    expect(fields(['Episode', 'Plan', 'Tâches', 'Responsable', 'Échéance'])).toEqual([
      'episode',
      'shot',
      'task',
      'assignee',
      'dueDate',
    ]);
  });

  it('a bare "status" targets the task when the file has a task column', () => {
    expect(fields(['shot', 'task', 'status'])).toEqual(['shot', 'task', 'taskStatus']);
  });

  it('a bare "status" targets the shot when the file has no task', () => {
    expect(fields(['shot', 'status'])).toEqual(['shot', 'shotStatus']);
  });

  it('does not overwrite an already explicit status column', () => {
    expect(fields(['shot', 'task', 'task_status', 'status'])).toEqual([
      'shot',
      'task',
      'taskStatus',
      'shotStatus',
    ]);
  });

  it('leaves the unknown column without a field rather than guessing', () => {
    expect(fields(['shot', 'sg_uploaded_movie'])).toEqual(['shot', null]);
  });

  it('the manual match takes precedence over the header and can neutralise a column', () => {
    const columns = detectColumns(
      ['identifiant', 'libelle', 'description'],
      [
        { index: 0, field: 'shot' },
        { index: 1, field: 'name' },
        { index: 2, field: null },
      ],
    );
    expect(columns.map((c) => c.field)).toEqual(['shot', 'name', null]);
    expect(columns.map((c) => c.manual)).toEqual([true, true, true]);
  });

  it('two columns cannot target the same field: the second is ignored', () => {
    expect(fields(['shot', 'shot_code'])).toEqual(['shot', null]);
  });

  it('indexByField returns the position of each recognised field', () => {
    expect(indexByField(detectColumns(['seq', 'shot', 'inconnu', 'tasks']))).toEqual({
      sequence: 0,
      shot: 1,
      task: 3,
    });
  });
});
