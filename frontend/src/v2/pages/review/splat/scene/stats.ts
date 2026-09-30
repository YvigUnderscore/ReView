// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSampler, type Sampler } from '../../three/statsSampler';

/**
 * Métriques du viewer splat (10.G-V1), sans dépendance Three/Spark : l'échantillonneur reçoit
 * un `read()` branché sur le renderer (splats actifs, draw calls…) et calcule le FPS sur une
 * fenêtre glissante. Pur et testable ; la boucle de rendu appelle `frame(now)` à chaque frame,
 * les panneaux du HUD s'abonnent (aucune mesure ni émission sans abonné).
 *
 * La mécanique de fenêtre est partagée avec le viewer 3D (`three/statsSampler`) : ici on ne
 * décrit plus que les compteurs propres au nuage.
 */
export interface SplatStats {
  /** Images par seconde, moyennées sur la fenêtre d'échantillonnage. */
  fps: number;
  /** Splats rendus par Spark après tri/LOD (`SparkRenderer.activeSplats`). */
  activeSplats: number;
  /** Nombre total de splats du fichier (`PackedSplats.numSplats`). */
  totalSplats: number;
  /** Draw calls WebGL de la dernière frame (`renderer.info.render.calls`). */
  calls: number;
}

export type StatsSampler = Sampler<Omit<SplatStats, 'fps'>>;

export function createStatsSampler(read: () => Omit<SplatStats, 'fps'>, intervalMs = 500): StatsSampler {
  return createSampler(read, intervalMs);
}
