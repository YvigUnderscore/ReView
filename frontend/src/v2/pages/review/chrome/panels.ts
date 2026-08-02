// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Axis3d,
  Columns2,
  Download,
  Eye,
  Grid3x3,
  Image,
  Info,
  Play,
  Sun,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { MediaKind } from '../../../types/api';
import { isSpatialKind } from './modes';
import type { MessageKey } from '../../../i18n';

/**
 * Dock inspecteur — les réglages qui ne sont **pas** des outils : ce qu'on règle une fois et
 * qu'on oublie, par opposition au rail où l'on arme un geste. Un seul panneau ouvert à la
 * fois ; le dock se replie sur sa bande d'onglets de 44 px.
 */
export type PanelId =
  | 'playback'
  | 'view'
  | 'image'
  | 'guides'
  | 'compare'
  | 'info'
  | 'export'
  | 'camera'
  | 'light'
  | 'display'
  | 'scene';

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

const MEDIA_PANELS = (kind: MediaKind): ReviewPanel[] => [
  kind === 'VIDEO'
    ? { id: 'playback', labelKey: 'panel.playback', icon: Play }
    : { id: 'view', labelKey: 'panel.display', icon: Eye },
  { id: 'image', labelKey: 'panel.image', icon: Image },
  { id: 'guides', labelKey: 'panel.guides', icon: Grid3x3 },
  { id: 'compare', labelKey: 'panel.compare', icon: Columns2 },
  INFO,
  EXPORT,
];

/** Panneaux du dock pour un type de média, dans l'ordre d'affichage. */
export function panelsFor(kind: MediaKind): ReviewPanel[] {
  if (!isSpatialKind(kind)) return MEDIA_PANELS(kind);
  return SPATIAL_PANELS.filter((p) => p.id !== 'light' || kind === 'MODEL_3D');
}
