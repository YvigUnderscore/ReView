// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Overlay « nuage de points » du mode de visualisation `points` (10.G), réactif à l'édition.
 *
 * Contrairement à un simple `THREE.Points` figé, cet overlay garde un mapping **1:1**
 * point ↔ index de splat (jusqu'à `MAX_POINTS`) afin de refléter *en direct* :
 *  - la **sélection** (teinte orange, même code couleur que la surbrillance des gaussiennes —
 *    invisible sur le mesh en mode points car son opacité est mise à 0) ;
 *  - la **suppression non-destructive** (le point masqué est escamoté via une position `NaN`,
 *    donc écarté par le GPU) sans reconstruire le nuage ni changer de mode.
 *
 * Les mises à jour sont **incrémentales** (diff par index) pour rester fluides sous le pinceau.
 */

/** Garde-fou perf : nombre max de points construits. */
const MAX_POINTS = 1_500_000;

/** Teinte de sélection normalisée 0..1 — miroir de `HIGHLIGHT_RGB` (#ffaa33) côté gaussiennes. */
const SELECT_COLOR: readonly [number, number, number] = [1, 170 / 255, 51 / 255];

export interface PointCloud {
  points: THREE.Points;
  /** Reflète la sélection courante (teinte orange) — diff incrémental depuis la précédente. */
  setSelection(selected: ReadonlySet<number>): void;
  /** Masque (`hidden=true`) ou rétablit des points — suppression non-destructive reflétée live. */
  setHidden(indices: Iterable<number>, hidden: boolean): void;
  /** Remplace l'ensemble des points escamotés par les volumes de crop (canal séparé du masque —
   *  retirer un volume ne révèle pas un point supprimé, et inversement). Phase 28. */
  setCropped(indices: Iterable<number>): void;
  dispose(): void;
}

export function createPointCloud(THREE: typeof import('three'), mesh: SplatMesh): PointCloud {
  const total = mesh.packedSplats?.numSplats ?? 0;
  const n = Math.min(total, MAX_POINTS);
  const positions = new Float32Array(n * 3); // tampon rendu (NaN = point masqué)
  const basePositions = new Float32Array(n * 3); // centres d'origine (restauration undo)
  const colors = new Float32Array(n * 3); // tampon rendu (base + teinte)
  const baseColors = new Float32Array(n * 3); // couleurs d'origine

  // Deux canaux d'escamotage indépendants : masque de suppression et volumes de crop (un point
  // n'est visible que hors des deux) — cf. `setHidden` / `setCropped`.
  const maskHidden = new Set<number>();
  let cropped: ReadonlySet<number> = new Set<number>();

  mesh.forEachSplat((i, center, _scales, _quat, opacity, color) => {
    if (i >= n) return;
    const o = i * 3;
    basePositions[o] = center.x;
    basePositions[o + 1] = center.y;
    basePositions[o + 2] = center.z;
    const visible = opacity > 0; // splats déjà masqués (masque chargé) → escamotés
    if (!visible) maskHidden.add(i);
    positions[o] = visible ? center.x : NaN;
    positions[o + 1] = visible ? center.y : NaN;
    positions[o + 2] = visible ? center.z : NaN;
    baseColors[o] = color.r;
    baseColors[o + 1] = color.g;
    baseColors[o + 2] = color.b;
    colors[o] = color.r;
    colors[o + 1] = color.g;
    colors[o + 2] = color.b;
  });

  const geo = new THREE.BufferGeometry();
  // `BufferAttribute` (et non `Float32BufferAttribute`) garde le Float32Array **par référence** :
  // nos écritures live (setSelection/setHidden) mutent directement le buffer rendu, puis
  // `needsUpdate` le ré-uploade. `Float32BufferAttribute` en ferait une copie (updates perdus).
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  const material = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geo, material);
  let tinted: ReadonlySet<number> = new Set<number>();

  const restoreColor = (i: number) => {
    const o = i * 3;
    colors[o] = baseColors[o]!;
    colors[o + 1] = baseColors[o + 1]!;
    colors[o + 2] = baseColors[o + 2]!;
  };

  /** Recalcule la visibilité d'un point (hors masque ET hors crop → position d'origine). */
  const refresh = (i: number) => {
    const o = i * 3;
    const hide = maskHidden.has(i) || cropped.has(i);
    positions[o] = hide ? NaN : basePositions[o]!;
    positions[o + 1] = hide ? NaN : basePositions[o + 1]!;
    positions[o + 2] = hide ? NaN : basePositions[o + 2]!;
  };

  return {
    points,
    setSelection(selected) {
      for (const i of tinted) if (i < n && !selected.has(i)) restoreColor(i);
      const [r, g, b] = SELECT_COLOR;
      for (const i of selected) {
        if (i >= n || tinted.has(i)) continue;
        const o = i * 3;
        colors[o] = r;
        colors[o + 1] = g;
        colors[o + 2] = b;
      }
      tinted = new Set(selected);
      colAttr.needsUpdate = true;
    },
    setHidden(indices, hidden) {
      for (const i of indices) {
        if (i >= n) continue;
        if (hidden) maskHidden.add(i);
        else maskHidden.delete(i);
        refresh(i);
      }
      posAttr.needsUpdate = true;
    },
    setCropped(indices) {
      const next = new Set<number>();
      for (const i of indices) if (i < n) next.add(i);
      // Diff incrémental : seuls les points qui changent d'état sont réécrits (après l'échange,
      // pour que `refresh` lise le nouvel ensemble).
      const prev = cropped;
      cropped = next;
      for (const i of prev) if (!next.has(i)) refresh(i);
      for (const i of next) if (!prev.has(i)) refresh(i);
      posAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      points.removeFromParent();
    },
  };
}
