// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timeAgo } from './time';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('timeAgo', () => {
  it('gradue seconde → minute → heure → jour', () => {
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    expect(timeAgo(ago(30_000))).toBe("à l'instant");
    expect(timeAgo(ago(5 * 60_000))).toBe('il y a 5 min');
    expect(timeAgo(ago(3 * 3_600_000))).toBe('il y a 3 h');
    expect(timeAgo(ago(2 * 86_400_000))).toBe('il y a 2 j');
  });

  it('au-delà de 7 jours : date localisée fr-FR', () => {
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    expect(timeAgo(ago(10 * 86_400_000))).toBe(new Date(ago(10 * 86_400_000)).toLocaleDateString('fr-FR'));
  });
});
