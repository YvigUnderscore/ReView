// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BakedSplat } from './bakeSplats';

/**
 * Écriture d'un fichier **.spz** (format compact Spark, conteneur gzip ~10× plus petit que le
 * PLY, chargé nativement) depuis des splats cuits — 41.C. Glue mince sur `SpzWriter` de Spark
 * (importé dynamiquement, hors bundle initial).
 *
 * SH degré 0 : `PackedSplats.getSplat` ne restitue que la couleur de base (les harmoniques
 * sphériques vivent dans des textures séparées) — l'export conserve donc la couleur diffuse
 * mais pas la couleur vue-dépendante. Limite assumée et documentée.
 */
export async function writeSpz(splats: readonly BakedSplat[]): Promise<Uint8Array> {
  const { SpzWriter } = await import('@sparkjsdev/spark');
  const writer = new SpzWriter({
    numSplats: splats.length,
    shDegree: 0,
    fractionalBits: 12,
    flagAntiAlias: false,
  });
  for (let i = 0; i < splats.length; i++) {
    const s = splats[i]!;
    writer.setCenter(i, s.center[0], s.center[1], s.center[2]);
    writer.setScale(i, s.scales[0], s.scales[1], s.scales[2]);
    writer.setQuat(i, s.quaternion[0], s.quaternion[1], s.quaternion[2], s.quaternion[3]);
    writer.setAlpha(i, s.opacity);
    writer.setRgb(i, s.color[0], s.color[1], s.color[2]);
  }
  return writer.finalize();
}
