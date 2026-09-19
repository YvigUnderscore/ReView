// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Boîte d'une image de référence épinglée au canvas, en fractions de l'image de base. */
export interface RefBox {
  x: number;
  y: number;
  width: number;
}

/** Image de référence en préparation dans le composer (locale, envoyée avec le commentaire). */
export interface StagedReference extends RefBox {
  key: string;
  dataUrl: string;
}

export const REF_MIN_WIDTH = 0.02;
export const REF_MAX_WIDTH = 1;
/** Bord bas : la hauteur d'une référence est inconnue ici, on garde son bord haut dans le cadre. */
const MAX_Y = 0.95;

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;

/**
 * Ramène une boîte dans le cadre. Sert aux deux bouts : à la pose et au déplacement (rien ne
 * sort), et à l'**affichage** des références déjà enregistrées hors cadre — le collage posait
 * à x = 1.05, invisible ; sans recadrage elles le resteraient.
 */
export function clampRefBox(box: RefBox): RefBox {
  const width = clamp(box.width, REF_MIN_WIDTH, REF_MAX_WIDTH);
  return { x: clamp(box.x, 0, 1 - width), y: clamp(box.y, 0, MAX_Y), width };
}

/** Position d'une référence qu'on vient de coller : dans le cadre, en cascade. */
export function pastedRefBox(index: number): RefBox {
  return clampRefBox({ x: 0.06 + index * 0.04, y: 0.08 + index * 0.04, width: 0.3 });
}
