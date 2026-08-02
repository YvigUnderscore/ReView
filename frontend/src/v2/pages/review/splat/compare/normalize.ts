// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Normalisation de taille des splats comparés (11.H) : deux captures d'échelles brutes très
 * différentes doivent apparaître à la même taille — l'échelle du frère est le ratio des
 * rayons de bounding sphere (référence / frère), et son centre est recalé sur celui de la
 * référence. Fonction pure (les rayons/centres sont extraits des bbox par l'appelant).
 */

export interface SiblingNormalization {
  /** Échelle uniforme à appliquer au frère. */
  scale: number;
  /** Position du frère (espace pivot) pour aligner son centre sur la référence. */
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
  // centre_frère × scale + offset = centre_référence
  return {
    scale,
    offset: [
      refCenter[0] - siblingCenter[0] * scale,
      refCenter[1] - siblingCenter[1] * scale,
      refCenter[2] - siblingCenter[2] * scale,
    ],
  };
}
