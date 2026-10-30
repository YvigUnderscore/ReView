// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerSceneHelpers, renderWithoutHelpers, sceneHelperCount } from './sceneHelpers';

describe('sceneHelpers — helper objects kept out of the PiP pass', () => {
  it('hides them during the render, then restores them', () => {
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

  it('leaves hidden what was already hidden for another reason', () => {
    const helper = new THREE.Object3D();
    helper.visible = false; // `setVisible(false)` of the rig: no animation, no editing
    const off = registerSceneHelpers(helper);
    renderWithoutHelpers(() => undefined);
    expect(helper.visible).toBe(false);
    off();
  });

  it('restores even if the render throws', () => {
    const helper = new THREE.Object3D();
    const off = registerSceneHelpers(helper);
    expect(() =>
      renderWithoutHelpers(() => {
        throw new Error('WebGL context lost');
      }),
    ).toThrow();
    expect(helper.visible).toBe(true);
    off();
  });

  it('the removal returned by the registration properly empties the registry (rig unmount)', () => {
    const before = sceneHelperCount();
    const off = registerSceneHelpers(new THREE.Object3D(), new THREE.Object3D());
    expect(sceneHelperCount()).toBe(before + 2);
    off();
    expect(sceneHelperCount()).toBe(before);
  });
});
