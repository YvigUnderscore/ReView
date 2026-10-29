// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The inhibitor counter, and the defect it replaces: three modules wrote `controls.enabled`
 * directly, and whichever finished last re-enabled the orbit even if another still held it.
 * The named scenario of lot 8 is the third test: a gizmo armed then disarmed **during a fly**.
 */

import { describe, expect, it } from 'vitest';
import { inhibitOrbit, orbitEnabled, orbitInhibitors } from './controlsLock';

describe('orbitEnabled', () => {
  it('re-enables the orbit only at zero inhibitors', () => {
    expect(orbitEnabled(0)).toBe(true);
    expect(orbitEnabled(1)).toBe(false);
    expect(orbitEnabled(2)).toBe(false);
  });
});

describe('inhibitOrbit', () => {
  it('freezes the orbit and restores it when the last token is released', () => {
    const controls = { enabled: true };
    const release = inhibitOrbit(controls, 'fly');
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    release();
    expect(controls.enabled).toBe(true);
    expect(orbitInhibitors(controls)).toEqual([]);
  });

  it('counts two inhibitors: the first to finish restores nothing', () => {
    const controls = { enabled: true };
    const fly = inhibitOrbit(controls, 'fly');
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    expect(orbitInhibitors(controls)).toEqual(['fly', 'gizmo-drag']);
    gizmo();
    // THE ORIGINAL DEFECT: here, the gizmo set `enabled = true` in the middle of a fly.
    expect(controls.enabled).toBe(false);
    fly();
    expect(controls.enabled).toBe(true);
  });

  it('releases idempotently — a replayed cleanup does not release another token', () => {
    const controls = { enabled: true };
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    gizmo();
    const fly = inhibitOrbit(controls, 'fly');
    gizmo(); // replayed (React effect unmount): must not release the fly
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    fly();
    expect(controls.enabled).toBe(true);
  });

  it('counts per target: two viewers mounted together do not interfere', () => {
    const a = { enabled: true };
    const b = { enabled: true };
    const release = inhibitOrbit(a, 'fly');
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(true);
    release();
    expect(orbitInhibitors(b)).toEqual([]);
  });
});
