// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import {
  FIRST_PAGE,
  flattenPages,
  nextPageParam,
  pageParamQuery,
  shouldAutoLoad,
  totalCount,
  withQuery,
  type Page,
  type PageParam,
} from './infiniteList';

/**
 * Paginated list wired to TanStack Query.
 *
 * The returned shape stays that of a flat query (`data` is the array, `error`,
 * `isPending`), so callers that never paginate (a plan selector, the side rail)
 * need no change. It adds an honest counter (`loaded` / `total`) and a way to
 * ask for more (`hasMore`, `loadMore`).
 *
 * The cache key is unchanged (`qk.shots(projectId)`...): existing invalidations
 * (socket, ShotGrid, status menus) keep refreshing the list, loaded pages included.
 */

export interface InfiniteList<T> {
  /** Loaded pages, end to end. `undefined` until something has arrived. */
  data: T[] | undefined;
  error: Error | null;
  isPending: boolean;
  isLoading: boolean;
  /** Displayable rows. */
  loaded: number;
  /** Existing rows on the server, with server-side filters applied. */
  total: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
  /**
   * Nothing more will come: all announced pages have arrived, or the list stopped on an
   * error. A selector in `all` mode relies on this to appear only when complete: offering
   * half of the attachable shots is far worse than the wait it avoids.
   */
  isComplete: boolean;
}

/**
 * Page size requested when the caller wants the full list.
 *
 * Mirror of `MAX_PAGE_SIZE` (`backend/src/lib/pagination.ts`): the cap accepted by the
 * Zod schemas of list routes; one more and the request fails with a 400.
 */
const EAGER_PAGE_SIZE = 500;

/**
 * `PageParam` augmented with the page size to request again.
 *
 * It is not taken from the caller's option but from what the server **served** for the
 * previous page: several screens share a cache key (the side rail and the projects page,
 * the assign modal and the plans tab) without sharing the `all` option. A cached page 1
 * served at 100, followed by a page 2 requested at 500, would skip rows 101 to 500 when paginating by page number.
 */
type SizedPageParam = PageParam & { pageSize?: number };

export interface InfiniteListOptions {
  enabled?: boolean;
  /** Page size requested; without it, the server default applies. */
  pageSize?: number;
  staleTime?: number;
  /** Keeps the previous list on screen while a filter reloads. */
  keepPrevious?: boolean;
  /**
   * Chains all pages without waiting for scrolling, for a selector or when a client-side
   * filter is set (filtering a hundred rows out of two thousand lies about the result).
   */
  all?: boolean;
}

export function useInfiniteList<T>(
  queryKey: readonly unknown[],
  url: string,
  options: InfiniteListOptions = {},
): InfiniteList<T> {
  const { enabled = true, pageSize, staleTime, keepPrevious = false, all = false } = options;

  /**
   * Pages of an `all` are chained in series: the cursor of page N comes from the N-1
   * response, so no parallelization is possible. The only lever is therefore their size:
   * requested at 500 instead of the default 100, two thousand plans take four round trips
   * instead of twenty.
   */
  const askedPageSize = pageSize ?? (all ? EAGER_PAGE_SIZE : undefined);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: FIRST_PAGE,
    queryFn: ({ pageParam }: { pageParam: SizedPageParam }) =>
      api.get<Page<T>>(withQuery(url, pageParamQuery(pageParam, pageParam.pageSize ?? askedPageSize))),
    getNextPageParam: (last: Page<T>, pages: Page<T>[]): SizedPageParam | undefined => {
      const next = nextPageParam(last, pages);
      if (!next) return undefined;
      // Size is frozen to what the server has just served (see `SizedPageParam`).
      const served = last.pageSize;
      return typeof served === 'number' && served > 0 ? { ...next, pageSize: served } : next;
    },
    enabled,
    staleTime,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isError } = query;
  const pages = query.data?.pages;
  const items = useMemo(() => (pages ? flattenPages(pages) : undefined), [pages]);
  const total = useMemo(() => (pages ? totalCount(pages) : 0), [pages]);
  const loadedPages = pages?.length ?? 0;

  // Chained loading: a modal does not scroll to the sentinel, and a filter set on a
  // truncated list would answer "no results" for a shot that exists.
  //
  // `loadedPages` is part of the dependencies, and not a decoration: when a response
  // arrives in the same tick as the request (local server, warm HTTP cache, page already
  // in memory), React commits no intermediate render with `isFetchingMore` true. The other
  // dependencies then keep exactly the same value as the previous pass, the effect is skipped,
  // and the chain stops mid-list: the selector believes it is complete with two pages out of twenty.
  // The page count, on the other hand, changes on each arrival.
  useEffect(() => {
    if (
      shouldAutoLoad({
        eager: all,
        hasMore: hasNextPage,
        fetching: isFetchingNextPage,
        failed: isError,
      })
    )
      void fetchNextPage();
  }, [all, hasNextPage, isFetchingNextPage, isError, fetchNextPage, loadedPages]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    data: items,
    error: query.error,
    isPending: query.isPending,
    isLoading: query.isLoading,
    loaded: items?.length ?? 0,
    total,
    hasMore: hasNextPage,
    isFetchingMore: isFetchingNextPage,
    loadMore,
    // Two safeguards behind this boolean. While nothing has arrived, `hasNextPage` is false
    // for lack of a page to extend: "complete" therefore requires a first page. And a failed
    // page stops the chain (`shouldAutoLoad`) without making `hasNextPage` fall: without the
    // first term, a selector kept closed until the list is complete would stay a skeleton forever after a 500.
    isComplete: isError || (items !== undefined && !hasNextPage),
  };
}
