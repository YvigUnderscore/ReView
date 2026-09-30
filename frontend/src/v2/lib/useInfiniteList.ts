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
  /**
   * Plus rien ne viendra : toutes les pages annoncées sont arrivées — ou la liste s'est
   * arrêtée sur une erreur. Un sélecteur en mode `all` s'en sert pour n'apparaître que
   * complet : proposer la moitié des plans rattachables est un défaut bien pire que
   * l'attente qu'il évite.
   */
  isComplete: boolean;
}

/**
 * Taille de page demandée quand l'appelant veut la liste entière.
 *
 * Miroir de `MAX_PAGE_SIZE` (`backend/src/lib/pagination.ts`) : c'est le plafond qu'acceptent
 * les schémas Zod des routes de liste — un de plus et la requête part en 400.
 */
const EAGER_PAGE_SIZE = 500;

/**
 * `PageParam` augmenté de la taille de page à redemander.
 *
 * Elle n'est pas prise de l'option de l'appelant mais de ce que le serveur a **servi** pour
 * la page précédente : plusieurs écrans partagent une clé de cache (le rail latéral et la
 * page des projets, la modale d'assignation et l'onglet des plans) sans partager l'option
 * `all`. Une page 1 déjà en cache, servie par 100, suivie d'une page 2 demandée par 500,
 * sauterait les lignes 101 à 500 en pagination par numéro de page.
 */
type SizedPageParam = PageParam & { pageSize?: number };

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

  /**
   * Les pages d'un `all` s'enchaînent en série — le curseur de la page N vient de la
   * réponse N-1, aucune parallélisation n'est possible. Le seul levier est donc leur
   * nombre : demandées par 500 au lieu des 100 servis par défaut, deux mille plans
   * tiennent en quatre allers-retours au lieu de vingt.
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
      // La taille se fige sur celle que le serveur vient de servir (cf. `SizedPageParam`).
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

  // Chargement enchaîné : une modale ne défile pas jusqu'à la sentinelle, et un filtre
  // posé sur une liste tronquée répondrait « aucun résultat » pour un plan qui existe.
  //
  // `loadedPages` fait partie des dépendances, et ce n'est pas une décoration : quand une
  // réponse arrive dans le même tick que la demande — serveur local, cache HTTP chaud,
  // page déjà en mémoire — React ne commit aucun rendu intermédiaire à `isFetchingMore`
  // vrai. Les autres dépendances reprennent alors exactement la même valeur qu'au tour
  // précédent, l'effet est sauté, et l'enchaînement s'arrête au milieu de la liste : le
  // sélecteur se croit complet avec deux pages sur vingt. Le compte des pages, lui, change
  // à chaque arrivée.
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
    // Deux réserves derrière ce booléen. Tant que rien n'est arrivé, `hasNextPage` vaut
    // faux faute de page à prolonger : « complet » exige donc une première page. Et une
    // page en échec arrête l'enchaînement (`shouldAutoLoad`) sans faire tomber
    // `hasNextPage` : sans le premier terme, un sélecteur gardé fermé tant que la liste
    // n'est pas complète resterait en squelette pour toujours après un 500.
    isComplete: isError || (items !== undefined && !hasNextPage),
  };
}
