// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isDraftModeOn } from './draftMode';

/**
 * The verdict of the `draftMode` setting.
 *
 * What is checked: the default. A setting that is absent, empty or unreadable must yield
 * immediate publication — that is the behaviour the user chose, and reading it as "on" by accident
 * would make all media invisible until a manual publication nobody waits for any more.
 */
describe('isDraftModeOn', () => {
  it('is off until something explicitly turns it on', () => {
    for (const value of [undefined, null, '', '  ', 'false', '0', 'off', 'oui', 'peut-être']) {
      expect(isDraftModeOn(value)).toBe(false);
    }
  });

  it('accepts the three spellings of true — the `Setting` table only stores text', () => {
    for (const value of ['true', 'TRUE', ' True ', '1', 'on']) {
      expect(isDraftModeOn(value)).toBe(true);
    }
  });

  it('accepts the boolean as is — branding already serves it typed', () => {
    expect(isDraftModeOn(true)).toBe(true);
    expect(isDraftModeOn(false)).toBe(false);
  });
});
