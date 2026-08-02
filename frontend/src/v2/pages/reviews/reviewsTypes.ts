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

/** Libellés FR des types de média (filtre + badge). */
export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  VIDEO: t('entity.video'),
  IMAGE: t('panel.image'),
  MODEL_3D: t('entity.model3d'),
  SPLAT: 'Splat',
};
