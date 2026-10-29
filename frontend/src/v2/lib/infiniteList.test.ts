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
  it('stacks the pages in the order received', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(4, 2), page: 2 })];
    expect(flattenPages(all).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('drops a row already served — a creation shifts the following pages', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(3, 3), page: 2 })];
    expect(flattenPages(all).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps items without an id rather than confusing them', () => {
    const all = [{ items: ['a', 'a', 'b'], total: 3, page: 1, pageSize: 2 }];
    expect(flattenPages(all)).toEqual(['a', 'a', 'b']);
  });

  it('returns an empty list when nothing is loaded', () => {
    expect(flattenPages([])).toEqual([]);
  });
});

describe('rawLoaded / totalCount', () => {
  it('counts the rows received, duplicates included', () => {
    const all = [page({ items: rows(1, 3) }), page({ items: rows(3, 3), page: 2 })];
    expect(rawLoaded(all)).toBe(6);
    expect(flattenPages(all)).toHaveLength(5);
  });

  it('reads the total from the last page', () => {
    expect(totalCount([page({ total: 1247 })])).toBe(1247);
  });

  it('falls back on what is loaded when the total is missing', () => {
    const broken = [{ items: rows(1, 4), total: Number.NaN, page: 1, pageSize: 100 }];
    expect(totalCount(broken)).toBe(4);
    expect(totalCount([])).toBe(0);
  });
});

describe('nextPageParam', () => {
  it('follows the cursor when the route serves one', () => {
    const last = page({ nextCursor: 'abc', hasMore: true });
    expect(nextPageParam(last, [last])).toEqual({ page: 2, cursor: 'abc' });
  });

  it('stops on a null cursor, even if `hasMore` says otherwise', () => {
    const last = page({ nextCursor: null, hasMore: true });
    expect(nextPageParam(last, [last])).toBeUndefined();
  });

  it('numbers the pages when the route has no cursor', () => {
    const first = page({ hasMore: true });
    expect(nextPageParam(first, [first])).toEqual({ page: 2 });
    const second = page({ hasMore: true, page: 2 });
    expect(nextPageParam(second, [first, second])).toEqual({ page: 3 });
  });

  it('derives what comes next from the total when `hasMore` is not served', () => {
    const first = page({ items: rows(1, 100), total: 150 });
    expect(nextPageParam(first, [first])).toEqual({ page: 2 });
    const second = page({ items: rows(101, 50), total: 150, page: 2 });
    expect(nextPageParam(second, [first, second])).toBeUndefined();
  });

  it('stops on an empty page — otherwise loading runs forever', () => {
    const empty = page({ items: [], hasMore: true, nextCursor: 'zzz' });
    expect(nextPageParam(empty, [empty])).toBeUndefined();
  });
});

describe('pageParamQuery / withQuery', () => {
  it('leaves the first request unchanged', () => {
    expect(pageParamQuery(FIRST_PAGE)).toBe('');
    expect(withQuery('/api/shots?projectId=3', '')).toBe('/api/shots?projectId=3');
  });

  it('numbers from the second page onwards', () => {
    expect(pageParamQuery({ page: 2 })).toBe('page=2');
  });

  it('prefers the cursor to the page number', () => {
    expect(pageParamQuery({ page: 3, cursor: 'c+/=' })).toBe('cursor=c%2B%2F%3D');
  });

  it('carries the requested page size', () => {
    expect(pageParamQuery({ page: 1 }, 200)).toBe('pageSize=200');
  });

  it('adds the query string with the right separator', () => {
    expect(withQuery('/api/projects', 'page=2')).toBe('/api/projects?page=2');
    expect(withQuery('/api/projects?archived=1', 'page=2')).toBe('/api/projects?archived=1&page=2');
  });
});

describe('shouldAutoLoad', () => {
  it('chains only when asked, while pages remain and none is in flight', () => {
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: false })).toBe(true);
    expect(shouldAutoLoad({ eager: false, hasMore: true, fetching: false })).toBe(false);
    expect(shouldAutoLoad({ eager: true, hasMore: false, fetching: false })).toBe(false);
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: true })).toBe(false);
  });

  it('stops dead after a failure — otherwise the failed request replays in a loop', () => {
    expect(shouldAutoLoad({ eager: true, hasMore: true, fetching: false, failed: true })).toBe(false);
  });
});

describe('formatListCount', () => {
  it('follows the reader\'s language', () => {
    expect(formatListCount(1247, 'en-US')).toBe('1,247');
    expect(formatListCount(1247, 'de-DE')).toBe('1.247');
  });

  it('stays readable if the locale is invalid', () => {
    expect(formatListCount(12, 'pas-une-locale!')).toBe('12');
  });
});
