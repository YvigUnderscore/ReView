// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Box, FileVideo, Image, Sparkles } from 'lucide-react';
import type { ComponentType } from 'react';
import type { MediaKind, VersionStatus } from '../../types/api';

/** Libellés/couleurs de statut de version (tokenisés) pour la timeline. */
export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  DRAFT: 'Brouillon',
  REVIEW: 'En review',
  PUBLISHED: 'Publiée',
};
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
