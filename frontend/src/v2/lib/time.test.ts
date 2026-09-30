// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { timeAgo } from './time';
import { setLocale } from '../i18n';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
/** Intl insère des espaces insécables fines : on compare sur des espaces ordinaires. */
const norm = (s: string) => s.replace(/\s/g, ' ');

describe('timeAgo', () => {
  it('gradue seconde → minute → heure → jour, en français', async () => {
    await setLocale('fr');
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    expect(timeAgo(ago(30_000))).toBe('maintenant');
    expect(norm(timeAgo(ago(5 * 60_000)))).toBe('il y a 5 min');
    expect(norm(timeAgo(ago(3 * 3_600_000)))).toBe('il y a 3 h');
    expect(timeAgo(ago(2 * 86_400_000))).toBe('avant-hier');
  });

  it('suit la langue courante', async () => {
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    await setLocale('en');
    expect(norm(timeAgo(ago(5 * 60_000)))).toBe('5 min. ago');
    await setLocale('ja');
    expect(timeAgo(ago(5 * 60_000))).toContain('5');
  });

  it('au-delà de 7 jours : date absolue dans la langue courante', async () => {
    await setLocale('fr');
    vi.setSystemTime(new Date('2026-07-04T12:00:00Z'));
    expect(timeAgo(ago(10 * 86_400_000))).toBe(new Date(ago(10 * 86_400_000)).toLocaleDateString('fr'));
  });
});
