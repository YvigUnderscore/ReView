// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * La garde de vol du chrome (Phase 50, lot 8).
 *
 * Clic droit maintenu dans un viewer spatial = **mode de navigation**. Le chrome écoutait le
 * clavier sans le savoir : `S` (reculer, en ZQSD comme en WASD) armait le gizmo Échelle au milieu
 * d'un déplacement, et `T`/`R` faisaient changer de mode. Ces tests vérifient que la même frappe
 * agit hors vol et ne fait rien en vol — la garde ne doit pas devenir un blocage permanent.
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

describe('useChromeState — garde de vol', () => {
  it('arme le gizmo Échelle hors vol : la lettre garde son sens habituel', () => {
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => false }));
    expect(result.current.state.tool).toBe('nav');
    pressS();
    expect(result.current.state.tool).toBe('scale');
    expect(result.current.state.mode).toBe('clean');
  });

  it('ne change ni outil ni mode pendant un vol', () => {
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => true }));
    const before = result.current.state;
    pressS();
    expect(result.current.state.tool).toBe('nav');
    expect(result.current.state.mode).toBe(before.mode);
  });

  it('retrouve ses touches à l’atterrissage', () => {
    let flying = true;
    const { result } = renderHook(() => useChromeState('SPLAT', { isFlying: () => flying }));
    pressS();
    expect(result.current.state.tool).toBe('nav');
    flying = false;
    pressS();
    expect(result.current.state.tool).toBe('scale');
  });

  it('reste sans garde sur un média plat — aucun vol à y craindre', () => {
    const { result } = renderHook(() => useChromeState('VIDEO'));
    pressS();
    expect(result.current.state.tool).toBe('shape-move');
  });
});
