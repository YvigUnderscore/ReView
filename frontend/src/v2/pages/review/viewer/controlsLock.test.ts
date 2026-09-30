// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Le compteur d'inhibiteurs, et le défaut qu'il remplace : trois modules écrivaient
 * `controls.enabled` en clair, et le dernier à finir rendait l'orbite même si un autre la
 * retenait encore. Le scénario nommé du lot 8 est le troisième test : gizmo armé puis désarmé
 * **pendant un vol**.
 */

import { describe, expect, it } from 'vitest';
import { inhibitOrbit, orbitEnabled, orbitInhibitors } from './controlsLock';

describe('orbitEnabled', () => {
  it('ne rend l’orbite qu’à zéro inhibiteur', () => {
    expect(orbitEnabled(0)).toBe(true);
    expect(orbitEnabled(1)).toBe(false);
    expect(orbitEnabled(2)).toBe(false);
  });
});

describe('inhibitOrbit', () => {
  it('gèle l’orbite et la rend au dernier jeton rendu', () => {
    const controls = { enabled: true };
    const release = inhibitOrbit(controls, 'fly');
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    release();
    expect(controls.enabled).toBe(true);
    expect(orbitInhibitors(controls)).toEqual([]);
  });

  it('compte deux inhibiteurs : le premier à finir ne rend rien', () => {
    const controls = { enabled: true };
    const fly = inhibitOrbit(controls, 'fly');
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    expect(orbitInhibitors(controls)).toEqual(['fly', 'gizmo-drag']);
    gizmo();
    // C'EST LE DÉFAUT D'ORIGINE : ici, le gizmo remettait `enabled = true` en plein vol.
    expect(controls.enabled).toBe(false);
    fly();
    expect(controls.enabled).toBe(true);
  });

  it('libère de façon idempotente — un nettoyage rejoué ne rend pas le jeton d’un autre', () => {
    const controls = { enabled: true };
    const gizmo = inhibitOrbit(controls, 'gizmo-drag');
    gizmo();
    const fly = inhibitOrbit(controls, 'fly');
    gizmo(); // rejoué (démontage d'effet React) : ne doit pas relâcher le vol
    expect(controls.enabled).toBe(false);
    expect(orbitInhibitors(controls)).toEqual(['fly']);
    fly();
    expect(controls.enabled).toBe(true);
  });

  it('compte par cible : deux viewers montés ensemble ne se gênent pas', () => {
    const a = { enabled: true };
    const b = { enabled: true };
    const release = inhibitOrbit(a, 'fly');
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(true);
    release();
    expect(orbitInhibitors(b)).toEqual([]);
  });
});
