// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from '../../../types/api';

/**
 * Touches que le transport revendique, par type de média (D1).
 *
 * Le rail cherchait la lettre d'un outil **dans tous les modes** et basculait vers celui
 * qui la porte. Sur une vidéo, presser `I` posait donc le point d'entrée de la boucle —
 * geste du transport — *et* faisait basculer tout l'écran en mode Découpe. Deux réponses
 * pour une frappe, dont une que personne n'avait demandée.
 *
 * Ces touches restent actives dans le mode qui les porte : en mode Découpe, `I` pose bien
 * le point d'entrée du trim. C'est seulement le saut d'un mode à l'autre qui les ignore.
 */

/** Transport vidéo : boucle (I/O), lecture navette (J/K/L). */
const VIDEO_TRANSPORT = new Set(['I', 'O', 'J', 'K', 'L']);

export function reservedKeys(kind: MediaKind): ReadonlySet<string> {
  return kind === 'VIDEO' ? VIDEO_TRANSPORT : EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Cette frappe peut-elle faire changer de mode ? Non si le transport du média la
 * revendique — le mode courant, lui, garde la main sur ses propres outils.
 */
export function canSwitchModeWith(kind: MediaKind, key: string, sameMode: boolean): boolean {
  return sameMode || !reservedKeys(kind).has(key.toUpperCase());
}
