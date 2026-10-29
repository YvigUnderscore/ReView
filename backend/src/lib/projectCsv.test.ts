// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectDelimiter, parseShotsCsv, toCsvLine, toShotsCsv } from './projectCsv';
import { parseProjectCsv } from './projectCsvParse';

describe('projectCsv.detectDelimiter', () => {
  it('picks the most frequent separator of the header', () => {
    expect(detectDelimiter('sequence,shot,name')).toBe(',');
    expect(detectDelimiter('sequence;shot;"nom, complet"')).toBe(';');
    expect(detectDelimiter('sequence\tshot')).toBe('\t');
    expect(detectDelimiter('shot')).toBe(',');
  });
});

describe('projectCsv.toCsvLine', () => {
  it('escapes and neutralises formula injection', () => {
    expect(toCsvLine(['a,b', '=SUM(1)'])).toBe('"a,b",\'=SUM(1)');
  });
});

describe('projectCsv.parseShotsCsv (38.F)', () => {
  it('parses header + rows, tasks separated by |', () => {
    const csv = 'sequence,shot,name,tasks\nSQ01,SH010,Intro,Anim|Comp\n,SH020,,\n';
    const { rows, errors } = parseShotsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { sequence: 'SQ01', shot: 'SH010', name: 'Intro', tasks: ['Anim', 'Comp'] },
      { sequence: null, shot: 'SH020', name: 'SH020', tasks: [] },
    ]);
  });

  it('error if the shot column is absent', () => {
    expect(parseShotsCsv('sequence,name\nSQ01,x').errors[0]).toMatch(/shot/);
  });

  it('reports a missing shot and duplicates (same sequence)', () => {
    const { rows, errors } = parseShotsCsv('shot,name\nSH01,a\n,b\nSH01,c\n');
    expect(rows).toHaveLength(1); // only the first SH01 is kept
    expect(errors.some((e) => /manquant/.test(e))).toBe(true); // the ",b" line
    expect(errors.some((e) => /double/.test(e))).toBe(true); // second SH01
  });

  it('supports the `;` delimiter and quoted fields', () => {
    const { rows } = parseShotsCsv('sequence;shot;name;tasks\nSQ01;SH01;"Plan, large";Anim');
    expect(rows[0]).toEqual({ sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim'] });
  });

  it('empty file → error', () => {
    expect(parseShotsCsv('   ').errors).toEqual(['Fichier vide']);
  });
});

describe('projectCsv.toShotsCsv (38.G)', () => {
  it('serialises with a header and escapes fields, re-importable', () => {
    const csv = toShotsCsv([
      { sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim', 'Comp'] },
      { sequence: null, shot: 'SH02', name: 'SH02', tasks: [] },
    ]);
    expect(csv.split('\n')[0]).toBe('sequence,shot,name,tasks');
    expect(csv).toContain('"Plan, large"');
    // Round trip: the export re-imports identically.
    const back = parseShotsCsv(csv).rows;
    expect(back[0]).toEqual({ sequence: 'SQ01', shot: 'SH01', name: 'Plan, large', tasks: ['Anim', 'Comp'] });
    expect(back[1]).toEqual({ sequence: null, shot: 'SH02', name: 'SH02', tasks: [] });
  });

  it('writes an optional column only if a row fills it in', () => {
    const plain = toShotsCsv([{ sequence: null, shot: 'SH01', name: 'SH01', tasks: [] }]);
    expect(plain.split('\n')[0]).toBe('sequence,shot,name,tasks');
    const rich = toShotsCsv([
      { sequence: 'SQ01', shot: 'SH01', name: 'Intro', tasks: ['Anim'], episode: 'EP01', startFrame: 1001 },
    ]);
    expect(rich.split('\n')[0]).toBe('sequence,shot,name,tasks,episode,start_frame');
    // The enriched headers are read back by the import: the round trip remains possible.
    const back = parseProjectCsv(rich).entries[0];
    expect(back).toMatchObject({ episode: 'EP01', sequence: 'SQ01', shot: 'SH01', startFrame: 1001 });
  });

  it('neutralises formula injection (CP-SEC): apostrophe prefix', () => {
    const csv = toShotsCsv([{ sequence: null, shot: '=cmd()', name: '@x', tasks: ['+y'] }]);
    const line = csv.split('\n')[1];
    expect(line).toContain("'=cmd()");
    expect(line).toContain("'@x");
    expect(line).toContain("'+y");
  });
});
