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
  policyChanged,
  type RetentionPolicy,
} from './retentionForm';

describe('clampDays', () => {
  it('bounds to [0, 3650] and truncates decimals', () => {
    expect(clampDays('-12')).toBe(0);
    expect(clampDays('99999')).toBe(MAX_DAYS);
    expect(clampDays('30.9')).toBe(30);
  });

  it('empty or unreadable field: 0, that is to say "keep"', () => {
    expect(clampDays('')).toBe(0);
    expect(clampDays('abc')).toBe(0);
  });
});

describe('clampBatchSize', () => {
  it('bounds to [100, 20000]', () => {
    expect(clampBatchSize('1')).toBe(MIN_BATCH);
    expect(clampBatchSize('1000000')).toBe(MAX_BATCH);
    expect(clampBatchSize('2000')).toBe(2000);
  });

  it('empty field: the floor, never 0 (a zero batch would delete nothing)', () => {
    expect(clampBatchSize('')).toBe(MIN_BATCH);
    expect(clampBatchSize('0')).toBe(MIN_BATCH);
    expect(clampBatchSize('abc')).toBe(MIN_BATCH);
  });
});

describe('familles', () => {
  it('the product’s nine logs, without duplicates', () => {
    expect(RETENTION_FAMILIES).toHaveLength(9);
    expect(new Set(RETENTION_FAMILIES).size).toBe(9);
  });

  it('the "dead rows only" families are all part of the list', () => {
    for (const family of DEAD_ONLY_FAMILIES) expect(RETENTION_FAMILIES).toContain(family);
    // A dated log (audit, media access) is purged by age, not by state.
    expect(DEAD_ONLY_FAMILIES.has('auditLog')).toBe(false);
    expect(DEAD_ONLY_FAMILIES.has('mediaAccessLog')).toBe(false);
  });
});

describe('policyChanged', () => {
  const saved = Object.fromEntries([
    ...RETENTION_FAMILIES.map((f) => [f, 30]),
    ['batchSize', 1000],
  ]) as RetentionPolicy;

  it('stays inert as long as nothing has changed', () => {
    expect(policyChanged(saved, { ...saved })).toBe(false);
  });

  it('sees a changed duration, including one set back to "keep"', () => {
    expect(policyChanged(saved, { ...saved, auditLog: 31 })).toBe(true);
    expect(policyChanged(saved, { ...saved, shareLink: 0 })).toBe(true);
  });

  it('sees the deletion batch change', () => {
    expect(policyChanged(saved, { ...saved, batchSize: 2000 })).toBe(true);
  });
});
