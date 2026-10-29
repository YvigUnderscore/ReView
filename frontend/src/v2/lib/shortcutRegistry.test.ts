// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { isValidKey, resolveBindings, GLOBAL_SHORTCUTS } from './shortcutRegistry';

describe('shortcutRegistry (42.A2)', () => {
  it('isValidKey: a single character, never the "g" leader', () => {
    expect(isValidKey('p')).toBe(true);
    expect(isValidKey('?')).toBe(true);
    expect(isValidKey('g')).toBe(false);
    expect(isValidKey('G')).toBe(false);
    expect(isValidKey('')).toBe(false);
    expect(isValidKey('ab')).toBe(false);
  });

  it('resolveBindings: defaults without an override', () => {
    const b = resolveBindings(undefined);
    expect(b['nav.projects']).toBe('p');
    expect(b['nav.kanban']).toBe('k');
    expect(b['nav.board']).toBe('b');
    expect(b.help).toBe('?');
  });

  it('applies a valid override', () => {
    const b = resolveBindings({ 'nav.projects': 'a' });
    expect(b['nav.projects']).toBe('a');
    // The others stay at their defaults.
    expect(b['nav.kanban']).toBe('k');
  });

  it('ignores invalid overrides (empty, multi-character, "g")', () => {
    const b = resolveBindings({ 'nav.projects': '', 'nav.kanban': 'zz', 'nav.board': 'g' });
    expect(b['nav.projects']).toBe('p');
    expect(b['nav.kanban']).toBe('k');
    expect(b['nav.board']).toBe('b');
  });

  it('every default is a valid key and unique per type', () => {
    const leader = GLOBAL_SHORTCUTS.filter((s) => s.kind === 'leader-g').map((s) => s.defaultKey);
    expect(new Set(leader).size).toBe(leader.length);
    for (const s of GLOBAL_SHORTCUTS) expect(isValidKey(s.defaultKey)).toBe(true);
  });
});
