// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { pickStickyProject, readStoredProject } from './stickyProject';

describe('pickStickyProject', () => {
  it('always prefers the route\'s project', () => {
    expect(pickStickyProject(12, 7)).toBe(12);
  });

  it('falls back to the last known project outside a project page', () => {
    // This is the targeted case: the home page, the project list or reviews must not empty
    // the project's sections in the sidebar.
    expect(pickStickyProject(null, 7)).toBe(7);
  });

  it('returns null when nothing is known', () => {
    expect(pickStickyProject(null, null)).toBeNull();
  });
});

describe('readStoredProject', () => {
  it('reads a valid identifier', () => {
    expect(readStoredProject('461')).toBe(461);
  });

  it('ignores an absent or empty value', () => {
    expect(readStoredProject(null)).toBeNull();
    expect(readStoredProject('')).toBeNull();
  });

  it('ignores anything that is not a plausible identifier', () => {
    expect(readStoredProject('abc')).toBeNull();
    expect(readStoredProject('-3')).toBeNull();
    expect(readStoredProject('0')).toBeNull();
    expect(readStoredProject('1.5')).toBeNull();
  });
});
