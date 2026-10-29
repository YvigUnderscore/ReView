// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { wrapIndex } from './lightbox.helpers';

describe('lightbox — wrapIndex (Phase 18)', () => {
  it('wraps forwards', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(4, 3)).toBe(1);
  });

  it('wraps backwards', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-4, 3)).toBe(2);
  });

  it('stays within the range', () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });

  it('guards against an empty set', () => {
    expect(wrapIndex(2, 0)).toBe(0);
  });
});
