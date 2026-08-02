// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SdfVolumeData, SplatTransform } from '../../reviewTypes';
import type { SplatSceneHandle } from '../useSplat';
import { bakeSplats } from './bakeSplats';
import { writeSpz } from './writeSpz';
import { t } from '../../../../i18n';

/**
 * Export splat côté client (41.A/C) — lit les splats **édités** du viewer, applique les éditions
 * persistées et écrit un **.spz** nettoyé téléchargé par le navigateur. 100 % local : le fichier
 * original dans MinIO n'est jamais touché (verrou de publication respecté par construction).
 */

/** Éditions effectives à cuire dans l'export (TRS globale + volumes de crop). */
export interface ExportEdits {
  transform: SplatTransform | null;
  volumes: SdfVolumeData[];
}

/** Nom du fichier exporté : base d'origine (sans extension) + suffixe + `.spz`. */
export function cleanExportName(originalName: string): string {
  const base = originalName.replace(/\.[^./\\]+$/, '').trim() || 'splat';
  return `${base}-nettoye.spz`;
}

/** Déclenche le téléchargement navigateur d'un binaire (Blob → lien temporaire). */
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
  // Laisse le temps au téléchargement de démarrer avant de révoquer l'URL.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Cuit les splats édités du viewer en un binaire .spz nettoyé (bytes + nombre de splats gardés). */
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
  if (baked.length === 0) throw new Error('Aucun splat à exporter (tout est masqué ou croppé)');
  const bytes = await writeSpz(baked);
  return { bytes, kept: baked.length };
}
