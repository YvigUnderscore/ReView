// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseCsvDate, parseCsvInteger, parseProjectCsv, resolveFrameRange } from './projectCsvParse';

const codes = (text: string) => parseProjectCsv(text).issues.map((i) => i.code);

describe('parseCsvInteger', () => {
  it('accepts the integers written by a spreadsheet', () => {
    expect(parseCsvInteger('1001')).toBe(1001);
    expect(parseCsvInteger('1 001')).toBe(1001);
    expect(parseCsvInteger('1,001')).toBe(1001);
    expect(parseCsvInteger('-12')).toBe(-12);
  });

  it('refuses what is not an integer', () => {
    expect(parseCsvInteger('1001.5')).toBeNull();
    expect(parseCsvInteger('bientôt')).toBeNull();
    expect(parseCsvInteger('')).toBeNull();
  });
});

describe('parseCsvDate', () => {
  it('reads ISO and day-month-year', () => {
    expect(parseCsvDate('2026-09-15')).toBe('2026-09-15');
    expect(parseCsvDate('2026/9/5')).toBe('2026-09-05');
    expect(parseCsvDate('15/09/2026')).toBe('2026-09-15');
    expect(parseCsvDate('15.09.2026')).toBe('2026-09-15');
  });

  it('refuses an impossible date rather than shifting it', () => {
    expect(parseCsvDate('2026-02-30')).toBeNull();
    expect(parseCsvDate('demain')).toBeNull();
  });
});

describe('parseProjectCsv', () => {
  it('reads all the recognised columns of a row', () => {
    const csv = [
      'episode,sequence,shot,name,description,shot_status,start_frame,end_frame,tasks,department,task_status,assignee,due_date',
      'EP01,SQ010,SH0010,Rooftop,Hero lands,ip,1001,1096,Anim|Comp,ANIMATION,wtg,mia@studio.tld,2026-09-15',
    ].join('\n');
    const { entries, issues } = parseProjectCsv(csv);
    expect(issues).toEqual([]);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).toMatchObject({
      episode: 'EP01',
      sequence: 'SQ010',
      shot: 'SH0010',
      name: 'Rooftop',
      description: 'Hero lands',
      status: 'ip',
      startFrame: 1001,
      endFrame: 1096,
    });
    expect(entry.tasks.map((t) => t.name)).toEqual(['Anim', 'Comp']);
    expect(entry.tasks[0]).toMatchObject({
      department: 'ANIMATION',
      status: 'wtg',
      assignee: 'mia@studio.tld',
      dueDate: '2026-09-15',
    });
  });

  it('merges the rows of the same shot instead of rejecting them as duplicates', () => {
    const csv = [
      'sequence,shot,name,task,assignee',
      'SQ010,SH0010,Rooftop,Anim,mia@studio.tld',
      'SQ010,SH0010,,Comp,leo@studio.tld',
    ].join('\n');
    const { entries } = parseProjectCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lines).toEqual([2, 3]);
    expect(entries[0]!.tasks.map((t) => [t.name, t.assignee])).toEqual([
      ['Anim', 'mia@studio.tld'],
      ['Comp', 'leo@studio.tld'],
    ]);
  });

  it('the same shot under two sequences remains two distinct shots', () => {
    const { entries } = parseProjectCsv('sequence,shot\nSQ010,SH010\nSQ020,SH010');
    expect(entries).toHaveLength(2);
  });

  it('reports the contradictory value of a merge row without losing the first', () => {
    const { entries } = parseProjectCsv('shot,name\nSH010,Rooftop\nSH010,Terrace');
    expect(entries[0]!.name).toBe('Rooftop');
    expect(entries[0]!.issues.map((i) => i.code)).toEqual(['CONFLICTING_VALUE']);
  });

  it('rejects the row without a shot code, keeps the others', () => {
    const parse = parseProjectCsv('shot,name\nSH010,a\n,b\nSH020,c');
    expect(parse.entries.map((e) => e.shot)).toEqual(['SH010', 'SH020']);
    expect(parse.issues).toEqual([{ code: 'MISSING_SHOT', line: 3, column: 'shot' }]);
  });

  it('reports the unknown column and the missing shot column', () => {
    expect(codes('shot,sg_uploaded_movie\nSH010,x')).toEqual(['UNKNOWN_COLUMN']);
    expect(codes('sequence,name\nSQ01,x')).toEqual(['MISSING_SHOT_COLUMN']);
    expect(codes('sequence,name,inconnue\nSQ01,x,y')).toEqual(['MISSING_SHOT_COLUMN', 'UNKNOWN_COLUMN']);
    expect(codes('   ')).toEqual(['EMPTY_FILE']);
  });

  it('reports an unreadable number and date without losing the row', () => {
    const { entries } = parseProjectCsv('shot,start_frame,tasks,due_date\nSH010,mille,Anim,32/13/2026');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.issues.map((i) => i.code).sort()).toEqual(['INVALID_DATE', 'INVALID_NUMBER']);
    expect(entries[0]!.startFrame).toBeNull();
    expect(entries[0]!.tasks[0]!.dueDate).toBeNull();
  });

  it('reports the task repeated twice on the same shot', () => {
    const { entries } = parseProjectCsv('shot,tasks\nSH010,Anim|anim');
    expect(entries[0]!.tasks).toHaveLength(1);
    expect(entries[0]!.issues.map((i) => i.code)).toEqual(['DUPLICATE_TASK']);
  });

  it('accepts the semicolon, the tab and the quoted fields', () => {
    const semi = parseProjectCsv('sequence;shot;name\nSQ01;SH01;"Plan, large"');
    expect(semi.entries[0]).toMatchObject({ sequence: 'SQ01', shot: 'SH01', name: 'Plan, large' });
    const tab = parseProjectCsv('sequence\tshot\nSQ01\tSH01');
    expect(tab.entries[0]).toMatchObject({ sequence: 'SQ01', shot: 'SH01' });
  });

  it('follows the manual match when the header says nothing', () => {
    const { entries } = parseProjectCsv('col1,col2\nSH010,Rooftop', [
      { index: 0, field: 'shot' },
      { index: 1, field: 'name' },
    ]);
    expect(entries[0]).toMatchObject({ shot: 'SH010', name: 'Rooftop' });
  });
});

describe('resolveFrameRange', () => {
  const entry = (startFrame: number | null, endFrame: number | null, frames: number | null) =>
    ({ line: 2, shot: 'SH010', startFrame, endFrame, frames }) as Parameters<typeof resolveFrameRange>[0];

  it('deduces the end from a duration', () => {
    expect(resolveFrameRange(entry(1001, null, 96), 1001)).toMatchObject({
      startFrame: 1001,
      endFrame: 1096,
    });
  });

  it('deduces the start from the first frame of the project when only the duration is known', () => {
    expect(resolveFrameRange(entry(null, null, 48), 101)).toMatchObject({
      startFrame: 101,
      endFrame: 148,
    });
  });

  it('keeps the explicit bounds and flags the duration that contradicts them', () => {
    const resolved = resolveFrameRange(entry(1001, 1096, 100), 1001);
    expect(resolved).toMatchObject({ startFrame: 1001, endFrame: 1096 });
    expect(resolved.issue?.code).toBe('FRAME_RANGE_MISMATCH');
  });

  it('reports nothing when the three values agree', () => {
    expect(resolveFrameRange(entry(1001, 1096, 96), 1001).issue).toBeNull();
  });
});
