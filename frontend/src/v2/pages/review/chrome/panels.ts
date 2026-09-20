// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Axis3d, Download, Info, Sun, Video, type LucideIcon } from 'lucide-react';
import type { MediaKind } from '../../../types/api';
import { isSpatialKind } from './modes';
import type { MessageKey } from '../../../i18n';

/**
 * Dock inspecteur — les réglages qui ne sont **pas** des outils : ce qu'on règle une fois et
 * qu'on oublie, par opposition au rail où l'on arme un geste. Un seul panneau ouvert à la
 * fois ; le dock se replie sur sa bande d'onglets de 44 px.
 */
export type PanelId = 'info' | 'export' | 'camera' | 'light' | 'scene';

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
  { id: 'scene', labelKey: 'panel.scene', icon: Axis3d },
  INFO,
  EXPORT,
];

/**
 * Dock des médias plats : **Infos et Export**, rien d'autre. Les cinq onglets qui s'y
 * trouvaient ont tous disparu en Phase 50, chacun pour la même raison — ils redisaient ce que
 * le lecteur a déjà sous les yeux, ou ils réglaient au dock ce qu'on règle mieux sur l'image :
 *
 *   - « Comparaison » redisait l'en-tête sans offrir de version B — le choix vit désormais dans
 *     la barre d'options du mode « Compare » ;
 *   - « Affichage » annonçait sur une image fixe une cadence et une vitesse de lecture qui
 *     n'existent pas ;
 *   - « Lecture » n'affichait que la cadence, déjà dans la fiche technique de l'onglet Infos ;
 *   - « Repères » doublait le clic droit du viewer, où les quatre interrupteurs vivent pour les
 *     deux médias plats ;
 *   - « Image » — le panneau Color — offrait un display/view, une exposition et un gamma au
 *     moment de la review. Choix de l'utilisateur, fait en connaissance de la conséquence :
 *     la gestion couleur reste celle du **projet** (`ProjectColorSection`), qui continue de
 *     s'appliquer au viewer image ; c'est le réglage au coup par coup qui part.
 */
const MEDIA_PANELS: ReviewPanel[] = [INFO, EXPORT];

/**
 * Panneaux du dock pour un type de média, dans l'ordre d'affichage.
 *
 * Un seul écart entre les deux médias spatiaux : **Éclairage** n'existe que sur un modèle, un
 * nuage portant sa lumière cuite.
 *
 * L'onglet **Affichage** a quitté le dock des deux : il réglait à dix-sept centimètres du média,
 * derrière un repli, des bascules qu'on essaie en rafale en le regardant. Ses réglages n'ont pas
 * disparu — ils sont passés en popover au coin haut-gauche du viewer, avec le même
 * `DisplayPanel` dedans (3D au lot 6 : `Model3DRenderMenu` ; splat au lot 12 :
 * `SplatViewerMenus`), pour qu'un réglage ajouté demain arrive aux deux ou à aucun.
 */
export function panelsFor(kind: MediaKind): ReviewPanel[] {
  if (!isSpatialKind(kind)) return MEDIA_PANELS;
  return SPATIAL_PANELS.filter((p) => p.id !== 'light' || kind === 'MODEL_3D');
}
