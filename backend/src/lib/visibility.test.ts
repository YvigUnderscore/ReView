// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { compileRule, coversType, matchCandidates, ruleMatches } from './visibility';

describe('compileRule — formes littérales', () => {
  it('exact ne masque que le code entier', () => {
    const test = compileRule({ matchType: 'exact', pattern: 'SH010', ignoreCase: true });
    expect(test('SH010')).toBe(true);
    expect(test('SH0100')).toBe(false);
    expect(test('ASH010')).toBe(false);
  });

  it('ignore la casse par défaut, la respecte quand on le demande', () => {
    expect(compileRule({ matchType: 'exact', pattern: 'sh010', ignoreCase: true })('SH010')).toBe(true);
    expect(compileRule({ matchType: 'exact', pattern: 'sh010', ignoreCase: false })('SH010')).toBe(false);
  });

  it('prefix et contains couvrent les conventions de nommage courantes', () => {
    expect(compileRule({ matchType: 'prefix', pattern: 'TEST_', ignoreCase: true })('TEST_SH010')).toBe(true);
    expect(compileRule({ matchType: 'prefix', pattern: 'TEST_', ignoreCase: true })('SH010_TEST')).toBe(
      false,
    );
    expect(compileRule({ matchType: 'contains', pattern: '_TMP', ignoreCase: true })('SH010_TMP_v2')).toBe(
      true,
    );
  });
});

describe('compileRule — expressions régulières', () => {
  it('accepte une expression valide', () => {
    const test = compileRule({ matchType: 'regex', pattern: '_(TMP|TEST)$', ignoreCase: true });
    expect(test('SH010_TMP')).toBe(true);
    expect(test('SH010_FINAL')).toBe(false);
  });

  it('refuse une expression invalide plutôt que de la laisser ne rien masquer', () => {
    expect(() => compileRule({ matchType: 'regex', pattern: '([a-z', ignoreCase: true })).toThrow(/invalid/i);
  });

  it('refuse un motif vide', () => {
    expect(() => compileRule({ matchType: 'exact', pattern: '   ', ignoreCase: true })).toThrow();
  });

  it('refuse un motif démesuré', () => {
    expect(() => compileRule({ matchType: 'regex', pattern: 'a'.repeat(300), ignoreCase: true })).toThrow(
      /too long/i,
    );
  });

  it("n'est pas piégée par le drapeau global d'un appel à l'autre", () => {
    // Une expression compilée est réutilisée pour chaque entité de la passe : avec `g`,
    // `lastIndex` persisterait et un candidat sur deux échapperait au masquage.
    const test = compileRule({ matchType: 'regex', pattern: 'TMP', ignoreCase: true });
    expect(test('SH010_TMP')).toBe(true);
    expect(test('SH020_TMP')).toBe(true);
    expect(test('SH030_TMP')).toBe(true);
  });
});

describe('coversType', () => {
  it('« all » couvre les quatre types, un type précis seulement le sien', () => {
    expect(coversType('all', 'shot')).toBe(true);
    expect(coversType('shot', 'shot')).toBe(true);
    expect(coversType('sequence', 'shot')).toBe(false);
  });
});

describe('matchCandidates', () => {
  it('examine le code puis le nom, sans doublon quand ils coïncident', () => {
    expect(matchCandidates({ code: 'SH010', name: 'Arrivée' })).toEqual(['SH010', 'Arrivée']);
    expect(matchCandidates({ code: 'SH010', name: 'SH010' })).toEqual(['SH010']);
    // Un asset n'a pas de code : son nom doit tout de même être examiné, sinon aucune
    // règle ne pourrait jamais masquer un asset.
    expect(matchCandidates({ code: null, name: 'Robot_TEST' })).toEqual(['Robot_TEST']);
  });
});

describe('ruleMatches', () => {
  const rule = { entityType: 'shot', matchType: 'contains' as const, pattern: '_TMP', ignoreCase: true };

  it('masque un plan dont le nom porte le motif, même si le code ne le porte pas', () => {
    expect(ruleMatches(rule, 'shot', { code: 'SH010', name: 'SH010_TMP' })).toBe(true);
  });

  it('ne touche pas un type que la règle ne vise pas', () => {
    expect(ruleMatches(rule, 'asset', { code: null, name: 'Robot_TMP' })).toBe(false);
  });
});
