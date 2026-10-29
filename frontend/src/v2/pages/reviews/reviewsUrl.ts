// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EMPTY_FILTERS, type ReviewsFilterState } from './reviewsTypes';

/**
 * The Reviews page filters, in the URL.
 *
 * They used to live in a `useState`: the page completely ignored the query string, both when
 * reading and when writing. Cascading consequences — no Home card could open a filtered view (the
 * only possible link was "all"), a search state could be neither shared nor bookmarked, and the
 * browser's back button left the page instead of undoing the last filter.
 *
 * The URL therefore becomes the only source: no local state to keep in sync, so no possible
 * divergence between what the address says and what the list shows.
 *
 * The keys are derived from `EMPTY_FILTERS`: a filter added to the page is carried by the URL
 * without anyone having to think about it — a list copied here would sooner or later have missed one.
 */
const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ReviewsFilterState)[];

/** The filters as the address describes them; any missing parameter returns to empty. */
export function filtersFromSearch(search: URLSearchParams): ReviewsFilterState {
  const out = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) out[key] = search.get(key) ?? '';
  return out;
}

/**
 * The address updated by a set of filters. Parameters foreign to the page are kept: they belong
 * to the caller, not to the filters.
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
 * The query string sent to the server: active filters only, in a stable order — it is also the
 * list's cache key, which must not change shape depending on how the address was written.
 */
export function apiQuery(filters: ReviewsFilterState): string {
  return searchWithFilters(new URLSearchParams(), filters).toString();
}
