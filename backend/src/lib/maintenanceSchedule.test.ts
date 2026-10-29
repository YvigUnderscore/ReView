// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_JOB_IDS,
  PURGE_BOOT_DELAY_MS,
  PURGE_EVERY_MS,
  dailyDigestPattern,
  normalizeHour,
  weeklyReportPattern,
} from './maintenanceSchedule';

describe('normalizeHour', () => {
  it('accepts a valid hour', () => {
    for (const h of [0, 7, 23]) expect(normalizeHour(h)).toBe(h);
  });

  it('bounds aberrant values rather than producing an invalid cron', () => {
    expect(normalizeHour(-3)).toBe(0);
    expect(normalizeHour(99)).toBe(23);
    expect(normalizeHour(7.9)).toBe(7);
    expect(normalizeHour(Number.NaN)).toBe(0);
  });
});

describe('motifs cron', () => {
  it('daily digest — every day at the requested hour', () => {
    expect(dailyDigestPattern(7)).toBe('0 7 * * *');
    expect(dailyDigestPattern(0)).toBe('0 0 * * *');
  });

  it('weekly report — on Monday, at the same hour as the digest', () => {
    expect(weeklyReportPattern(7)).toBe('0 7 * * 1');
    expect(weeklyReportPattern(18)).toBe('0 18 * * 1');
  });

  it('both patterns have five fields', () => {
    expect(dailyDigestPattern(9).split(' ')).toHaveLength(5);
    expect(weeklyReportPattern(9).split(' ')).toHaveLength(5);
  });

  it('an aberrant hour remains a valid pattern', () => {
    expect(dailyDigestPattern(42)).toBe('0 23 * * *');
    expect(weeklyReportPattern(-1)).toBe('0 0 * * 1');
  });
});

describe('cadence de purge', () => {
  it('keeps exactly the former setInterval rhythm', () => {
    expect(PURGE_EVERY_MS).toBe(24 * 60 * 60 * 1000);
    expect(PURGE_BOOT_DELAY_MS).toBe(60_000);
  });

  it('the job identifiers are distinct and stable', () => {
    const ids = Object.values(MAINTENANCE_JOB_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MAINTENANCE_JOB_IDS.dailyDigest).toBe('maintenance-daily-digest');
  });
});
