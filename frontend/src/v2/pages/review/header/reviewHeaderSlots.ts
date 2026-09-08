// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Emplacements que la page de review confie au chrome du viewer monté.
 *
 * La review empilait deux en-têtes : celui de la page (média, version, présence, actions) et
 * celui du chrome (bascule de mode, A/B du viewer). Les faire fusionner par prop aurait
 * imposé de traverser `ReviewViewer` puis chacune des quatre branches — vidéo, image, 3D,
 * splat — avec trois nœuds de plus, alors que la page les rend déjà. Le contexte les pose
 * une fois ; `ReviewChrome` les récupère, quel que soit le viewer qui l'a monté.
 *
 * Hors review (lecteur de montage), le contexte est absent : le chrome retombe sur ses props.
 */
export interface ReviewHeaderSlots {
  /** Nom du média, brouillon, version, playlist, montage — à gauche. */
  identity: ReactNode;
  /** A/B des médias plats, ShotGrid, live, présence, publication, actions — à droite. */
  actions: ReactNode;
  /** Panneau de commentaires, dernière colonne du chrome. `null` quand il est replié. */
  comments: ReactNode;
}

export const ReviewHeaderSlotsContext = createContext<ReviewHeaderSlots | null>(null);

/** Emplacements fournis par la page, ou `null` hors review. */
export function useReviewHeaderSlots(): ReviewHeaderSlots | null {
  return useContext(ReviewHeaderSlotsContext);
}
