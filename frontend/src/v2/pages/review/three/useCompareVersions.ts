// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import type { MediaSummary } from '../../../types/api';

/**
 * Médias d'**autres versions** retenus pour la comparaison spatiale (3D et splat).
 *
 * La comparaison A/B ne franchissait pas la frontière de version : les deux viewers ne
 * listaient que les frères de la version courante, alors que le cas de review le plus
 * courant est v003 contre v004 du même asset. Le sélecteur de versions (`CompareSelect`),
 * jusque-là réservé à la vidéo et à l'image, alimente maintenant cette liste ; le reste de la
 * mécanique (chargement dans la scène commune, fondu, côte à côte, caméra liée) ne change pas.
 *
 * Le résumé du média est mémorisé avec son identifiant : le sélecteur l'a déjà résolu depuis
 * le détail de la version, inutile de le redemander pour afficher son nom dans la barre.
 */
export function useCompareVersions() {
  const [extras, setExtras] = useState<MediaSummary[]>([]);

  const add = useCallback((id: number, media?: MediaSummary) => {
    if (!media) return;
    setExtras((list) => (list.some((m) => m.id === id) ? list : [...list, media]));
  }, []);

  const remove = useCallback((id: number) => {
    setExtras((list) => list.filter((m) => m.id !== id));
  }, []);

  /** Remplacement exclusif (sémantique A/B simple du sélecteur mono-version). */
  const set = useCallback((id: number | null, media?: MediaSummary) => {
    setExtras(id == null || !media ? [] : [media]);
  }, []);

  return { extras, ids: extras.map((m) => m.id), add, remove, set };
}

export type CompareVersionsState = ReturnType<typeof useCompareVersions>;

/**
 * Liste comparée = frères de la version courante puis médias des autres versions, sans
 * doublon (un même média peut être atteint par les deux chemins) et dans un ordre stable —
 * la barre de comparaison est une liste d'onglets, elle ne doit pas se réordonner.
 */
export function mergeCompareMedia(
  siblings: readonly MediaSummary[],
  extras: readonly MediaSummary[],
): MediaSummary[] {
  const seen = new Set(siblings.map((m) => m.id));
  return [...siblings, ...extras.filter((m) => !seen.has(m.id))];
}
