// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatTransform } from '../reviewTypes';
import type { Transform } from '../reviewTypes';
import { quatToEulerDeg } from '../options/transformMath';

/**
 * Convertit la TRS d'un mesh (lue par le gizmo, `readMeshTransform`) vers la transformation
 * stockée du modèle 3D (`Transform` : yaw/pitch/roll en degrés + échelle uniforme). Le format
 * `version.transform` ne porte ni translation ni échelle non-uniforme : la rotation vient du
 * quaternion (euler XYZ = [pitch, yaw, roll], cohérent avec `applyEulerTransform`), l'échelle est
 * ramenée à la moyenne des composantes. Pur/testable.
 */
export function eulerTransformFromMesh(t: SplatTransform): Transform {
  const [pitch, yaw, roll] = quatToEulerDeg(t.quaternion);
  const scale = (Math.abs(t.scale[0]) + Math.abs(t.scale[1]) + Math.abs(t.scale[2])) / 3;
  return { yaw, pitch, roll, scale: Math.max(scale, 0.001) };
}
