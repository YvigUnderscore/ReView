// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { gizmoKeyTime, shouldKeyLens } from './shotCamera';

describe('shouldKeyLens', () => {
  it('dans la caméra : seul l’auto-key armé transforme un réglage en clé', () => {
    expect(shouldKeyLens(false, false)).toBe(false);
    expect(shouldKeyLens(false, true)).toBe(true);
  });

  it('hors caméra : toujours une clé — écrire sur la caméra libre ne changeait rien au plan', () => {
    expect(shouldKeyLens(true, false)).toBe(true);
    expect(shouldKeyLens(true, true)).toBe(true);
  });
});

describe('gizmoKeyTime', () => {
  it('reprend la clé sélectionnée quand le geste en tient une', () => {
    expect(gizmoKeyTime(4200, 1000)).toBe(4200);
  });

  it('écrit à la tête de lecture, même sur une animation vide (t=0 forcé avant)', () => {
    expect(gizmoKeyTime(undefined, 3500)).toBe(3500);
    expect(gizmoKeyTime(undefined, 0)).toBe(0);
  });

  it('arrondit et ne descend jamais sous zéro', () => {
    expect(gizmoKeyTime(undefined, 1200.6)).toBe(1201);
    expect(gizmoKeyTime(undefined, -5)).toBe(0);
  });
});
