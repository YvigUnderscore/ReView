// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { initialsFrom } from './initials';

describe('initialsFrom', () => {
  it('takes the first letter of each word', () => {
    expect(initialsFrom('Ada Lovelace')).toBe('AL');
  });

  it('settles for one letter for a first name alone', () => {
    expect(initialsFrom('ada')).toBe('A');
  });

  it('returns a readable marker rather than nothing when the name is missing', () => {
    expect(initialsFrom(null)).toBe('?');
    expect(initialsFrom('')).toBe('?');
  });
});
