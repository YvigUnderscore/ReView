// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cœur pur des listes « à la demande ».
 *
 * Les écrans de liste consommaient `Page<T>` en jetant tout sauf `items` : le serveur en
 * servait cent, le client en affichait cent, et le millier restant n'existait nulle part —
 * ni dans la liste, ni dans un compteur, ni dans un message. Sur un long-métrage (deux
 * mille plans, mille assets) l'écran mentait.
 *
 * Ce module ne connaît ni React ni le réseau : il sait empiler des pages, dire combien de
 * lignes sont chargées sur combien il en existe, et décider ce qu'il faut demander ensuite.
 * Les deux modes de pagination du backend y sont pris en charge :
 * - **curseur** (`nextCursor`, plans/assets) : `null` annonce la fin de liste ;
 * - **page/pageSize** (projets, reviews) : `hasMore`, ou à défaut `chargées < total`.
 */

/** Enveloppe standard des listes bornées — miroir de `backend/src/lib/pagination.ts`. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount?: number;
  hasMore?: boolean;
  /** Servi par les routes à curseur ; `null` = plus rien après. */
  nextCursor?: string | null;
}

/** Ce qu'il faut envoyer pour obtenir la page suivante. */
export interface PageParam {
  page: number;
  cursor?: string;
}

export const FIRST_PAGE: PageParam = { page: 1 };

/** `id` numérique d'un élément, quand il en a un (sert au dédoublonnage). */
function idOf(item: unknown): number | null {
  if (typeof item !== 'object' || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === 'number' ? id : null;
}

/**
 * Les pages bout à bout, dans l'ordre reçu.
 *
 * Le dédoublonnage par `id` n'est pas une coquetterie : en mode page/pageSize, une
 * création qui s'intercale pendant la lecture décale toute la suite et la page 2 réaffiche
 * des lignes de la page 1 — React réclamerait alors deux enfants de même clé.
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
 * Lignes reçues du serveur, doublons compris — c'est ce décompte-là, et non celui de la
 * liste dédoublonnée, qui dit au serveur où reprendre.
 */
export function rawLoaded<T>(pages: readonly Page<T>[]): number {
  return pages.reduce((n, page) => n + page.items.length, 0);
}

/** Total annoncé par la dernière page ; à défaut, ce qu'on a sous la main. */
export function totalCount<T>(pages: readonly Page<T>[]): number {
  const last = pages[pages.length - 1];
  if (!last || !Number.isFinite(last.total)) return rawLoaded(pages);
  return Math.max(last.total, 0);
}

/**
 * Paramètre de la page suivante, ou `undefined` quand la liste est finie.
 *
 * Une page vide arrête tout : sans ce garde-fou, un `hasMore` optimiste (mode curseur,
 * dernière page pleine par coïncidence) ferait tourner le chargement à l'infini.
 */
export function nextPageParam<T>(last: Page<T>, all: readonly Page<T>[]): PageParam | undefined {
  if (last.items.length === 0) return undefined;
  if (typeof last.nextCursor === 'string' && last.nextCursor.length > 0)
    return { page: all.length + 1, cursor: last.nextCursor };
  // Une route à curseur qui rend `null` a dit son dernier mot.
  if (last.nextCursor === null) return undefined;
  const more = last.hasMore ?? rawLoaded(all) < last.total;
  return more ? { page: all.length + 1 } : undefined;
}

/**
 * Query-string d'une page. La première page sans taille explicite n'en produit aucune :
 * la requête reste identique à ce qu'elle était avant la pagination côté client.
 */
export function pageParamQuery(param: PageParam, pageSize?: number): string {
  const search = new URLSearchParams();
  if (param.cursor) search.set('cursor', param.cursor);
  else if (param.page > 1) search.set('page', String(param.page));
  if (pageSize !== undefined) search.set('pageSize', String(pageSize));
  return search.toString();
}

/** Colle une query-string à une URL qui en porte peut-être déjà une. */
export function withQuery(url: string, query: string): string {
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

/**
 * Faut-il enchaîner la page suivante sans attendre le défilement ?
 *
 * Deux situations l'exigent : un sélecteur qui doit proposer toute la liste (une modale ne
 * défile pas jusqu'à la sentinelle), et un filtre posé côté client — filtrer cent lignes
 * sur deux mille répondrait « aucun résultat » pour un plan qui existe.
 *
 * Une page en échec arrête l'enchaînement : « il en reste » resterait vrai indéfiniment,
 * et la boucle rejouerait la requête qui vient d'échouer aussi vite que React redessine.
 * L'utilisateur garde la commande explicite de la sentinelle pour réessayer.
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

/** Nombre lisible par le lecteur (« 1 247 », « 1,247 ») — jamais une locale en dur. */
export function formatListCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
