// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { Transform } from '../reviewTypes';

const DEG2RAD = Math.PI / 180;

/**
 * Applies the user transform (yaw/pitch/roll orientation in degrees + uniform scale) to the
 * **parent group** of the model (Phase 15, V2): the bbox normalisation stays on the child object.
 * Pure and testable. The convention (yaw=Y, pitch=X, roll=Z) serves as the reference of the new
 * viewer; transforms inherited from model-viewer are read back as they are.
 *
 * The pivot is the origin, hence the model's **ground contact point** once normalised: yaw turns
 * it in place, and scale makes it grow without pushing it through the grid.
 */
export function applyEulerTransform(root: THREE.Object3D, t: Transform): void {
  root.rotation.set(t.pitch * DEG2RAD, t.yaw * DEG2RAD, t.roll * DEG2RAD);
  root.scale.setScalar(t.scale);
}
