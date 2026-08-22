// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  DEAD_ONLY_FAMILIES,
  MAX_BATCH,
  MAX_DAYS,
  MIN_BATCH,
  RETENTION_FAMILIES,
  clampBatchSize,
  clampDays,
} from './retentionForm';

describe('clampDays', () => {
  it('borne à [0, 3650] et tronque les décimales', () => {
    expect(clampDays('-12')).toBe(0);
    expect(clampDays('99999')).toBe(MAX_DAYS);
    expect(clampDays('30.9')).toBe(30);
  });

  it('champ vidé ou illisible : 0, c’est-à-dire « conserver »', () => {
    expect(clampDays('')).toBe(0);
    expect(clampDays('abc')).toBe(0);
  });
});

describe('clampBatchSize', () => {
  it('borne à [100, 20000]', () => {
    expect(clampBatchSize('1')).toBe(MIN_BATCH);
    expect(clampBatchSize('1000000')).toBe(MAX_BATCH);
    expect(clampBatchSize('2000')).toBe(2000);
  });

  it('champ vidé : le plancher, jamais 0 (une tranche nulle ne supprimerait rien)', () => {
    expect(clampBatchSize('')).toBe(MIN_BATCH);
    expect(clampBatchSize('0')).toBe(MIN_BATCH);
    expect(clampBatchSize('abc')).toBe(MIN_BATCH);
  });
});

describe('familles', () => {
  it('les neuf journaux du produit, sans doublon', () => {
    expect(RETENTION_FAMILIES).toHaveLength(9);
    expect(new Set(RETENTION_FAMILIES).size).toBe(9);
  });

  it('les familles « lignes mortes seulement » font toutes partie de la liste', () => {
    for (const family of DEAD_ONLY_FAMILIES) expect(RETENTION_FAMILIES).toContain(family);
    // Un journal daté (audit, accès média) se purge à l'ancienneté, pas à l'état.
    expect(DEAD_ONLY_FAMILIES.has('auditLog')).toBe(false);
    expect(DEAD_ONLY_FAMILIES.has('mediaAccessLog')).toBe(false);
  });
});
