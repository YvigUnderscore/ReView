// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Box, FileVideo, Image, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';
import type { MediaKind, VersionStatus } from '../../types/api';
import { t } from '../../i18n';

/**
 * Version status labels, as a function rather than a constant: a table evaluated at module load
 * would freeze the language at import, before the catalogue even arrives.
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

/** Icon representing the media type (fallback thumbnail). */
export const MEDIA_KIND_ICON: Record<
  MediaKind,
  ComponentType<{ size?: number | string; className?: string }>
> = {
  VIDEO: FileVideo,
  IMAGE: Image,
  MODEL_3D: Box,
  SPLAT: Sparkles,
};
