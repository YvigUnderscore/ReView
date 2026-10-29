// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Visual marker for the measure tool: two dots and the segment joining them, added to the
 * **scene** (never to the model) so they are neither captured by prim indexing, hit by a
 * raycast, nor embedded in the thumbnail — same precaution as the selection glow.
 *
 * The segment is drawn on top of the geometry (`depthTest: false`): a measurement crossing the
 * room must stay readable, otherwise you only see what sticks out.
 */

/** Color of the measure marker: the theme accent (cyan), readable on light and dark backgrounds. */
export const MEASURE_COLOR = 0x22d3ee;

export interface MeasureGizmo {
  /** Places the marker on 0, 1 or 2 points (world). */
  setPoints(points: readonly THREE.Vector3[]): void;
  dispose(): void;
}

export function createMeasureGizmo(
  three: typeof import('three'),
  scene: THREE.Scene,
  /** Model radius: the dots must stay visible at every scale. */
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
