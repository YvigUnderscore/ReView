// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EMPTY_FILTERS, type ReviewsFilterState } from './reviewsTypes';

/**
 * Les filtres de la page Reviews, dans l'URL.
 *
 * Ils vivaient dans un `useState` : la page ignorait complètement la query-string, à la
 * lecture comme à l'écriture. Conséquences en cascade — aucune carte de l'Accueil ne pouvait
 * ouvrir une vue filtrée (le seul lien possible était « tout »), un état de recherche ne se
 * partageait ni ne se mettait en favori, et le retour arrière du navigateur quittait la page
 * au lieu de défaire le dernier filtre.
 *
 * L'URL devient donc la seule source : plus d'état local à synchroniser, donc aucune
 * divergence possible entre ce que dit l'adresse et ce que montre la liste.
 *
 * Les clés sont dérivées de `EMPTY_FILTERS` : un filtre ajouté à la page est porté par l'URL
 * sans qu'on ait à y penser — une liste recopiée ici aurait fini par en oublier un.
 */
const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ReviewsFilterState)[];

/** Les filtres tels que l'adresse les décrit ; tout paramètre absent revient à vide. */
export function filtersFromSearch(search: URLSearchParams): ReviewsFilterState {
  const out = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) out[key] = search.get(key) ?? '';
  return out;
}

/**
 * L'adresse mise à jour par un jeu de filtres. Les paramètres étrangers à la page sont
 * conservés : ils appartiennent à l'appelant, pas aux filtres.
 */
export function searchWithFilters(search: URLSearchParams, filters: ReviewsFilterState): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/**
 * La query-string envoyée au serveur : les filtres actifs seulement, dans un ordre stable
 * — c'est aussi la clé de cache de la liste, qui ne doit pas changer de forme selon la
 * manière dont l'adresse a été écrite.
 */
export function apiQuery(filters: ReviewsFilterState): string {
  return searchWithFilters(new URLSearchParams(), filters).toString();
}
