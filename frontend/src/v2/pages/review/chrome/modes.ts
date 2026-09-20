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
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind, Role } from '../../../types/api';
import type { MessageKey } from '../../../i18n';

/**
 * Bascule de mode — l'emplacement qui décide de ce qui existe à l'écran. Les modes sont pris
 * aux touches numériques dans tous les viewers, dans l'ordre de la bascule — trois en spatial,
 * deux sur un média plat (`switcherModesFor`, qui ne liste pas « Annoter »).
 *
 * Le premier mode (`explore`) est le seul servi aux clients : `role === 'CLIENT'` ne voit pas
 * la bascule et reste en lecture seule.
 */
export type ModeId = 'explore' | 'annotate' | 'compare' | 'stage' | 'clean';

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

/**
 * Les médias plats ont les mêmes trois modes. L'image avait perdu « Ajuster » en D1 (une
 * pipette et un zoom pour une aide qui promettait exposition, gamma et canaux) ; la vidéo a
 * perdu « Découpe » en Phase 50 — la coupe non destructive n'était utilisable qu'avant
 * publication, et le média naît publié depuis que `draftMode` est éteint par défaut.
 */
function mediaModes(kind: MediaKind): ReviewMode[] {
  return [
    {
      value: 'explore',
      labelKey: 'mode.watch',
      icon: kind === 'VIDEO' ? Play : Eye,
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
  ];
}

/** Tous les modes valides d'un type de média — y compris « Annoter », non listé en bascule. */
export function modesFor(kind: MediaKind): ReviewMode[] {
  return isSpatialKind(kind) ? SPATIAL_MODES : mediaModes(kind);
}

/**
 * Modes réellement atteignables. « Compare » exige une version voisine : sans elle, le mode
 * s'armait sur rien — le sélecteur de comparaison disparaissait au même moment, et l'on
 * restait bloqué dans un mode qui ne montrait aucune comparaison. `canCompare` vient du hook
 * qui liste les voisins (`useCompareTargets`), seul juge de la question.
 */
export function allowedModesFor(kind: MediaKind, canCompare = true): ReviewMode[] {
  return modesFor(kind).filter((m) => canCompare || m.value !== 'compare');
}

/**
 * Modes proposés par la bascule d'en-tête et les touches numériques. « Annoter » n'y figure
 * plus : l'annotation s'arme depuis l'espace commentaire (bouton du composer, clic droit) ou
 * par le raccourci d'un outil de tracé — le mode reste valide, simplement non listé.
 */
export function switcherModesFor(kind: MediaKind, canCompare = true): ReviewMode[] {
  return allowedModesFor(kind, canCompare).filter((m) => m.value !== 'annotate');
}

/** Mode par défaut — celui servi aux clients. */
export const DEFAULT_MODE: ModeId = 'explore';

/**
 * La bascule de mode est-elle offerte ? Le client reste en exploration, en lecture seule ;
 * et un segment unique ne bascule vers rien — le montage, qui n'a qu'un mode, s'en passe.
 */
export function canSwitchMode(role: Role, modeCount: number): boolean {
  return role !== 'CLIENT' && modeCount > 1;
}
