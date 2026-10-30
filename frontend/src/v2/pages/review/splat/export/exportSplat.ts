// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData, SplatTransform } from '../../reviewTypes';
import type { SplatSceneHandle } from '../useSplat';
import { bakeSplats } from './bakeSplats';
import { writeSpz } from './writeSpz';
import { t } from '@/v2/i18n';

/**
 * Client-side splat export (41.A/C): reads the viewer's **edited** splats, applies the persisted
 * edits and writes a cleaned **.spz** downloaded by the browser. 100% local: the original file in
 * MinIO is never touched (publication lock respected by construction).
 */

/** Effective edits to bake into the export (global TRS and crop volumes). */
export interface ExportEdits {
  transform: SplatTransform | null;
  volumes: SdfVolumeData[];
}

/** Name of the exported file: original base (without extension) + suffix + `.spz`. */
export function cleanExportName(originalName: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, '').trim() || 'splat';
  return `${base}-nettoye.spz`;
}

/** Triggers the browser download of a binary (Blob → temporary link). */
export function downloadBytes(bytes: Uint8Array, fileName: string, type = 'application/octet-stream'): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Gives the download time to start before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Bakes the viewer's edited splats into a cleaned .spz binary (bytes and number of splats kept). */
export async function buildCleanSpz(
  handle: SplatSceneHandle,
  edits: ExportEdits,
): Promise<{ bytes: Uint8Array; kept: number }> {
  const packed = handle.mesh.packedSplats;
  if (!packed) throw new Error(t('review.splat.notLoaded'));
  const baked = bakeSplats(handle.THREE, (cb) => packed.forEachSplat(cb), {
    transform: edits.transform,
    volumes: edits.volumes,
  });
  if (baked.length === 0) throw new Error(t('splat.nothingToExport'));
  const bytes = await writeSpz(baked);
  return { bytes, kept: baked.length };
}
