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
  /** Version portant le média : c'est elle qui reçoit la décision de review. */
  versionId: number;
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

/** Les cinq filtres de la page Reviews (« » = inactif), tels qu'ils vont dans l'URL. */
// Un alias de type, non une interface : les vues enregistrées les manipulent comme un
// simple sac de chaînes (`Record<string, string>`), auquel une interface n'est pas
// assignable faute d'index implicite.
export type ReviewsFilterState = {
  projectId: string;
  kind: string;
  status: string;
  decision: string;
  assigned: string;
};

export const EMPTY_FILTERS: ReviewsFilterState = {
  projectId: '',
  kind: '',
  status: '',
  decision: '',
  assigned: '',
};

/**
 * Filtres restitués depuis une vue enregistrée.
 *
 * Une vue est un sac de chaînes écrit par une version antérieure de la page : on n'en
 * retient que les filtres qui existent encore, et tout filtre absent revient à vide —
 * sans quoi un filtre disparu resterait actif sans être affiché nulle part.
 */
export function filtersFrom(saved: Record<string, string>): ReviewsFilterState {
  return {
    projectId: saved.projectId ?? '',
    kind: saved.kind ?? '',
    status: saved.status ?? '',
    decision: saved.decision ?? '',
    assigned: saved.assigned ?? '',
  };
}
