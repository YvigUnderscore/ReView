// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import type { MessageKey } from '../../../i18n';

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
  labelKey: MessageKey;
  icon: LucideIcon;
  /** Phrase affichée en pied de page : ce que le mode autorise, et pour qui. */
  hintKey: MessageKey;
}

/** Les médias plats (vidéo, image) et les médias spatiaux (3D, splat) n'ont pas les mêmes modes. */
export function isSpatialKind(kind: MediaKind): boolean {
  return kind === 'MODEL_3D' || kind === 'SPLAT';
}

const ANNOTATE_SPATIAL: ReviewMode = {
  value: 'annotate',
  labelKey: 'mode.annotate',
  icon: PencilLine,
  hintKey: 'mode.annotateSpatial.hint',
};

const SPATIAL_MODES: ReviewMode[] = [
  {
    value: 'explore',
    labelKey: 'mode.explore',
    icon: Compass,
    hintKey: 'mode.explore.hint',
  },
  ANNOTATE_SPATIAL,
  {
    value: 'stage',
    labelKey: 'mode.stage',
    icon: Clapperboard,
    hintKey: 'mode.stage.hint',
  },
  {
    value: 'clean',
    labelKey: 'mode.clean',
    icon: Scissors,
    hintKey: 'mode.clean.hint',
  },
];

function mediaModes(kind: MediaKind): ReviewMode[] {
  const video = kind === 'VIDEO';
  return [
    {
      value: 'explore',
      labelKey: 'mode.watch',
      icon: video ? Play : Eye,
      hintKey: 'mode.watch.hint',
    },
    {
      value: 'annotate',
      labelKey: 'mode.annotate',
      icon: PencilLine,
      hintKey: 'mode.annotate.hint',
    },
    {
      value: 'compare',
      labelKey: 'mode.compare',
      icon: Columns2,
      hintKey: 'mode.compare.hint',
    },
    video
      ? {
          value: 'edit',
          labelKey: 'mode.trim',
          icon: Scissors,
          hintKey: 'mode.trim.hint',
        }
      : {
          value: 'edit',
          labelKey: 'mode.adjust',
          icon: SlidersHorizontal,
          hintKey: 'mode.adjust.hint',
        },
  ];
}

/** Tous les modes valides d'un type de média — y compris « Annoter », non listé en bascule. */
export function modesFor(kind: MediaKind): ReviewMode[] {
  return isSpatialKind(kind) ? SPATIAL_MODES : mediaModes(kind);
}

/**
 * Modes proposés par la bascule d'en-tête et les touches numériques. « Annoter » n'y figure
 * plus : l'annotation s'arme depuis l'espace commentaire (bouton du composer, clic droit) ou
 * par le raccourci d'un outil de tracé — le mode reste valide, simplement non listé.
 */
export function switcherModesFor(kind: MediaKind): ReviewMode[] {
  return modesFor(kind).filter((m) => m.value !== 'annotate');
}

/** Mode par défaut — celui servi aux clients. */
export const DEFAULT_MODE: ModeId = 'explore';
