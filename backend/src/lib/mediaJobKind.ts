// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind } from '@prisma/client';
import { isSplatPreviewSupported } from './splatPoints';

/**
 * Aiguillage des travaux déclenchés par un média : quel job de la file `media-processing`,
 * et si le média mérite en plus une **vignette spatiale** (file dédiée).
 *
 * Extrait de `services/MediaService` : la décision était une fonction privée du service, donc
 * intestable et impossible à réutiliser depuis le worker. Elle est restée strictement
 * identique pour la file média — seule la vignette spatiale est nouvelle.
 */

/** Formats 3D convertibles en GLB (le viewer Three.js ne lit que du GLB) — 9.A1. */
export const CONVERT_3D = [
  '.fbx',
  '.obj',
  '.usd',
  '.usda',
  '.usdc',
  '.dae',
  '.stl',
  '.gltf',
  '.zip',
  '.usdz',
];

export type MediaJobKind = 'transcode' | 'thumbnail' | 'convert3d';

/** Job de traitement à déclencher selon le type de média et l'extension détectée. */
export function jobKindFor(kind: MediaKind, ext: string): MediaJobKind | null {
  if (kind === MediaKind.VIDEO) return 'transcode';
  if (kind === MediaKind.IMAGE) return 'thumbnail';
  if (kind === MediaKind.MODEL_3D && CONVERT_3D.includes(ext)) return 'convert3d';
  return null;
}

/** Deux façons de fabriquer une vignette d'un média spatial — deux chaînes sans rapport. */
export type SpatialThumbSource = 'model' | 'splat';

/**
 * Le média mérite-t-il une vignette rendue côté serveur, et par quelle chaîne ?
 *
 * Sans cela, une page de plan pleine d'assets 3D n'affiche que des tuiles vides tant qu'un
 * humain n'a pas ouvert chaque review pour capturer la vue à la main (`setAutoThumbnail`).
 * Le rendu serveur ne remplace pas cette capture : il la devance, et ne l'écrase jamais.
 *
 * `MODEL_3D` passe par Blender (le GLB dérivé, ou le fichier lui-même s'il est déjà GLB) ;
 * `SPLAT` par le rasteriseur de points maison, qui ne sait lire que certains conteneurs —
 * les autres (`.spz`, `.ksplat`, `.sog`) ne sont **pas** enfilés plutôt que d'échouer.
 */
export function spatialThumbSource(kind: MediaKind, ext: string): SpatialThumbSource | null {
  if (kind === MediaKind.MODEL_3D) return 'model';
  if (kind === MediaKind.SPLAT && isSplatPreviewSupported(ext)) return 'splat';
  return null;
}
