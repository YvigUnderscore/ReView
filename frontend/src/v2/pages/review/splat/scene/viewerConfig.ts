// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * Réglages du renderer Spark (10.G-V1) : culling. Spark clippe les centres de gaussiennes à 40 %
 * hors cadre (`clipXY` 1.4) et borne le rayon écran d'un splat à 512 px — en zoom fort
 * (overscale), des splats peuvent disparaître en bord de vue.
 *
 * La review garde ce culling **actif** par défaut (lot 8 ; elle le neutralisait depuis 10.G-V1) :
 * sur les scans réels, payer le rendu de gaussiennes hors cadre coûtait plus que le rare
 * clignotement qu'il évitait. Qui le constate le neutralise d'un clic — panneau *Scène* ou menu
 * clic droit du viewer — et son choix est mémorisé (`cullingDefault`).
 */
export interface CullingConfig {
  clipXY: number;
  maxPixelRadius: number;
}

/** Défauts Spark (culling actif — plus rapide sur les très gros nuages) : le défaut de la review. */
export const CULLING_SPARK: CullingConfig = { clipXY: 1.4, maxPixelRadius: 512 };

/** Culling neutralisé (sur demande) : aucun centre clippé, rayon écran très large. */
export const CULLING_OFF: CullingConfig = { clipXY: 100, maxPixelRadius: 4096 };

type CullingTarget = Pick<SparkRenderer, 'clipXY' | 'maxPixelRadius'>;

/** Applique la configuration de culling au SparkRenderer (live, sans reconstruire la scène). */
export function applyCulling(spark: CullingTarget, off: boolean): void {
  const cfg = off ? CULLING_OFF : CULLING_SPARK;
  spark.clipXY = cfg.clipXY;
  spark.maxPixelRadius = cfg.maxPixelRadius;
}
