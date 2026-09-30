// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { displayVersion, formatBuildDate } from './aboutInstance';

describe('displayVersion', () => {
  it('n’ajoute des parenthèses que s’il y a un commit', () => {
    expect(displayVersion({ version: '2.3.0', commit: null })).toBe('2.3.0');
    expect(displayVersion({ version: '2.3.0', commit: 'abc123' })).toBe('2.3.0 (abc123)');
  });
});

describe('formatBuildDate', () => {
  it('formate la date de construction selon la langue du lecteur', () => {
    expect(formatBuildDate('2026-08-22T09:30:00.000Z', 'en-GB')).toContain('2026');
  });

  it('ignore une date absente ou illisible', () => {
    expect(formatBuildDate(null)).toBeNull();
    expect(formatBuildDate('pas une date')).toBeNull();
  });
});
