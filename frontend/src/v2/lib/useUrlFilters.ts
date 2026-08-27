// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EMPTY_FILTERS, type EntityFilterState } from './entityFilters';

/**
 * Les filtres d'une liste, portés par l'URL plutôt que par un `useState`.
 *
 * La page projet a fait ce choix pour son onglet courant (`?tab=shots`) et l'a documenté :
 * un lien se partage, un rechargement retrouve son écran, et les boutons Précédent/Suivant
 * du navigateur font ce qu'on attend d'eux. Les listes, elles, gardaient leurs filtres en
 * état React : appliquer « Waiting to Start » puis envoyer le lien à un collègue lui
 * ouvrait la liste entière, et un simple F5 effaçait le tri qu'on venait de poser.
 *
 * Les vues sauvegardées ne remplacent pas ce besoin : elles sont personnelles, nommées et
 * volontaires, là où l'on veut souvent partager un état passager.
 *
 * Les filtres vides ne sont pas écrits : l'URL d'une liste sans filtre reste propre.
 * Le préfixe permet à deux listes d'une même page (Shots et Assets d'un projet) de ne pas
 * se marcher dessus.
 */
export function useUrlFilters(prefix = ''): [EntityFilterState, (next: EntityFilterState) => void] {
  const [params, setParams] = useSearchParams();
  const key = useCallback((field: string) => (prefix ? `${prefix}_${field}` : field), [prefix]);

  const filters = useMemo(() => {
    const out = { ...EMPTY_FILTERS };
    for (const field of Object.keys(EMPTY_FILTERS) as (keyof EntityFilterState)[]) {
      out[field] = params.get(key(field)) ?? '';
    }
    return out;
  }, [params, key]);

  const setFilters = useCallback(
    (next: EntityFilterState) => {
      const updated = new URLSearchParams(params);
      for (const field of Object.keys(EMPTY_FILTERS) as (keyof EntityFilterState)[]) {
        const value = next[field];
        if (value) updated.set(key(field), value);
        else updated.delete(key(field));
      }
      // `replace` : filtrer n'est pas naviguer. Sans cela, revenir en arrière obligerait à
      // défaire une à une chaque frappe de la recherche libre.
      setParams(updated, { replace: true });
    },
    [params, setParams, key],
  );

  return [filters, setFilters];
}
