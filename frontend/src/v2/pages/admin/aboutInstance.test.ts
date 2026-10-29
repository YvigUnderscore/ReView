// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { displayVersion, formatBuildDate } from './aboutInstance';

describe('displayVersion', () => {
  it('adds parentheses only when there is a commit', () => {
    expect(displayVersion({ version: '2.3.0', commit: null })).toBe('2.3.0');
    expect(displayVersion({ version: '2.3.0', commit: 'abc123' })).toBe('2.3.0 (abc123)');
  });
});

describe('formatBuildDate', () => {
  it('formats the build date according to the reader’s language', () => {
    expect(formatBuildDate('2026-08-22T09:30:00.000Z', 'en-GB')).toContain('2026');
  });

  it('ignores a missing or unreadable date', () => {
    expect(formatBuildDate(null)).toBeNull();
    expect(formatBuildDate('not a date')).toBeNull();
  });
});
