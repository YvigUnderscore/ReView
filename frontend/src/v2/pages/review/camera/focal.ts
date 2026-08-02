// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Conversion focale (mm) ↔ champ de vision (degrés) — Phase 26. Convention DCC : capteur
 * **36 mm** appliqué à l'axe du FOV piloté par le viewer. Purs, testables, inverses l'un
 * de l'autre.
 */
export const SENSOR_MM = 36;

const DEG = 180 / Math.PI;

/** FOV (degrés) → focale (mm, capteur 36 mm). */
export function fovToFocal(fovDeg: number, sensor = SENSOR_MM): number {
  const f = Math.min(Math.max(fovDeg, 1), 179);
  return sensor / 2 / Math.tan(f / DEG / 2);
}

/** Focale (mm, capteur 36 mm) → FOV (degrés). */
export function focalToFov(mm: number, sensor = SENSOR_MM): number {
  const m = Math.max(mm, 1);
  return 2 * Math.atan(sensor / 2 / m) * DEG;
}
