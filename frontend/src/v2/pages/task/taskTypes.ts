// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Box, FileVideo, Image, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';
import type { MediaKind, VersionStatus } from '../../types/api';
import { t } from '../../i18n';

/**
 * Libellés de statut de version, en fonction et non en constante : une table évaluée au
 * chargement du module fige la langue à l'import, avant même l'arrivée du catalogue.
 */
export function versionStatusLabels(tr: typeof t): Record<VersionStatus, string> {
  return {
    DRAFT: tr('reviews.draft'),
    REVIEW: tr('version.inReview'),
    PUBLISHED: tr('version.publishedFem'),
  };
}
export const VERSION_STATUS_COLOR: Record<VersionStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  REVIEW: 'bg-warning/15 text-warning',
  PUBLISHED: 'bg-success/15 text-success',
};
export const VERSION_STATUS_DOT: Record<VersionStatus, string> = {
  DRAFT: 'bg-muted-foreground/50',
  REVIEW: 'bg-warning',
  PUBLISHED: 'bg-success',
};

/** Icône représentant le type de média (vignette de repli). */
export const MEDIA_KIND_ICON: Record<
  MediaKind,
  ComponentType<{ size?: number | string; className?: string }>
> = {
  VIDEO: FileVideo,
  IMAGE: Image,
  MODEL_3D: Box,
  SPLAT: Sparkles,
};
