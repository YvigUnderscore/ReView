// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { PublishContext, ZoneContext, commonZone, type PublishZone, type Size } from './compareFit';

/**
 * Ajustement **partagé** des panes d'une comparaison (côte-à-côte comme grille 2×2).
 *
 * Chaque pane mesure sa zone et l'inscrit ici ; tous ajustent ensuite leur média dans la zone
 * commune. Conséquence voulue : deux médias de résolutions différentes s'affichent à la **même
 * taille**, et l'aspect de chacun reste le sien — l'ajustement est un « contain », il ne
 * déforme rien, et le cadre de livraison comme les annotations normalisées suivent la boîte
 * sans changer de proportions.
 *
 * Hors comparaison, un seul pane est inscrit : la zone commune est la sienne, rien ne change.
 */
export function CompareFitProvider({ children }: { children: ReactNode }) {
  const [zones, setZones] = useState<Record<string, Size>>({});

  const publish = useCallback<PublishZone>((id, size) => {
    setZones((prev) => {
      const known = prev[id];
      if (size == null) {
        if (!known) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      // Même mesure : on rend l'objet d'origine, sinon chaque impulsion de l'observateur
      // relancerait un rendu de tous les panes pour rien.
      if (known && known.w === size.w && known.h === size.h) return prev;
      return { ...prev, [id]: size };
    });
  }, []);

  const zone = useMemo(() => commonZone(Object.values(zones)), [zones]);

  return (
    <PublishContext.Provider value={publish}>
      <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>
    </PublishContext.Provider>
  );
}
