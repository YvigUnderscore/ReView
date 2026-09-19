// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Axis3d, Download, Eye, Grid3x3, Image, Info, Play, Sun, Video, type LucideIcon } from 'lucide-react';
import type { MediaKind } from '../../../types/api';
import { isSpatialKind } from './modes';
import type { MessageKey } from '../../../i18n';

/**
 * Dock inspecteur — les réglages qui ne sont **pas** des outils : ce qu'on règle une fois et
 * qu'on oublie, par opposition au rail où l'on arme un geste. Un seul panneau ouvert à la
 * fois ; le dock se replie sur sa bande d'onglets de 44 px.
 */
export type PanelId =
  'playback' | 'image' | 'guides' | 'info' | 'export' | 'camera' | 'light' | 'display' | 'scene';

export interface ReviewPanel {
  id: PanelId;
  labelKey: MessageKey;
  icon: LucideIcon;
}

const INFO: ReviewPanel = { id: 'info', labelKey: 'panel.info', icon: Info };
const EXPORT: ReviewPanel = { id: 'export', labelKey: 'panel.export', icon: Download };

const SPATIAL_PANELS: ReviewPanel[] = [
  { id: 'camera', labelKey: 'panel.camera', icon: Video },
  // L'éclairage n'a de sens que sur un modèle : un splat porte sa propre lumière cuite.
  { id: 'light', labelKey: 'panel.lighting', icon: Sun },
  { id: 'display', labelKey: 'panel.display', icon: Eye },
  { id: 'scene', labelKey: 'panel.scene', icon: Axis3d },
  INFO,
  EXPORT,
];

const COLOR: ReviewPanel = { id: 'image', labelKey: 'panel.image', icon: Image };

/**
 * Dock des médias plats. Trois onglets sont tombés côté image (Phase 50) : « Comparaison »
 * redisait l'en-tête sans offrir de B — le choix vit maintenant dans la barre d'options du
 * mode « Compare » ; « Affichage » annonçait une cadence et une vitesse de lecture qui
 * n'existent pas sur une image fixe ; « Repères » n'avait aucun effet, l'overlay n'étant
 * monté que dans le lecteur vidéo — il est désormais monté sur l'image, et ses interrupteurs
 * vivent au clic droit.
 */
const MEDIA_PANELS = (kind: MediaKind): ReviewPanel[] =>
  kind === 'VIDEO'
    ? [
        { id: 'playback', labelKey: 'panel.playback', icon: Play },
        COLOR,
        { id: 'guides', labelKey: 'panel.guides', icon: Grid3x3 },
        INFO,
        EXPORT,
      ]
    : [COLOR, INFO, EXPORT];

/** Panneaux du dock pour un type de média, dans l'ordre d'affichage. */
export function panelsFor(kind: MediaKind): ReviewPanel[] {
  if (!isSpatialKind(kind)) return MEDIA_PANELS(kind);
  return SPATIAL_PANELS.filter((p) => p.id !== 'light' || kind === 'MODEL_3D');
}
