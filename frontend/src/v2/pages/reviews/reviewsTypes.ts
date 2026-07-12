import type { MediaKind, ProjectRef } from '../../types/api';

/** Item de la page Reviews globale (12.C) — construit par MediaService.listReviews. */
export interface ReviewItem {
  id: number;
  kind: MediaKind;
  name: string;
  published: boolean;
  createdAt: string;
  thumbnailUrl: string | null;
  location: string;
  versionName: string;
  project: ProjectRef | null;
  uploader: string | null;
}

/** Libellés FR des types de média (filtre + badge). */
export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  VIDEO: 'Vidéo',
  IMAGE: 'Image',
  MODEL_3D: 'Modèle 3D',
  SPLAT: 'Splat',
};
