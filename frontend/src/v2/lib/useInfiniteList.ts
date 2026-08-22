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
 * Liste paginée branchée sur TanStack Query.
 *
 * La forme rendue reste celle d'une query « plate » (`data` = le tableau, `error`,
 * `isPending`) pour que les appelants qui ne pagineront jamais — un sélecteur de plans,
 * le rail latéral — n'aient rien à changer ; s'y ajoutent de quoi afficher un compteur
 * honnête (`loaded` / `total`) et de quoi demander la suite (`hasMore`, `loadMore`).
 *
 * La clé de cache est celle d'avant (`qk.shots(projectId)`…) : toutes les invalidations
 * déjà écrites — socket, ShotGrid, menus de statut — continuent de rafraîchir la liste,
 * pages chargées comprises.
 */

export interface InfiniteList<T> {
  /** Les pages chargées, bout à bout. `undefined` tant que rien n'est arrivé. */
  data: T[] | undefined;
  error: Error | null;
  isPending: boolean;
  isLoading: boolean;
  /** Lignes affichables. */
  loaded: number;
  /** Lignes existantes côté serveur, filtres serveur appliqués. */
  total: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  loadMore: () => void;
}

export interface InfiniteListOptions {
  enabled?: boolean;
  /** Taille de page demandée ; sans elle, le défaut du serveur s'applique. */
  pageSize?: number;
  staleTime?: number;
  /** Garde la liste précédente à l'écran pendant qu'un filtre se recharge. */
  keepPrevious?: boolean;
  /**
   * Enchaîne toutes les pages sans attendre le défilement — pour un sélecteur, ou quand
   * un filtre client est posé (filtrer cent lignes sur deux mille ment sur le résultat).
   */
  all?: boolean;
}

export function useInfiniteList<T>(
  queryKey: readonly unknown[],
  url: string,
  options: InfiniteListOptions = {},
): InfiniteList<T> {
  const { enabled = true, pageSize, staleTime, keepPrevious = false, all = false } = options;

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: FIRST_PAGE,
    queryFn: ({ pageParam }: { pageParam: PageParam }) =>
      api.get<Page<T>>(withQuery(url, pageParamQuery(pageParam, pageSize))),
    getNextPageParam: (last: Page<T>, pages: Page<T>[]) => nextPageParam(last, pages),
    enabled,
    staleTime,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage, isError } = query;
  const pages = query.data?.pages;
  const items = useMemo(() => (pages ? flattenPages(pages) : undefined), [pages]);
  const total = useMemo(() => (pages ? totalCount(pages) : 0), [pages]);

  // Chargement enchaîné : une modale ne défile pas jusqu'à la sentinelle, et un filtre
  // posé sur une liste tronquée répondrait « aucun résultat » pour un plan qui existe.
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
  }, [all, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

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
  };
}
