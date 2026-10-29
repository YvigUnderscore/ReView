// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { compileRule, coversType, matchCandidates, ruleMatches } from './visibility';

describe('compileRule — literal forms', () => {
  it('exact only masks the whole code', () => {
    const test = compileRule({ matchType: 'exact', pattern: 'SH010', ignoreCase: true });
    expect(test('SH010')).toBe(true);
    expect(test('SH0100')).toBe(false);
    expect(test('ASH010')).toBe(false);
  });

  it('ignores case by default, respects it when asked', () => {
    expect(compileRule({ matchType: 'exact', pattern: 'sh010', ignoreCase: true })('SH010')).toBe(true);
    expect(compileRule({ matchType: 'exact', pattern: 'sh010', ignoreCase: false })('SH010')).toBe(false);
  });

  it('prefix and contains cover the common naming conventions', () => {
    expect(compileRule({ matchType: 'prefix', pattern: 'TEST_', ignoreCase: true })('TEST_SH010')).toBe(true);
    expect(compileRule({ matchType: 'prefix', pattern: 'TEST_', ignoreCase: true })('SH010_TEST')).toBe(
      false,
    );
    expect(compileRule({ matchType: 'contains', pattern: '_TMP', ignoreCase: true })('SH010_TMP_v2')).toBe(
      true,
    );
  });
});

describe('compileRule — regular expressions', () => {
  it('accepts a valid expression', () => {
    const test = compileRule({ matchType: 'regex', pattern: '_(TMP|TEST)$', ignoreCase: true });
    expect(test('SH010_TMP')).toBe(true);
    expect(test('SH010_FINAL')).toBe(false);
  });

  it('rejects an invalid expression rather than letting it mask nothing', () => {
    expect(() => compileRule({ matchType: 'regex', pattern: '([a-z', ignoreCase: true })).toThrow(/invalid/i);
  });

  it('rejects an empty pattern', () => {
    expect(() => compileRule({ matchType: 'exact', pattern: '   ', ignoreCase: true })).toThrow();
  });

  it('rejects an excessively long pattern', () => {
    expect(() => compileRule({ matchType: 'regex', pattern: 'a'.repeat(300), ignoreCase: true })).toThrow(
      /too long/i,
    );
  });

  it("is not tripped up by the global flag from one call to the next", () => {
    // A compiled expression is reused for each entity of the pass: with `g`,
    // `lastIndex` would persist and one candidate in two would escape masking.
    const test = compileRule({ matchType: 'regex', pattern: 'TMP', ignoreCase: true });
    expect(test('SH010_TMP')).toBe(true);
    expect(test('SH020_TMP')).toBe(true);
    expect(test('SH030_TMP')).toBe(true);
  });
});

describe('coversType', () => {
  it('"all" covers the four types, a specific type only its own', () => {
    expect(coversType('all', 'shot')).toBe(true);
    expect(coversType('shot', 'shot')).toBe(true);
    expect(coversType('sequence', 'shot')).toBe(false);
  });
});

describe('matchCandidates', () => {
  it('examines the code then the name, without duplicates when they coincide', () => {
    expect(matchCandidates({ code: 'SH010', name: 'Arrivée' })).toEqual(['SH010', 'Arrivée']);
    expect(matchCandidates({ code: 'SH010', name: 'SH010' })).toEqual(['SH010']);
    // An asset has no code: its name must still be examined, otherwise no rule could ever mask
    // an asset.
    expect(matchCandidates({ code: null, name: 'Robot_TEST' })).toEqual(['Robot_TEST']);
  });
});

describe('ruleMatches', () => {
  const rule = { entityType: 'shot', matchType: 'contains' as const, pattern: '_TMP', ignoreCase: true };

  it('masks a shot whose name carries the pattern, even if its code does not', () => {
    expect(ruleMatches(rule, 'shot', { code: 'SH010', name: 'SH010_TMP' })).toBe(true);
  });

  it('does not touch a type the rule does not target', () => {
    expect(ruleMatches(rule, 'asset', { code: null, name: 'Robot_TMP' })).toBe(false);
  });
});
