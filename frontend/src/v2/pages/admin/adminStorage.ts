// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { StorageAgg } from '../../types/api';
import type { MessageKey } from '../../i18n';

/** Helpers purs de la page admin Stockage (libellés, pourcentages) — testés. */

/** Clés de libellé des catégories racines du bucket. */
export const CATEGORY_LABELS: Record<string, MessageKey> = {
  originals: 'storage.cat.originals',
  derived: 'storage.cat.derived',
  studio: 'storage.cat.studio',
  avatars: 'storage.cat.avatars',
  branding: 'storage.cat.branding',
  documents: 'storage.cat.documents',
  comments: 'storage.cat.comments',
  quarantine: 'storage.cat.quarantine',
  other: 'storage.cat.other',
};

/** Clés de libellé des sous-types de dérivés (worker FFmpeg & éditeurs). */
export const DERIVED_LABELS: Record<string, MessageKey> = {
  hls: 'storage.d.hls',
  thumbnails: 'storage.d.thumbnails',
  glb: 'storage.d.glb',
  proxies: 'storage.d.proxies',
  client: 'storage.d.client',
  sprites: 'storage.d.sprites',
  references: 'storage.d.references',
  'splat-edits': 'storage.d.splatEdits',
  other: 'storage.d.other',
};

/** Clés de libellé des bibliothèques studio. */
export const STUDIO_LABELS: Record<string, MessageKey> = {
  hdris: 'storage.s.hdris',
  ocio: 'storage.s.ocio',
  other: 'storage.s.other',
};

/** Pourcentage entier (0–100) d'une part sur un total (0 si total nul). */
export function pctOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

/** Entrées d'un agrégat triées par poids décroissant, avec libellé et pourcentage. */
export function sortedEntries(
  agg: Record<string, StorageAgg>,
  labels: Record<string, MessageKey>,
  total: number,
): { key: string; labelKey: MessageKey | null; count: number; bytes: number; pct: number }[] {
  return Object.entries(agg)
    .map(([key, v]) => ({
      key,
      labelKey: labels[key] ?? null,
      count: v.count,
      bytes: v.bytes,
      pct: pctOf(v.bytes, total),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}
