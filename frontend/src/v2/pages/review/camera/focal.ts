// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Focal length (mm) ↔ field of view (degrees) conversion — Phase 26. DCC convention: a
 * **36 mm** sensor applied to the FOV axis driven by the viewer. Pure, testable, inverses of
 * each other.
 */
export const SENSOR_MM = 36;

const DEG = 180 / Math.PI;

/** FOV (degrees) → focal length (mm, 36 mm sensor). */
export function fovToFocal(fovDeg: number, sensor = SENSOR_MM): number {
  const f = Math.min(Math.max(fovDeg, 1), 179);
  return sensor / 2 / Math.tan(f / DEG / 2);
}

/** Focal length (mm, 36 mm sensor) → FOV (degrees). */
export function focalToFov(mm: number, sensor = SENSOR_MM): number {
  const m = Math.max(mm, 1);
  return 2 * Math.atan(sensor / 2 / m) * DEG;
}
