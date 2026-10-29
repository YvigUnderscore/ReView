// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useViewPref } from './useViewPref';

/** Resets the store and the local mirror: the tests share the same singleton. */
beforeEach(() => {
  localStorage.clear();
  useViewPref.setState({ modes: {}, global: null, persist: null });
});

describe('useViewPref — the two levels', () => {
  it('with nothing set, a list shows cards', () => {
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });

  it('the account setting applies to all lists', () => {
    useViewPref.getState().setGlobal('compact');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('an override only applies to its own list', () => {
    useViewPref.getState().setGlobal('compact');
    useViewPref.getState().set('shots:12', 'cards');
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
    // The other lists keep following the account: that is the whole point of an override.
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('removing an override brings the list back to the account setting', () => {
    useViewPref.getState().setGlobal('compact');
    useViewPref.getState().set('shots:12', 'cards');
    useViewPref.getState().clear('shots:12');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(localStorage.getItem('review:view:shots:12')).toBeNull();
  });

  it('toggling sets an override, it does not touch the account', () => {
    useViewPref.getState().setGlobal('cards');
    useViewPref.getState().toggle('shots:12');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
    expect(useViewPref.getState().global).toBe('cards');
  });
});

describe('useViewPref — the account is authoritative', () => {
  it('hydration replaces the local mirror', () => {
    useViewPref.getState().set('shots:12', 'compact');
    useViewPref.getState().hydrate({ viewMode: 'compact', viewModes: { 'shots:12': 'cards' } });
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
    expect(useViewPref.getState().get('assets:12')).toBe('compact');
  });

  it('hydrating with nothing resets the lists to the fallback', () => {
    useViewPref.getState().hydrate({});
    expect(useViewPref.getState().global).toBeNull();
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });

  it('every write is sent to the server — otherwise the setting would not follow', () => {
    const persist = vi.fn();
    useViewPref.getState().setPersist(persist);

    useViewPref.getState().set('shots:12', 'compact');
    expect(persist).toHaveBeenLastCalledWith({ viewModes: { 'shots:12': 'compact' } });

    useViewPref.getState().setGlobal('compact');
    expect(persist).toHaveBeenLastCalledWith({ viewMode: 'compact' });

    useViewPref.getState().clear('shots:12');
    expect(persist).toHaveBeenLastCalledWith({ viewModes: {} });
  });
});

describe('useViewPref — local mirror', () => {
  it('re-reads the mirror when the store is fresh (first render, before the preferences)', () => {
    localStorage.setItem('review:view:shots:12', 'compact');
    expect(useViewPref.getState().get('shots:12')).toBe('compact');
  });

  it('ignores an unreadable value rather than taking it for a mode', () => {
    localStorage.setItem('review:view:shots:12', 'grille');
    expect(useViewPref.getState().get('shots:12')).toBe('cards');
  });
});
