// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cameraPoseFromView } from './cameraPose';

/**
 * Banc réécrit sciemment (Phase 50, lot 8). Il verrouillait « conserve les champs présents,
 * dont aspect » : c'était précisément le défaut. `camera.aspect` valait le ratio du cadre, le
 * cadre lisait la présentation — le premier enregistrement gelait donc un 16/9 que personne
 * n'avait choisi, à la place du ratio de livraison du projet. L'aspect ne se capture plus ;
 * un aspect déjà enregistré, lui, se reconduit (annotations normalisées déjà posées).
 */
describe('cameraPoseFromView', () => {
  const base = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };

  it('conserve position/cible, focale et tilt', () => {
    const pose = cameraPoseFromView({ ...base, fov: 50, roll: 0.2 });
    expect(pose).toEqual({ ...base, fov: 50, roll: 0.2 });
  });

  it('n’enregistre PAS l’aspect de la vue — le ratio n’est pas un réglage de caméra', () => {
    const pose = cameraPoseFromView({ ...base, fov: 50, aspect: 1.777 });
    expect('aspect' in pose).toBe(false);
  });

  it('reconduit l’aspect déjà enregistré, quel que soit celui de la vue', () => {
    const pose = cameraPoseFromView({ ...base, aspect: 16 / 9 }, 2.39);
    expect(pose.aspect).toBeCloseTo(2.39);
  });

  it('ne grave pas un aspect enregistré aberrant', () => {
    expect('aspect' in cameraPoseFromView(base, 0)).toBe(false);
    expect('aspect' in cameraPoseFromView(base, Number.NaN)).toBe(false);
    expect('aspect' in cameraPoseFromView(base, null)).toBe(false);
  });

  it('omet les champs absents (pas de clés fov/aspect/roll indéfinies)', () => {
    const pose = cameraPoseFromView(base);
    expect(pose).toEqual(base);
    expect('aspect' in pose).toBe(false);
    expect('roll' in pose).toBe(false);
  });
});
