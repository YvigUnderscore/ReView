// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaKind } from '@prisma/client';
import { isSplatPreviewSupported } from './splatPoints';

/**
 * Routing of the jobs triggered by a media: which job of the `media-processing` queue, and whether the media
 * additionally deserves a **spatial thumbnail** (dedicated queue).
 *
 * Extracted from `services/MediaService`: the decision was a private function of the service, hence untestable and
 * impossible to reuse from the worker. It stayed strictly identical for the media queue — only the spatial thumbnail
 * is new.
 */

/** 3D formats convertible to GLB (the Three.js viewer only reads GLB) — 9.A1. */
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

/** Processing job to trigger, depending on the media type and the detected extension. */
export function jobKindFor(kind: MediaKind, ext: string): MediaJobKind | null {
  if (kind === MediaKind.VIDEO) return 'transcode';
  if (kind === MediaKind.IMAGE) return 'thumbnail';
  if (kind === MediaKind.MODEL_3D && CONVERT_3D.includes(ext)) return 'convert3d';
  return null;
}

/** Two ways of making a thumbnail of a spatial media — two unrelated pipelines. */
export type SpatialThumbSource = 'model' | 'splat';

/**
 * Does the media deserve a server-side rendered thumbnail, and through which pipeline?
 *
 * Without it, a shot page full of 3D assets shows only empty tiles until a human has opened each review to capture
 * the view by hand (`setAutoThumbnail`). Server rendering does not replace that capture: it precedes it, and never
 * overwrites it.
 *
 * `MODEL_3D` goes through Blender (the derived GLB, or the file itself if it is already a GLB); `SPLAT` through the
 * home-made point rasteriser, which can only read some containers — the others (`.spz`, `.ksplat`, `.sog`) are **not**
 * enqueued rather than failing.
 */
export function spatialThumbSource(kind: MediaKind, ext: string): SpatialThumbSource | null {
  if (kind === MediaKind.MODEL_3D) return 'model';
  if (kind === MediaKind.SPLAT && isSplatPreviewSupported(ext)) return 'splat';
  return null;
}
