import type { StorageAgg } from '../../types/api';

/** Helpers purs de la page admin Stockage (libellés, pourcentages) — testés. */

/** Libellés français des catégories racines du bucket. */
export const CATEGORY_LABELS: Record<string, string> = {
  originals: 'Originaux (projects/)',
  derived: 'Dérivés (derived/)',
  studio: 'Bibliothèques studio (studio/)',
  avatars: 'Avatars (avatars/)',
  branding: 'Identité visuelle (branding/)',
  documents: 'Documents (documents/)',
  comments: 'Pièces jointes commentaires (comments/)',
  quarantine: 'Quarantaine antivirus (quarantine/)',
  other: 'Autres objets',
};

/** Libellés français des sous-types de dérivés (worker FFmpeg & éditeurs). */
export const DERIVED_LABELS: Record<string, string> = {
  hls: 'Renditions HLS (streaming vidéo)',
  thumbnails: 'Miniatures',
  glb: 'GLB convertis (3D / USD)',
  proxies: 'Proxies vidéo',
  client: 'MP4 clients (burn-ins)',
  sprites: 'Sprites de timeline',
  references: 'Images de référence (review 2D)',
  'splat-edits': 'Éditions splat (masques/TRS)',
  other: 'Autres dérivés',
};

/** Libellés des bibliothèques studio. */
export const STUDIO_LABELS: Record<string, string> = {
  hdris: 'HDRI (éclairage 3D)',
  ocio: 'Configs OCIO (couleur)',
  other: 'Autres',
};

/** Pourcentage entier (0–100) d'une part sur un total (0 si total nul). */
export function pctOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

/** Entrées d'un agrégat triées par poids décroissant, avec libellé et pourcentage. */
export function sortedEntries(
  agg: Record<string, StorageAgg>,
  labels: Record<string, string>,
  total: number,
): { key: string; label: string; count: number; bytes: number; pct: number }[] {
  return Object.entries(agg)
    .map(([key, v]) => ({
      key,
      label: labels[key] ?? key,
      count: v.count,
      bytes: v.bytes,
      pct: pctOf(v.bytes, total),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}
