// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  FIRST_PAGE,
  flattenPages,
  formatListCount,
  nextPageParam,
  pageParamQuery,
  rawLoaded,
  shouldAutoLoad,
  totalCount,
  withQuery,
  type Page,
} from './infiniteList';

interface Row {
  id: number;
}

const rows = (from: number, count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i }));

const page = (over: Partial<Page<Row>> = {}): Page<Row> => ({
  items: rows(1, 100),
  total: 1247,
  page: 1,
  pageSize: 100,
  ...over,
});

describe('flattenPages', () => {
  it('empile les pages dans l’ordre reçu', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(4, 2), page: 2 })];
    expect(flattenPages(all).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('écarte une ligne déjà servie — une création décale les pages suivantes', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(3, 3), page: 2 })];
    expect(flattenPages(all).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('garde les éléments sans id plutôt que de les confondre', () => {
    const all = [{ items: ['a', 'a', 'b'], total: 3, page: 1, pageSize: 2 }];
    expect(flattenPages(all)).toEqual(['a', 'a', 'b']);
  });

  it('rend une liste vide quand rien n’est chargé', () => {
    expect(flattenPages([])).toEqual([]);
  });
});

describe('rawLoaded / totalCount', () => {
  it('compte les lignes reçues, doublons compris', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(3, 3), page: 2 })];
    expect(rawLoaded(all)).toBe(6);
    expect(flattenPages(all)).toHaveLength(5);
  });

  it('lit le total sur la dernière page', () => {
    expect(totalCount([page({ total: 1247 })])).toBe(1247);
  });

  it('retombe sur ce qui est chargé quand le total manque', () => {
    const broken = [{ items: rows(1, 4), total: Number.NaN, page: 1, pageSize: 100 }];
    expect(totalCount(broken)).toBe(4);
    expect(totalCount([])).toBe(0);
  });
});

describe('nextPageParam', () => {
  it('suit le curseur quand la route en sert un', () => {
    const last = page({ nextCursor: 'abc', hasMore: true });
    expect(nextPageParam(last, [last])).toEqual({ page: 2, cursor: 'abc' });
  });

  it('s’arrête sur un curseur nul, même si `hasMore` dit le contraire', () => {
    const last = page({ nextCursor: null, hasMore: true });
    expect(nextPageParam(last, [last])).toBeUndefined();
  });

  it('numérote les pages quand la route n’a pas de curseur', () => {
    const first = page({ hasMore: true });
    expect(nextPageParam(first, [first])).toEqual({ page: 2 });
    const second = page({ hasMore: true, page: 2 });
    expect(nextPageParam(second, [first, second])).toEqual({ page: 3 });
  });

  it('déduit la suite du total quand `hasMore` n’est pas servi', () => {
    const first = page({ items: rows(1, 100), total: 150 });
    expect(nextPageParam(first, [first])).toEqual({ page: 2 });
    const second = page({ items: rows(101, 50), total: 150, page: 2 });
    expect(nextPageParam(second, [first, second])).toBeUndefined();
  });

  it('s’arrête sur une page vide — sinon le chargement tourne sans fin', () => {
    const empty = page({ items: [], hasMore: true, nextCursor: 'zzz' });
    expect(nextPageParam(empty, [empty])).toBeUndefined();
  });
});

describe('pageParamQuery / withQuery', () => {
  it('laisse la première requête inchangée', () => {
    expect(pageParamQuery(FIRST_PAGE)).toBe('');
    expect(withQuery('/api/shots?projectId=3', '')).toBe('/api/shots?projectId=3');
  });

  it('numérote à partir de la deuxième page', () => {
    expect(pageParamQuery({ page: 2 })).toBe('page=2');
  });

  it('préfère le curseur au numéro de page', () => {
    expect(pageParamQuery({ page: 3, cursor: 'c+/=' })).toBe('cursor=c%2B%2F%3D');
  });

  it('transporte la taille de page demandée', () => {
    expect(pageParamQuery({ page: 1 }, 200)).toBe('pageSize=200');
  });

  it('ajoute la query-string au bon séparateur', () => {
    expect(withQuery('/api/projects', 'page=2')).toBe('/api/projects?page=2');
    expect(withQuery('/api/projects?archived=1', 'page=2')).toBe('/api/projects?archived=1&page=2');
  });
});

describe('shouldAutoLoad', () => {
  it('n’enchaîne que si on le lui demande, qu’il reste des pages et qu’aucune n’est en vol', () => {
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: false })).toBe(true);
    expect(shouldAutoLoad({ eager: false, hasMore: true, fetching: false })).toBe(false);
    expect(shouldAutoLoad({ eager: true, hasMore: false, fetching: false })).toBe(false);
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: true })).toBe(false);
  });

  it('s’arrête net après un échec — sinon la requête ratée se rejoue en boucle', () => {
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: false, failed: true })).toBe(false);
  });
});

describe('formatListCount', () => {
  it('suit la langue du lecteur', () => {
    expect(formatListCount(1247, 'en-US')).toBe('1,247');
    expect(formatListCount(1247, 'de-DE')).toBe('1.247');
  });

  it('reste lisible si la locale est invalide', () => {
    expect(formatListCount(12, 'pas-une-locale!')).toBe('12');
  });
});
