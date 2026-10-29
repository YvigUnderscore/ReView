// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EMPTY_FILTERS, type EntityFilterState } from './entityFilters';

/**
 * List filters, carried by the URL rather than by a `useState`.
 *
 * The project page made this choice for its current tab (`?tab=shots`) and documented it:
 * a link can be shared, a reload finds its screen again, and the browser's Back/Forward
 * buttons do what one expects of them. The lists, however, kept their filters in
 * React state: applying "Waiting to Start" then sending the link to a colleague
 * opened the whole list, and a simple F5 erased the sort just set.
 *
 * Saved views do not replace this need: they are personal, named and
 * deliberate, whereas one often wants to share a transient state.
 *
 * Empty filters are not written: the URL of a list without filters stays clean.
 * The prefix lets two lists on the same page (a project's Shots and Assets) avoid
 * stepping on each other.
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
      // `replace`: filtering is not navigating. Without this, going back would force
      // undoing each keystroke of the free-text search one by one.
      setParams(updated, { replace: true });
    },
    [params, setParams, key],
  );

  return [filters, setFilters];
}
