// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { apiQuery, filtersFromSearch, searchWithFilters } from './reviewsUrl';
import { EMPTY_FILTERS } from './reviewsTypes';

/**
 * The Reviews page filters used to live in a `useState`: the address was ignored, both when
 * reading and when writing. No Home counter could therefore open a filtered view, and the
 * browser's back button left the page instead of undoing a filter.
 */

describe('filtersFromSearch — the address decides', () => {
  it('reads the five filters, and returns empty for everything it does not say', () => {
    const filters = filtersFromSearch(new URLSearchParams('assigned=me&decision=none'));
    expect(filters).toEqual({ ...EMPTY_FILTERS, assigned: 'me', decision: 'none' });
  });

  it('ignores parameters that are not filters', () => {
    expect(filtersFromSearch(new URLSearchParams('tab=grid'))).toEqual(EMPTY_FILTERS);
  });
});

describe('searchWithFilters — the address follows', () => {
  it('writes the active filters and removes those just cleared', () => {
    const before = new URLSearchParams('kind=VIDEO&decision=none');
    const after = searchWithFilters(before, { ...EMPTY_FILTERS, kind: 'IMAGE' });
    expect(after.get('kind')).toBe('IMAGE');
    expect(after.has('decision')).toBe(false);
  });

  it('keeps foreign parameters: they belong to the caller', () => {
    const after = searchWithFilters(new URLSearchParams('from=home'), {
      ...EMPTY_FILTERS,
      assigned: 'me',
    });
    expect(after.get('from')).toBe('home');
    expect(after.get('assigned')).toBe('me');
  });

  it('round-trips without losing anything', () => {
    const filters = { projectId: '7', kind: 'IMAGE', status: 'published', decision: '3', assigned: 'me' };
    expect(filtersFromSearch(searchWithFilters(new URLSearchParams(), filters))).toEqual(filters);
  });
});

describe('apiQuery — the cache key and the request', () => {
  it('carries only the active filters, in a stable order', () => {
    // The order must not depend on how the address was written: two equivalent URLs must give
    // the same cache key, hence the same list.
    const posé = { ...EMPTY_FILTERS, assigned: 'me', kind: 'VIDEO' };
    expect(apiQuery(posé)).toBe('kind=VIDEO&assigned=me');
    expect(apiQuery(filtersFromSearch(new URLSearchParams('assigned=me&kind=VIDEO')))).toBe(apiQuery(posé));
  });

  it('is empty when no filter is set', () => {
    expect(apiQuery(EMPTY_FILTERS)).toBe('');
  });
});
