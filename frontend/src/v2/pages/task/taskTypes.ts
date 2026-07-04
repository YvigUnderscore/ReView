import { Box, FileVideo, Image } from 'lucide-react';
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
  REVIEW: 'bg-amber-500/20 text-amber-300',
  PUBLISHED: 'bg-green-500/20 text-green-300',
};
export const VERSION_STATUS_DOT: Record<VersionStatus, string> = {
  DRAFT: 'bg-muted-foreground/50',
  REVIEW: 'bg-amber-400',
  PUBLISHED: 'bg-green-400',
};

/** Icône représentant le type de média (vignette de repli). */
export const MEDIA_KIND_ICON: Record<
  MediaKind,
  ComponentType<{ size?: number | string; className?: string }>
> = {
  VIDEO: FileVideo,
  IMAGE: Image,
  MODEL_3D: Box,
};
