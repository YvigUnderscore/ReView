// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Repère visuel de l'outil de mesure : deux pastilles et le segment qui les relie, ajoutés à
 * la **scène** (jamais au modèle) pour n'être ni capturés par l'indexation des prims, ni
 * touchés par un raycast, ni embarqués dans la miniature — même précaution que le halo de
 * sélection.
 *
 * Le segment est dessiné par-dessus la géométrie (`depthTest: false`) : une mesure qui
 * traverse la pièce doit rester lisible, sinon on ne voit que ce qui dépasse.
 */

/** Couleur du repère de mesure — accent du thème (cyan), lisible sur fond clair comme sombre. */
export const MEASURE_COLOR = 0x22d3ee;

export interface MeasureGizmo {
  /** Positionne le repère sur 0, 1 ou 2 points (monde). */
  setPoints(points: readonly THREE.Vector3[]): void;
  dispose(): void;
}

export function createMeasureGizmo(
  three: typeof import('three'),
  scene: THREE.Scene,
  /** Rayon du modèle : les pastilles doivent rester visibles à toutes les échelles. */
  radius: number,
): MeasureGizmo {
  const group = new three.Group();
  group.name = 'review-measure';
  group.raycast = () => {};
  group.renderOrder = 999;
  scene.add(group);

  const dotGeometry = new three.SphereGeometry(Math.max(radius, 0.001) * 0.012, 12, 8);
  const dotMaterial = new three.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false });
  const lineMaterial = new three.LineBasicMaterial({ color: MEASURE_COLOR, depthTest: false });
  const lineGeometry = new three.BufferGeometry();
  lineGeometry.setAttribute('position', new three.BufferAttribute(new Float32Array(6), 3));
  const line = new three.Line(lineGeometry, lineMaterial);
  line.raycast = () => {};
  line.visible = false;
  group.add(line);

  const dots = [0, 1].map(() => {
    const dot = new three.Mesh(dotGeometry, dotMaterial);
    dot.raycast = () => {};
    dot.visible = false;
    group.add(dot);
    return dot;
  });

  return {
    setPoints(points) {
      dots.forEach((dot, i) => {
        const p = points[i];
        dot.visible = !!p;
        if (p) dot.position.copy(p);
      });
      const [a, b] = points;
      line.visible = !!a && !!b;
      if (a && b) {
        const attr = lineGeometry.getAttribute('position') as THREE.BufferAttribute;
        attr.setXYZ(0, a.x, a.y, a.z);
        attr.setXYZ(1, b.x, b.y, b.z);
        attr.needsUpdate = true;
        lineGeometry.computeBoundingSphere();
      }
    },
    dispose() {
      group.removeFromParent();
      dotGeometry.dispose();
      dotMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    },
  };
}
