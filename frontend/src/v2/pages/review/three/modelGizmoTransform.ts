// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatTransform } from '../reviewTypes';
import type { Transform } from '../reviewTypes';
import { quatToEulerDeg } from '../options/transformMath';

/**
 * Converts a mesh's TRS (read by the gizmo, `readMeshTransform`) into the stored transform of the
 * 3D model (`Transform`: yaw/pitch/roll in degrees + uniform scale). The `version.transform` format
 * carries neither translation nor non-uniform scale: the rotation comes from the quaternion (Euler
 * XYZ = [pitch, yaw, roll], consistent with `applyEulerTransform`), and the scale is reduced to the
 * average of its components. Pure, testable.
 */
export function eulerTransformFromMesh(t: SplatTransform): Transform {
  const [pitch, yaw, roll] = quatToEulerDeg(t.quaternion);
  const scale = (Math.abs(t.scale[0]) + Math.abs(t.scale[1]) + Math.abs(t.scale[2])) / 3;
  return { yaw, pitch, roll, scale: Math.max(scale, 0.001) };
}
