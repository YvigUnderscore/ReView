// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure core of the "on demand" lists.
 *
 * List screens consumed `Page<T>` by throwing away everything but `items`: the server served a
 * hundred, the client displayed a hundred, and the remaining thousand existed nowhere — neither in
 * the list, nor in a counter, nor in a message. On a feature film (two thousand shots, a thousand
 * assets) the screen lied.
 *
 * This module knows neither React nor the network: it can stack pages, say how many rows are loaded
 * out of how many exist, and decide what to request next. Both pagination modes of the backend are
 * supported:
 * - **cursor** (`nextCursor`, shots/assets): `null` announces the end of the list;
 * - **page/pageSize** (projects, reviews): `hasMore`, or failing that `loaded < total`.
 */

/** Standard envelope of bounded lists — mirror of `backend/src/lib/pagination.ts`. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount?: number;
  hasMore?: boolean;
  /** Served by the cursor routes; `null` = nothing after. */
  nextCursor?: string | null;
}

/** What to send to get the next page. */
export interface PageParam {
  page: number;
  cursor?: string;
}

export const FIRST_PAGE: PageParam = { page: 1 };

/** Numeric `id` of an element, when it has one (used for de-duplication). */
function idOf(item: unknown): number | null {
  if (typeof item !== 'object' || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === 'number' ? id : null;
}

/**
 * The pages end to end, in the order received.
 *
 * De-duplication by `id` is not a nicety: in page/pageSize mode, a creation that gets inserted while
 * reading shifts everything after it, and page 2 re-displays rows of page 1 — React would then
 * demand two children with the same key.
 */
export function flattenPages<T>(pages: readonly Page<T>[]): T[] {
  const out: T[] = [];
  const seen = new Set<number>();
  for (const page of pages) {
    for (const item of page.items) {
      const id = idOf(item);
      if (id !== null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(item);
    }
  }
  return out;
}

/**
 * Rows received from the server, duplicates included — it is this count, and not that of the
 * de-duplicated list, that tells the server where to resume.
 */
export function rawLoaded<T>(pages: readonly Page<T>[]): number {
  return pages.reduce((n, page) => n + page.items.length, 0);
}

/** Total announced by the last page; failing that, what we have at hand. */
export function totalCount<T>(pages: readonly Page<T>[]): number {
  const last = pages[pages.length - 1];
  if (!last || !Number.isFinite(last.total)) return rawLoaded(pages);
  return Math.max(last.total, 0);
}

/**
 * Parameter of the next page, or `undefined` when the list is finished.
 *
 * An empty page stops everything: without this guard, an optimistic `hasMore` (cursor mode, last
 * page full by coincidence) would make the loading run forever.
 */
export function nextPageParam<T>(last: Page<T>, all: readonly Page<T>[]): PageParam | undefined {
  if (last.items.length === 0) return undefined;
  if (typeof last.nextCursor === 'string' && last.nextCursor.length > 0)
    return { page: all.length + 1, cursor: last.nextCursor };
  // A cursor route that returns `null` has had the last word.
  if (last.nextCursor === null) return undefined;
  const more = last.hasMore ?? rawLoaded(all) < last.total;
  return more ? { page: all.length + 1 } : undefined;
}

/**
 * Query string of a page. The first page without an explicit size produces none:
 * the request stays identical to what it was before client-side pagination.
 */
export function pageParamQuery(param: PageParam, pageSize?: number): string {
  const search = new URLSearchParams();
  if (param.cursor) search.set('cursor', param.cursor);
  else if (param.page > 1) search.set('page', String(param.page));
  if (pageSize !== undefined) search.set('pageSize', String(pageSize));
  return search.toString();
}

/** Appends a query string to a URL that may already carry one. */
export function withQuery(url: string, query: string): string {
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

/**
 * Should the next page be chained without waiting for scrolling?
 *
 * Two situations require it: a selector that must offer the whole list (a modal does not scroll
 * down to the sentinel), and a filter applied client-side — filtering a hundred rows out of two
 * thousand would answer "no result" for a shot that exists.
 *
 * A failing page stops the chaining: "there is more" would remain true indefinitely, and the loop
 * would replay the request that just failed as fast as React redraws. The user keeps the explicit
 * command of the sentinel to retry.
 */
export function shouldAutoLoad(state: {
  hasMore: boolean;
  fetching: boolean;
  eager: boolean;
  failed?: boolean;
}): boolean {
  if (state.failed) return false;
  return state.eager && state.hasMore && !state.fetching;
}

/** Number readable by the reader ("1 247", "1,247") — never a hard-coded locale. */
export function formatListCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
