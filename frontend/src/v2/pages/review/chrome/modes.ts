import {
  Clapperboard,
  Columns2,
  Compass,
  Eye,
  PencilLine,
  Play,
  Scissors,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind } from '../../../types/api';

/**
 * Bascule de mode — l'emplacement qui décide de ce qui existe à l'écran. Les quatre types de
 * média portent les mêmes quatre modes, pris aux touches 1 à 4 dans tous les viewers.
 *
 * Le premier mode (`explore`) est le seul servi aux clients : `role === 'CLIENT'` ne voit pas
 * la bascule et reste en lecture seule.
 */
export type ModeId = 'explore' | 'annotate' | 'compare' | 'edit' | 'stage' | 'clean';

export interface ReviewMode {
  value: ModeId;
  label: string;
  icon: LucideIcon;
  /** Phrase affichée en pied de page : ce que le mode autorise, et pour qui. */
  hint: string;
}

/** Les médias plats (vidéo, image) et les médias spatiaux (3D, splat) n'ont pas les mêmes modes. */
export function isSpatialKind(kind: MediaKind): boolean {
  return kind === 'MODEL_3D' || kind === 'SPLAT';
}

const ANNOTATE_SPATIAL: ReviewMode = {
  value: 'annotate',
  label: 'Annoter',
  icon: PencilLine,
  hint: 'Peindre sur la surface, épingler un point, joindre la vue au commentaire.',
};

const SPATIAL_MODES: ReviewMode[] = [
  {
    value: 'explore',
    label: 'Explorer',
    icon: Compass,
    hint: 'Naviguer, cadrer, inspecter — aucun outil d’édition. Seul mode servi aux clients.',
  },
  ANNOTATE_SPATIAL,
  {
    value: 'stage',
    label: 'Mise en scène',
    icon: Clapperboard,
    hint: 'Caméra, animation, vues, éclairage par défaut — rejoués pour tous les spectateurs.',
  },
  {
    value: 'clean',
    label: 'Nettoyer',
    icon: Scissors,
    hint: 'Sélection, suppression, volumes de coupe, transformation — avant publication.',
  },
];

function mediaModes(kind: MediaKind): ReviewMode[] {
  const video = kind === 'VIDEO';
  return [
    {
      value: 'explore',
      label: 'Regarder',
      icon: video ? Play : Eye,
      hint: 'Lire, zoomer, comparer les versions — aucun outil d’édition. Seul mode servi aux clients.',
    },
    {
      value: 'annotate',
      label: 'Annoter',
      icon: PencilLine,
      hint: 'Dessiner sur l’image affichée : le tracé part avec le commentaire, à la frame courante.',
    },
    {
      value: 'compare',
      label: 'Comparer',
      icon: Columns2,
      hint: 'Deux versions dans le même viewer : wipe, différence ou côte à côte.',
    },
    video
      ? {
          value: 'edit',
          label: 'Découper',
          icon: Scissors,
          hint: 'Points d’entrée/sortie et plages d’annotation — avant publication.',
        }
      : {
          value: 'edit',
          label: 'Ajuster',
          icon: SlidersHorizontal,
          hint: 'Exposition, gamma, canaux : lecture d’inspection, jamais enregistrée dans le média.',
        },
  ];
}

/** Modes disponibles pour un type de média, dans l'ordre des touches 1 à 4. */
export function modesFor(kind: MediaKind): ReviewMode[] {
  return isSpatialKind(kind) ? SPATIAL_MODES : mediaModes(kind);
}

/** Mode par défaut — celui servi aux clients. */
export const DEFAULT_MODE: ModeId = 'explore';
