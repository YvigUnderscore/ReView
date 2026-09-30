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
  it('laisse passer une heure valide', () => {
    for (const h of [0, 7, 23]) expect(normalizeHour(h)).toBe(h);
  });

  it('borne les valeurs aberrantes plutôt que de produire un cron invalide', () => {
    expect(normalizeHour(-3)).toBe(0);
    expect(normalizeHour(99)).toBe(23);
    expect(normalizeHour(7.9)).toBe(7);
    expect(normalizeHour(Number.NaN)).toBe(0);
  });
});

describe('motifs cron', () => {
  it('digest quotidien : tous les jours à l’heure demandée', () => {
    expect(dailyDigestPattern(7)).toBe('0 7 * * *');
    expect(dailyDigestPattern(0)).toBe('0 0 * * *');
  });

  it('rapport hebdomadaire : le lundi, même heure que le digest', () => {
    expect(weeklyReportPattern(7)).toBe('0 7 * * 1');
    expect(weeklyReportPattern(18)).toBe('0 18 * * 1');
  });

  it('les deux motifs comptent cinq champs', () => {
    expect(dailyDigestPattern(9).split(' ')).toHaveLength(5);
    expect(weeklyReportPattern(9).split(' ')).toHaveLength(5);
  });

  it('une heure aberrante reste un motif valide', () => {
    expect(dailyDigestPattern(42)).toBe('0 23 * * *');
    expect(weeklyReportPattern(-1)).toBe('0 0 * * 1');
  });
});

describe('cadence de purge', () => {
  it('reprend exactement l’ancien rythme du setInterval', () => {
    expect(PURGE_EVERY_MS).toBe(24 * 60 * 60 * 1000);
    expect(PURGE_BOOT_DELAY_MS).toBe(60_000);
  });

  it('les identifiants de travaux sont distincts et stables', () => {
    const ids = Object.values(MAINTENANCE_JOB_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MAINTENANCE_JOB_IDS.dailyDigest).toBe('maintenance-daily-digest');
  });
});
