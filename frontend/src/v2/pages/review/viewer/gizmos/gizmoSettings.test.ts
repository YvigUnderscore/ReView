// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GIZMO_SETTINGS, loadGizmoSettings, saveGizmoSettings } from './gizmoSettings';

describe('gizmoSettings — réglages par cible mémorisés (11.G)', () => {
  beforeEach(() => localStorage.clear());

  it('renvoie les défauts par cible quand rien n’est mémorisé', () => {
    expect(loadGizmoSettings('splat')).toEqual(DEFAULT_GIZMO_SETTINGS.splat);
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
    expect(loadGizmoSettings('volume').size).not.toBe(loadGizmoSettings('splat').size);
  });

  it('mémorise séparément les réglages du splat et des volumes', () => {
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
    // Les réglages du volume ne sont pas affectés.
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
  });

  it('tolère un contenu mémorisé invalide ou partiel (retour aux défauts champ par champ)', () => {
    localStorage.setItem('review:splat:gizmo:splat', '{pas du json');
    expect(loadGizmoSettings('splat')).toEqual(DEFAULT_GIZMO_SETTINGS.splat);
    localStorage.setItem(
      'review:splat:gizmo:volume',
      JSON.stringify({ space: 'ailleurs', translationSnap: -3, size: 0 }),
    );
    expect(loadGizmoSettings('volume')).toEqual(DEFAULT_GIZMO_SETTINGS.volume);
  });
});
