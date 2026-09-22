// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerSceneHelpers, renderWithoutHelpers, sceneHelperCount } from './sceneHelpers';

describe('sceneHelpers — les objets d’aide hors de la passe PiP', () => {
  it('masque le temps du rendu, puis restaure', () => {
    const helper = new THREE.Object3D();
    const off = registerSceneHelpers(helper);
    let seen: boolean | null = null;
    renderWithoutHelpers(() => {
      seen = helper.visible;
    });
    expect(seen).toBe(false);
    expect(helper.visible).toBe(true);
    off();
  });

  it('laisse caché ce qui l’était déjà pour une autre raison', () => {
    const helper = new THREE.Object3D();
    helper.visible = false; // `setVisible(false)` du rig : pas d'animation, pas d'édition
    const off = registerSceneHelpers(helper);
    renderWithoutHelpers(() => undefined);
    expect(helper.visible).toBe(false);
    off();
  });

  it('restaure même si le rendu lève', () => {
    const helper = new THREE.Object3D();
    const off = registerSceneHelpers(helper);
    expect(() =>
      renderWithoutHelpers(() => {
        throw new Error('contexte WebGL perdu');
      }),
    ).toThrow();
    expect(helper.visible).toBe(true);
    off();
  });

  it('le retrait rendu par l’enregistrement vide bien le registre (démontage du rig)', () => {
    const before = sceneHelperCount();
    const off = registerSceneHelpers(new THREE.Object3D(), new THREE.Object3D());
    expect(sceneHelperCount()).toBe(before + 2);
    off();
    expect(sceneHelperCount()).toBe(before);
  });
});
