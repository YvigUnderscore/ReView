// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, ProjectRef, ReviewStatus } from '../../types/api';
import { t } from '../../i18n';

/** Sprite de miniatures (grille count = cols×rows) pour le scrub au survol (42.A — №78). */
export interface HoverSprite {
  url: string;
  count: number;
  cols: number;
  rows: number;
}

/** Item de la page Reviews globale (12.C) — construit par MediaService.listReviews. */
export interface ReviewItem {
  id: number;
  kind: MediaKind;
  name: string;
  published: boolean;
  createdAt: string;
  thumbnailUrl: string | null;
  /** Sprite de miniatures pour l'aperçu animé au survol (42.A — №78, vidéo uniquement). */
  hoverSprite: HoverSprite | null;
  location: string;
  versionName: string;
  /** Décision de review courante de la version (Phase 31), null si aucune. */
  reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  project: ProjectRef | null;
  uploader: string | null;
}

/**
 * Libellés des types de média (filtre + badge), en fonction et non en constante : une table
 * évaluée au chargement du module fige la langue à l'import, avant l'arrivée du catalogue.
 * « Splat » appartient au vocabulaire de production : il ne se traduit pas.
 */
export function mediaKindLabels(tr: typeof t): Record<MediaKind, string> {
  return {
    VIDEO: tr('entity.video'),
    IMAGE: tr('panel.image'),
    MODEL_3D: tr('entity.model3d'),
    SPLAT: 'Splat',
  };
}
