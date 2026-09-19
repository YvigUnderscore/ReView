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

/**
 * Une image n'a pas de quatrième mode (D1). « Ajuster » n'exposait qu'une pipette et un
 * zoom, alors que son aide promettait exposition, gamma et canaux : un mode entier pour
 * deux outils déjà présents ailleurs, et une promesse que rien ne tenait.
 */
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
    ...(video
      ? [
          {
            value: 'edit' as const,
            labelKey: 'mode.trim' as const,
            icon: Scissors,
            hintKey: 'mode.trim.hint' as const,
          },
        ]
      : []),
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

/**
 * Modes que le verrou de publication (Phase 11) interdit — la table exacte, et rien de plus.
 *
 * Il n'en reste qu'un : `edit`, le montage d'une vidéo. Les points d'entrée/sortie écrivent
 * sur le média lui-même, et le serveur les refuse en 403 `PUBLISHED_LOCKED` dès qu'il est
 * publié. L'interface offrait pourtant le mode en entier — on posait ses points, et l'on
 * perdait son travail sur un toast d'erreur.
 *
 * `clean` n'en est plus (Phase 50) : les éditions splat — masque, sous-ensemble — ne
 * touchent jamais au fichier d'origine, elles sont rejouées pour tous, et le serveur les
 * accepte après publication. Les griser interdisait à l'écran ce que le serveur autorise.
 *
 * `stage` n'en a jamais été : la mise en scène (caméra, présentation) reste autorisée après
 * publication — le média n'est pas altéré.
 */
const PUBLICATION_LOCKED_MODES: ReadonlySet<ModeId> = new Set<ModeId>(['edit']);

/** Ce mode est-il hors d'atteinte parce que le média est publié ? */
export function isLockedByPublication(mode: ModeId, published: boolean): boolean {
  return published && PUBLICATION_LOCKED_MODES.has(mode);
}

/**
 * La bascule de mode est-elle offerte ? Le client reste en exploration, en lecture seule ;
 * et un segment unique ne bascule vers rien — le montage, qui n'a qu'un mode, s'en passe.
 */
export function canSwitchMode(role: Role, modeCount: number): boolean {
  return role !== 'CLIENT' && modeCount > 1;
}
