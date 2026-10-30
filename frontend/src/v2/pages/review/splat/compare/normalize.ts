// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Size normalisation of the compared splats (11.H): two captures with very different raw scales must appear
 * at the same size. The sibling's scale is the ratio of the bounding-sphere radii (reference / sibling), and
 * its centre is realigned on that of the reference. Pure function (the radii and centres are extracted from
 * the bboxes by the caller).
 */

export interface SiblingNormalization {
  /** Uniform scale to apply to the sibling. */
  scale: number;
  /** Position of the sibling (pivot space) to align its centre on the reference. */
  offset: [number, number, number];
}

export function normalizationFor(
  refRadius: number,
  refCenter: [number, number, number],
  siblingRadius: number,
  siblingCenter: [number, number, number],
): SiblingNormalization | null {
  if (!Number.isFinite(refRadius) || refRadius <= 0) return null;
  if (!Number.isFinite(siblingRadius) || siblingRadius <= 0) return null;
  const scale = refRadius / siblingRadius;
  // sibling centre × scale + offset = reference centre
  return {
    scale,
    offset: [
      refCenter[0] - siblingCenter[0] * scale,
      refCenter[1] - siblingCenter[1] * scale,
      refCenter[2] - siblingCenter[2] * scale,
    ],
  };
}
