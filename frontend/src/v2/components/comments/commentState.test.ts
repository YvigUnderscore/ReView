// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isClosed, matchesFilter, stateOf, toggleState } from './commentState';

describe('stateOf', () => {
  it('reads the state when it is present', () => {
    expect(stateOf({ state: 'WIP', isResolved: false })).toBe('WIP');
    expect(stateOf({ state: 'WONT_FIX', isResolved: false })).toBe('WONT_FIX');
  });

  it('falls back to the boolean for older comments', () => {
    // Without this fallback, every already-resolved thread would reopen on screen.
    expect(stateOf({ isResolved: true })).toBe('RESOLVED');
    expect(stateOf({ isResolved: false })).toBe('OPEN');
    expect(stateOf({ state: null, isResolved: true })).toBe('RESOLVED');
  });

  it('ignores an unknown value instead of displaying it as is', () => {
    expect(stateOf({ state: 'BIDON', isResolved: true })).toBe('RESOLVED');
  });
});

describe('isClosed', () => {
  it('groups "will not be fixed" with "resolved"', () => {
    expect(isClosed('RESOLVED')).toBe(true);
    expect(isClosed('WONT_FIX')).toBe(true);
  });

  it('leaves open the states that still wait for something', () => {
    expect(isClosed('OPEN')).toBe(false);
    expect(isClosed('WIP')).toBe(false);
    expect(isClosed('QUESTION')).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('lets everything through without a filter', () => {
    expect(matchesFilter({ isResolved: true }, null)).toBe(true);
  });

  it('compares against the effective state, fallback included', () => {
    expect(matchesFilter({ isResolved: true }, 'RESOLVED')).toBe(true);
    expect(matchesFilter({ isResolved: false }, 'RESOLVED')).toBe(false);
    expect(matchesFilter({ state: 'QUESTION', isResolved: false }, 'QUESTION')).toBe(true);
  });
});

describe('toggleState', () => {
  it('resolves what is not resolved, reopens what is', () => {
    expect(toggleState('OPEN')).toBe('RESOLVED');
    expect(toggleState('WIP')).toBe('RESOLVED');
    expect(toggleState('RESOLVED')).toBe('OPEN');
  });
});
