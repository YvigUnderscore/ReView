// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi, httpError, type ApiMock, type MockRequest } from '../../test/apiMock';
import { createTestQueryClient } from '../../test/renderWithProviders';
import { FIRST_PAGE, type Page } from './infiniteList';
import { useInfiniteList } from './useInfiniteList';

/**
 * The "all pages" mode (`all`) serves the selectors: assigning an asset to the 1,500th
 * shot assumes that the 1,500th shot is in the list. What is at stake here is therefore not
 * speed for its own sake but the number of round trips in series — a cursor does not
 * parallelise, each page claiming the one from the previous page.
 */

interface Row {
  id: number;
}

const rows = (from: number, count: number): Row[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) => ({ id: from + i }));

/** Cursor-based server — that of `/api/shots`: the cursor carries the number of rows served. */
function cursorServer(total: number, onCall?: (req: MockRequest) => unknown) {
  return (req: MockRequest): unknown => {
    const held = onCall?.(req);
    const size = Number(req.url.searchParams.get('pageSize') ?? 100);
    const from = Number(req.url.searchParams.get('cursor') ?? 0);
    const items = rows(from + 1, Math.min(size, total - from));
    const served = from + items.length;
    const page: Page<Row> = {
      items,
      total,
      page: Number(req.url.searchParams.get('page') ?? 1),
      pageSize: size,
      nextCursor: served < total ? String(served) : null,
    };
    return held instanceof Promise ? held.then(() => page) : page;
  };
}

/** page/pageSize server — that of `/api/projects`: the offset is computed in pages. */
function pagedServer(total: number) {
  return (req: MockRequest): Page<Row> => {
    const size = Number(req.url.searchParams.get('pageSize') ?? 100);
    const index = Number(req.url.searchParams.get('page') ?? 1);
    const from = (index - 1) * size;
    const items = rows(from + 1, Math.min(size, total - from));
    return { items, total, page: index, pageSize: size, hasMore: from + items.length < total };
  };
}

let api: ApiMock | null = null;
let qc: QueryClient | null = null;

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

afterEach(() => {
  api?.restore();
  api = null;
  qc?.clear();
  qc = null;
});

const sizes = (mock: ApiMock): (string | null)[] => mock.calls.map((c) => c.url.searchParams.get('pageSize'));

describe('useInfiniteList — "all pages" mode', () => {
  it('fills a selector of 2,000 shots in four requests instead of twenty', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(2000) });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 1], '/api/shots?projectId=1', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    // The list stays complete and in order: a truncated or shuffled selector would be a
    // far worse defect than its slowness.
    expect(result.current.data).toHaveLength(2000);
    expect(result.current.data?.[0]?.id).toBe(1);
    expect(result.current.data?.[1999]?.id).toBe(2000);
    expect(result.current.total).toBe(2000);
    expect(api.calls).toHaveLength(4);
    expect(sizes(api)).toEqual(['500', '500', '500', '500']);
  });

  it('resumes at the size the server served, not the one requested', async () => {
    // Two screens share a cache key (the side rail and the projects page, the
    // modal and the tab) without sharing the `all` option: page 1 may already be in
    // cache, served at 100. With page-number pagination, chaining onto a page 2
    // of 500 would skip rows 101 to 500 — the list would lie while believing itself complete.
    api = mockApi({ 'GET /api/projects': pagedServer(300) });
    qc = createTestQueryClient();
    const first: Page<Row> = { items: rows(1, 100), total: 300, page: 1, pageSize: 100, hasMore: true };
    qc.setQueryData(['projects'], { pages: [first], pageParams: [FIRST_PAGE] });

    const { result } = renderHook(
      // Non-zero `staleTime`: without it, mounting would refetch the page 1 already cached and
      // the scenario — continuing a list started by another screen — would vanish.
      () => useInfiniteList<Row>(['projects'], '/api/projects', { all: true, staleTime: 60_000 }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(300);
    expect(result.current.data?.map((r) => r.id)).toEqual(rows(1, 300).map((r) => r.id));
    expect(sizes(api)).toEqual(['100', '100']);
  });

  it('only reveals the selector once the whole list has arrived', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    api = mockApi({
      'GET /api/shots': cursorServer(1000, (req) =>
        req.url.searchParams.get('cursor') === '500' ? held : undefined,
      ),
    });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 2], '/api/shots?projectId=2', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(500));
    // The first page is there, the second not yet: the selector must not
    // declare itself ready on half a list.
    expect(result.current.isComplete).toBe(false);
    release();
    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(1000);
  });

  it('declares itself done when a page fails — otherwise the selector would wait forever', async () => {
    api = mockApi({ 'GET /api/shots': httpError(500, 'boom') });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 3], '/api/shots?projectId=3', { all: true }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isComplete).toBe(true);
  });
});

describe('useInfiniteList — on-demand pagination', () => {
  it('requests no extra size or page when the caller paginates itself', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(2000) });
    qc = createTestQueryClient();
    const { result } = renderHook(() => useInfiniteList<Row>(['shots', 4], '/api/shots?projectId=4', {}), {
      wrapper: wrapper(qc),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(100));
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url.searchParams.has('pageSize')).toBe(false);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isComplete).toBe(false);
  });

  it('honours an explicit page size, even in "all pages" mode', async () => {
    api = mockApi({ 'GET /api/shots': cursorServer(300) });
    qc = createTestQueryClient();
    const { result } = renderHook(
      () => useInfiniteList<Row>(['shots', 5], '/api/shots?projectId=5', { all: true, pageSize: 150 }),
      { wrapper: wrapper(qc) },
    );

    await waitFor(() => expect(result.current.isComplete).toBe(true), { timeout: 5000 });
    expect(result.current.data).toHaveLength(300);
    expect(sizes(api)).toEqual(['150', '150']);
  });
});
