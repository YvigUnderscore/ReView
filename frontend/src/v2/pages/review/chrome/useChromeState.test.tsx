// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chrome's flight guard (Phase 50, batch 8).
 *
 * Right button held in a spatial viewer = **navigation mode**. The chrome was listening to the
 * keyboard without knowing it: `S` (back, in ZQSD as in WASD) armed the Scale gizmo in the middle
 * of a move, and `T`/`R` switched modes. These tests check that the same keystroke acts outside
 * flight and does nothing during it — the guard must not become a permanent block.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChromeState } from './useChromeState';

const pressS = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
  });

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('useChromeState — flight guard', () => {
  it('arms the Scale gizmo outside flight: the letter keeps its usual meaning', () => {
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => false }));
    expect(result.current.state.tool).toBe('nav');
    pressS();
    expect(result.current.state.tool).toBe('scale');
    expect(result.current.state.mode).toBe('clean');
  });

  it('changes neither tool nor mode during a flight', () => {
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => true }));
    const before = result.current.state;
    pressS();
    expect(result.current.state.tool).toBe('nav');
    expect(result.current.state.mode).toBe(before.mode);
  });

  it('regains its keys on landing', () => {
    let flying = true;
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => flying }));
    pressS();
    expect(result.current.state.tool).toBe('nav');
    flying = false;
    pressS();
    expect(result.current.state.tool).toBe('scale');
  });

  it('stays without a guard on a flat media — no flight to fear there', () => {
    const { result } = renderHook(() => useChromeState('VIDEO'));
    pressS();
    expect(result.current.state.tool).toBe('shape-move');
  });
});
