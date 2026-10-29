// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GIZMO_SETTINGS, loadGizmoSettings, saveGizmoSettings } from './gizmoSettings';

describe('gizmoSettings — per-target remembered settings (11.G)', () => {
  beforeEach(() => localStorage.clear());

  it('returns the per-target defaults when nothing is remembered', () => {
    expect(loadGizmoSettings('splat')).toEqual(DEFAULT_GIZMO_SETTINGS.splat);
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
    expect(loadGizmoSettings('volume').size).not.toBe(loadGizmoSettings('splat').size);
  });

  it('remembers the splat and volume settings separately', () => {
    saveGizmoSettings('splat', {
      space: 'world',
      translationSnap: 0.5,
      rotationSnapDeg: 15,
      scaleSnap: null,
      size: 1.2,
    });
    expect(loadGizmoSettings('splat')).toEqual({
      space: 'world',
      translationSnap: 0.5,
      rotationSnapDeg: 15,
      scaleSnap: null,
      size: 1.2,
    });
    // The volume settings are not affected.
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
  });

  it('tolerates invalid or partial remembered content (falls back to defaults field by field)', () => {
    localStorage.setItem('review:splat:gizmo:splat', '{not json');
    expect(loadGizmoSettings('splat')).toEqual(DEFAULT_GIZMO_SETTINGS.splat);
    localStorage.setItem(
      'review:splat:gizmo:volume',
      JSON.stringify({ space: 'elsewhere', translationSnap: -3, size: 0 }),
    );
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
  });
});
