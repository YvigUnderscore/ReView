// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Règles pures du modèle « dans / hors caméra » (Phase 50, lot 7). Le modèle complet est décrit en
 * tête de `viewer/useLayoutMode.ts`, sa source de vérité ; on ne trouve ici que les deux décisions
 * qui se prennent ailleurs et méritent d'être testées seules.
 */

/**
 * Faut-il poser une clé en réglant la focale ou le tilt ?
 *
 * Hors caméra, la caméra du plan n'existe que par l'animation : sa focale est la valeur
 * échantillonnée du canal `fov`, et la pose de base d'où retombent les canaux vides n'est pas
 * persistée. Écrire sur la caméra libre n'y change donc **rien** — le panneau affichait la valeur
 * du plan et écrivait à côté. Dans la caméra, l'ancienne règle vaut toujours : la caméra libre
 * *est* la caméra du plan, et seul l'auto-key armé transforme un réglage en clé.
 */
export function shouldKeyLens(layoutMode: boolean, autoKey: boolean): boolean {
  return layoutMode || autoKey;
}

/**
 * Temps (ms) auquel un drag du gizmo de la caméra-objet écrit ses clés : celui de la clé
 * sélectionnée si le geste en reprend une, sinon la tête de lecture.
 *
 * L'animation vide forçait auparavant `t = 0`, quelle que soit la tête de lecture : impossible de
 * commencer une animation ailleurs qu'au premier instant.
 */
export function gizmoKeyTime(selectedKeyTime: number | undefined, playheadMs: number): number {
  return Math.max(0, Math.round(selectedKeyTime ?? playheadMs));
}
