// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind, ProjectRef, ReviewStatus } from '../../types/api';
import { t } from '../../i18n';

/** Thumbnail sprite (grid count = cols×rows) for hover scrubbing (42.A — №78). */
export interface HoverSprite {
  url: string;
  count: number;
  cols: number;
  rows: number;
}

/** Item of the global Reviews page (12.C) — built by MediaService.listReviews. */
export interface ReviewItem {
  id: number;
  kind: MediaKind;
  name: string;
  published: boolean;
  createdAt: string;
  thumbnailUrl: string | null;
  /** Thumbnail sprite for the animated hover preview (42.A — №78, video only). */
  hoverSprite: HoverSprite | null;
  location: string;
  /** Version carrying the media: it is the one that receives the review decision. */
  versionId: number;
  versionName: string;
  /** Current review decision of the version (Phase 31), null if none. */
  reviewStatus: Pick<ReviewStatus, 'id' | 'name' | 'color'> | null;
  project: ProjectRef | null;
  uploader: string | null;
}

/**
 * Media type labels (filter + badge), as a function rather than a constant: a table evaluated at
 * module load would freeze the language at import, before the catalogue arrives.
 * "Splat" belongs to the production vocabulary: it is not translated.
 */
export function mediaKindLabels(tr: typeof t): Record<MediaKind, string> {
  return {
    VIDEO: tr('entity.video'),
    IMAGE: tr('panel.image'),
    MODEL_3D: tr('entity.model3d'),
    SPLAT: 'Splat',
  };
}

/** The five filters of the Reviews page ("" = inactive), as they go into the URL. */
// A type alias, not an interface: saved views handle it as a plain bag of strings
// (`Record<string, string>`), which an interface is not assignable to for lack of an implicit index.
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
 * Filters restored from a saved view.
 *
 * A view is a bag of strings written by an earlier version of the page: only the filters that
 * still exist are kept, and any missing filter returns to empty — otherwise a vanished filter
 * would stay active without being displayed anywhere.
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
