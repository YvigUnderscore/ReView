// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Longueurs réelles du viewer 3D : conversion des distances **monde** (celles que mesure un
 * raycast) en longueurs du fichier, puis en mètres via le `metersPerUnit` relevé par la
 * conversion USD. Sans cette chaîne, `metersPerUnit` n'est qu'une étiquette de fiche
 * technique et aucune dimension n'est lisible dans le produit.
 *
 * Trois échelles se succèdent et ne doivent jamais être confondues :
 *  - **monde** : ce que voit la caméra, modèle normalisé compris (facteur `worldScale`) ;
 *  - **fichier** : les unités du GLB/USD tel qu'il a été exporté ;
 *  - **mètres** : unité de lecture, obtenue en multipliant par `metersPerUnit`.
 *
 * Purement arithmétique et testable — aucune dépendance Three.
 */

export type Vec3 = readonly [number, number, number];

export type LengthUnit = 'mm' | 'cm' | 'm' | 'km';

export interface Length {
  /** Valeur arrondie pour l'affichage. */
  value: number;
  unit: LengthUnit;
}

/** Longueur → texte lisible : valeur au format du lecteur, symbole d'unité (jamais traduit). */
export function lengthText(len: Length, locale?: string): string {
  return `${len.value.toLocaleString(locale)} ${len.unit}`;
}

/** Distance euclidienne entre deux points (mêmes unités en entrée et en sortie). */
export function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Distance monde → mètres. `worldScale` est le facteur appliqué au wrapper du modèle
 * (normalisation, ou 1 en taille réelle) ; `metersPerUnit` l'échelle déclarée par la scène USD
 * (1 par défaut : le fichier est en mètres, convention glTF).
 */
export function worldToMetres(worldDistance: number, worldScale: number, metersPerUnit = 1): number {
  const scale = Number.isFinite(worldScale) && worldScale > 0 ? worldScale : 1;
  const mpu = Number.isFinite(metersPerUnit) && metersPerUnit > 0 ? metersPerUnit : 1;
  return (worldDistance / scale) * mpu;
}

/**
 * Longueur en mètres → valeur + unité lisibles. On change d'unité aux seuils naturels du
 * métier (un prop se lit en centimètres, un décor en mètres) plutôt qu'en notation
 * scientifique : « 0.0034 m » ne dit rien, « 3.4 mm » se compare à une règle.
 */
export function formatLength(metres: number): Length {
  const m = Number.isFinite(metres) ? Math.abs(metres) : 0;
  if (m < 0.01) return { value: round(m * 1000), unit: 'mm' };
  if (m < 1) return { value: round(m * 100), unit: 'cm' };
  if (m < 1000) return { value: round(m), unit: 'm' };
  return { value: round(m / 1000), unit: 'km' };
}

/** Dimensions d'une boîte englobante (unités fichier) exprimées en longueurs lisibles. */
export function boxLengths(size: Vec3, metersPerUnit = 1): [Length, Length, Length] {
  const mpu = Number.isFinite(metersPerUnit) && metersPerUnit > 0 ? metersPerUnit : 1;
  return [formatLength(size[0] * mpu), formatLength(size[1] * mpu), formatLength(size[2] * mpu)];
}

/** Arrondi d'affichage : deux décimales sous 10, une au-delà, entier au-delà de 100. */
function round(v: number): number {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}
