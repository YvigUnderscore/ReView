// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { NOTES_CSV_COLUMNS, csvField, flattenNoteText, toNotesCsv, type NoteCsvRow } from './notesCsv';

/**
 * What the spreadsheet receives. Two things matter: that the columns do not move (a studio hooks scripts onto them)
 * and that note text cannot execute when the file is opened.
 */

const row = (over: Partial<NoteCsvRow> = {}): NoteCsvRow => {
  const base = Object.fromEntries(NOTES_CSV_COLUMNS.map((c) => [c, ''])) as NoteCsvRow;
  return { ...base, ...over };
};

describe('csvField', () => {
  it('leaves an ordinary field intact', () => {
    expect(csvField('SH010')).toBe('SH010');
  });

  it('wraps in quotes a field carrying the separator, a quote or a line break', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('dit "non"')).toBe('"dit ""non"""');
    expect(csvField('deux\nlignes')).toBe('"deux\nlignes"');
  });

  it('neutralises a spreadsheet formula', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-2')).toBe("'-2");
  });
});

describe('flattenNoteText', () => {
  it('brings a multi-line text back onto one readable line', () => {
    expect(flattenNoteText('premier\n\n  second  \ntroisième')).toBe('premier ⏎ second ⏎ troisième');
  });

  it('returns an empty string when the note carries only blanks', () => {
    expect(flattenNoteText('   \n\n ')).toBe('');
  });
});

describe('toNotesCsv', () => {
  it('writes the header even without a note', () => {
    expect(toNotesCsv([])).toBe(NOTES_CSV_COLUMNS.join(','));
  });

  it('writes one line per note, columns in the declared order', () => {
    const csv = toNotesCsv([
      row({
        note_id: '12',
        shot: 'SH010',
        frame: '1024',
        timecode: '00:00:00:23',
        author: 'Alice',
        state: 'OPEN',
        content: 'flicker à gauche',
      }),
      row({ note_id: '13', reply_to: '12', author: 'Bob', state: 'RESOLVED', content: 'corrigé' }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]?.split(',')[0]).toBe('note_id');
    expect(lines[1]).toContain('12,,,SH010');
    expect(lines[1]?.endsWith('flicker à gauche')).toBe(true);
    expect(lines[2]?.startsWith('13,12,')).toBe(true);
  });

  it('escapes the text of a note containing a comma', () => {
    const csv = toNotesCsv([row({ note_id: '1', content: 'trop sombre, trop lent' })]);
    expect(csv.split('\n')[1]).toContain('"trop sombre, trop lent"');
  });
});
