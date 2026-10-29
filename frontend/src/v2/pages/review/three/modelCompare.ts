// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/** Centered side-by-side offsets (pure): n positions spaced by `spacing`. */
export function sideBySideOffsets(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/**
 * Sets the opacity of a loaded 3D object (39.E) by walking its materials: `transparent` and
 * `depthWrite` follow the opacity, and the object is hidden at 0 (avoids the rendering cost). Not
 * destructive — calling with 1 restores a standard opaque render. Testable with real three.
 */
export function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  const transparent = opacity < 1;
  object.traverse((o) => {
    const raw = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!raw) return;
    const mats = Array.isArray(raw) ? raw : [raw];
    for (const m of mats) {
      const mat = m as THREE.Material & { opacity: number };
      mat.opacity = opacity;
      mat.transparent = transparent;
      mat.depthWrite = !transparent;
      mat.needsUpdate = true;
    }
  });
  object.visible = opacity > 0;
}
