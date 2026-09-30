// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/** Décalages côte à côte centrés (pur) : n positions espacées de `spacing`. */
export function sideBySideOffsets(n: number, spacing: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/**
 * Règle l'opacité d'un objet 3D chargé (39.E) en parcourant ses matériaux : `transparent` et
 * `depthWrite` suivent l'opacité, et l'objet est masqué à 0 (évite le coût de rendu). Non
 * destructif — l'appel à 1 rétablit un rendu opaque standard. Testable (three réel).
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
