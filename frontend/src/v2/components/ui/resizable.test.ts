// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { clampSize, readStoredSize, writeStoredSize } from './resizable.helpers';

describe('resizable — helpers (Phase 18)', () => {
  beforeEach(() => localStorage.clear());

  it('clampSize clamps to [min, max]', () => {
    expect(clampSize(100, 240, 640)).toBe(240);
    expect(clampSize(900, 240, 640)).toBe(640);
    expect(clampSize(400, 240, 640)).toBe(400);
  });

  it('readStoredSize returns the fallback if absent or invalid', () => {
    expect(readStoredSize('sidebar', 380)).toBe(380);
    localStorage.setItem('review.resizable.sidebar', 'abc');
    expect(readStoredSize('sidebar', 380)).toBe(380);
  });

  it('round-trip write → read (rounded)', () => {
    writeStoredSize('sidebar', 412.7);
    expect(readStoredSize('sidebar', 380)).toBe(413);
  });
});
