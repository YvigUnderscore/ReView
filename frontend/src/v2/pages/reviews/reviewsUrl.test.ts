// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { apiQuery, filtersFromSearch, searchWithFilters } from './reviewsUrl';
import { EMPTY_FILTERS } from './reviewsTypes';

/**
 * Les filtres de la page Reviews vivaient dans un `useState` : l'adresse était ignorée,
 * en lecture comme en écriture. Aucun compteur de l'Accueil ne pouvait donc ouvrir une vue
 * filtrée, et le retour arrière du navigateur quittait la page au lieu de défaire un filtre.
 */

describe('filtersFromSearch — l’adresse décide', () => {
  it('lit les cinq filtres, et rend vide tout ce qu’elle ne dit pas', () => {
    const filters = filtersFromSearch(new URLSearchParams('assigned=me&decision=none'));
    expect(filters).toEqual({ ...EMPTY_FILTERS, assigned: 'me', decision: 'none' });
  });

  it('ignore les paramètres qui ne sont pas des filtres', () => {
    expect(filtersFromSearch(new URLSearchParams('tab=grid'))).toEqual(EMPTY_FILTERS);
  });
});

describe('searchWithFilters — l’adresse suit', () => {
  it('écrit les filtres actifs et retire ceux qu’on vient de vider', () => {
    const before = new URLSearchParams('kind=VIDEO&decision=none');
    const after = searchWithFilters(before, { ...EMPTY_FILTERS, kind: 'IMAGE' });
    expect(after.get('kind')).toBe('IMAGE');
    expect(after.has('decision')).toBe(false);
  });

  it('conserve les paramètres étrangers : ils appartiennent à l’appelant', () => {
    const after = searchWithFilters(new URLSearchParams('from=home'), {
      ...EMPTY_FILTERS,
      assigned: 'me',
    });
    expect(after.get('from')).toBe('home');
    expect(after.get('assigned')).toBe('me');
  });

  it('fait l’aller-retour sans rien perdre', () => {
    const filters = { projectId: '7', kind: 'IMAGE', status: 'published', decision: '3', assigned: 'me' };
    expect(filtersFromSearch(searchWithFilters(new URLSearchParams(), filters))).toEqual(filters);
  });
});

describe('apiQuery — la clé de cache et la requête', () => {
  it('n’emporte que les filtres actifs, dans un ordre stable', () => {
    // L'ordre ne doit pas dépendre de la manière dont l'adresse a été écrite : deux URL
    // équivalentes doivent donner la même clé de cache, donc la même liste.
    const posé = { ...EMPTY_FILTERS, assigned: 'me', kind: 'VIDEO' };
    expect(apiQuery(posé)).toBe('kind=VIDEO&assigned=me');
    expect(apiQuery(filtersFromSearch(new URLSearchParams('assigned=me&kind=VIDEO')))).toBe(apiQuery(posé));
  });

  it('est vide quand aucun filtre n’est posé', () => {
    expect(apiQuery(EMPTY_FILTERS)).toBe('');
  });
});
