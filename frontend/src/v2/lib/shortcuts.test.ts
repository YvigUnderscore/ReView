// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isEditable, useGlobalShortcuts } from './shortcuts';
import { resolveBindings } from './shortcutRegistry';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const input = (type: string) => {
  const el = document.createElement('input');
  el.type = type;
  return el;
};

describe('isEditable', () => {
  it('blocks shortcuts inside text input fields', () => {
    expect(isEditable(input('text'))).toBe(true);
    expect(isEditable(input('password'))).toBe(true);
    expect(isEditable(input('number'))).toBe(true);
    expect(isEditable(document.createElement('textarea'))).toBe(true);
    expect(isEditable(document.createElement('select'))).toBe(true);
  });

  it('lets shortcuts through from non-text controls (HUD checkbox…)', () => {
    expect(isEditable(input('checkbox'))).toBe(false);
    expect(isEditable(input('radio'))).toBe(false);
    expect(isEditable(input('range'))).toBe(false);
    expect(isEditable(document.createElement('button'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

/**
 * The `g` leader collision, found in the code and then closed (Phase 50).
 *
 * This handler lives on `document`, the review tool rail on `window`: the event bubbles through the
 * first before the second. A keystroke therefore did two things — `g` armed the polygon tool *and*
 * started the sequence, and the next keystroke (`p`, `k`, `b`) left the page while arming a rail tool
 * on the way. The sequence now consumes its two keystrokes.
 */
const mountGlobal = (projectId: number | null = 7) => {
  const onHelp = vi.fn();
  const heard: string[] = [];
  const rail = (e: KeyboardEvent) => heard.push(e.key);
  window.addEventListener('keydown', rail);
  const view = renderHook(() => useGlobalShortcuts({ projectId, onHelp, bindings: resolveBindings() }));
  return {
    onHelp,
    heard,
    dispose: () => {
      window.removeEventListener('keydown', rail);
      view.unmount();
    },
  };
};

const press = (key: string) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useGlobalShortcuts — the "g" sequence consumes its two keystrokes', () => {
  it('the leader does not reach the review tool rail', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    expect(heard).toEqual([]);
    dispose();
  });

  it('the second keystroke navigates, and does not reach the rail either', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    press('b');
    expect(navigate).toHaveBeenCalledWith('/projects/7/board');
    expect(heard).toEqual([]);
    dispose();
  });

  it('an aborted sequence stays consumed, without navigating', () => {
    const { heard, dispose } = mountGlobal();
    press('g');
    press('x');
    expect(navigate).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    dispose();
  });

  it('outside a sequence, the rail keys pass through — only "g" is taken away from it', () => {
    const { heard, dispose } = mountGlobal();
    press('d');
    press('t');
    expect(heard).toEqual(['d', 't']);
    dispose();
  });

  it('"?" opens the help', () => {
    const { onHelp, dispose } = mountGlobal();
    press('?');
    expect(onHelp).toHaveBeenCalledTimes(1);
    dispose();
  });
});
