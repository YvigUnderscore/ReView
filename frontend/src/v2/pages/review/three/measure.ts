// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real-world lengths for the 3D viewer: converts **world** distances (what a raycast measures)
 * into file lengths, then into meters via the `metersPerUnit` read by the USD conversion. Without
 * this chain, `metersPerUnit` is only a tech-sheet label and no dimension is readable in the product.
 *
 * Three scales follow one another and must never be confused:
 *  - **world**: what the camera sees, normalized model included (`worldScale` factor);
 *  - **file**: the units of the GLB/USD as exported;
 *  - **meters**: the reading unit, obtained by multiplying by `metersPerUnit`.
 *
 * Pure arithmetic, testable, no Three dependency.
 */

export type Vec3 = readonly [number, number, number];

export type LengthUnit = 'mm' | 'cm' | 'm' | 'km';

export interface Length {
  /** Value rounded for display. */
  value: number;
  unit: LengthUnit;
}

/** Length → readable text: value in the viewer's format, unit symbol (never translated). */
export function lengthText(len: Length, locale?: string): string {
  return `${len.value.toLocaleString(locale)} ${len.unit}`;
}

/** Euclidean distance between two points (same units in and out). */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * World distance → meters. `worldScale` is the factor applied to the model wrapper
 * (normalization, or 1 at real size); `metersPerUnit` is the scale declared by the USD scene
 * (1 by default: the file is in meters, glTF convention).
 */
export function worldToMetres(worldDistance: number, worldScale: number, metersPerUnit = 1): number {
  const scale = Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1;
  const mpu = Number.isFinite(metersPerUnit) && metersPerUnit > 0 ? metersPerUnit : 1;
  return (worldDistance / scale) * mpu;
}

/**
 * Length in meters → readable value + unit. Units switch at thresholds natural to the trade
 * (a prop reads in centimeters, a set in meters) rather than in scientific notation:
 * "0.0034 m" says nothing, "3.4 mm" can be compared to a ruler.
 */
export function formatLength(metres: number): Length {
  const m = Number.isFinite(metres) ? Math.abs(metres) : 0;
  if (m < 0.01) return { value: round(m * 1000), unit: 'mm' };
  if (m < 1) return { value: round(m * 100), unit: 'cm' };
  if (m < 1000) return { value: round(m), unit: 'm' };
  return { value: round(m / 1000), unit: 'km' };
}

/** Dimensions of a bounding box (file units) expressed as readable lengths. */
export function boxLengths(size: Vec3, metersPerUnit = 1): [Length, Length, Length] {
  const mpu = Number.isFinite(metersPerUnit) && metersPerUnit > 0 ? metersPerUnit : 1;
  return [formatLength(size[0] * mpu), formatLength(size[1] * mpu), formatLength(size[2] * mpu)];
}

/** Display rounding: two decimals below 10, one above, integer above 100. */
function round(v: number): number {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}
