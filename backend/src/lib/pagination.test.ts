// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  cursorPaginationQuery,
  cursorWhere,
  decodeCursor,
  encodeCursor,
  nextCursor,
  pageArgs,
  paginate,
  paginateCursor,
  paginationQuery,
  readPagination,
  stableOrderBy,
  withCursor,
} from './pagination';

const params = (over: Partial<ReturnType<typeof readPagination>> = {}) => ({
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  order: 'desc' as const,
  ...over,
});

describe('pagination schema', () => {
  it('separates the default from the ceiling', () => {
    // The ceiling WAS the default (max 100 / default 100): a caller could not ask for anything more than what was served,
    // so pagination did not exist.
    expect(DEFAULT_PAGE_SIZE).toBeLessThan(MAX_PAGE_SIZE);
    expect(paginationQuery.parse({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(paginationQuery.parse({ pageSize: '400' }).pageSize).toBe(400);
  });

  it('refuses beyond the ceiling and below 1', () => {
    expect(() => paginationQuery.parse({ pageSize: String(MAX_PAGE_SIZE + 1) })).toThrow();
    expect(() => paginationQuery.parse({ page: '0' })).toThrow();
  });

  it('accepts a cursor on the dedicated variant', () => {
    expect(cursorPaginationQuery.parse({ cursor: 'abc' }).cursor).toBe('abc');
    expect(cursorPaginationQuery.parse({}).cursor).toBeUndefined();
  });
});

describe('readPagination', () => {
  it('coerces the strings of req.query', () => {
    expect(readPagination({ page: '3', pageSize: '25' })).toMatchObject({ page: 3, pageSize: 25 });
  });

  it("applies the route's own default when nothing is requested", () => {
    expect(readPagination({}, { defaultPageSize: 500 }).pageSize).toBe(500);
  });

  it('always leaves the last word to the caller', () => {
    expect(readPagination({ pageSize: '10' }, { defaultPageSize: 500 }).pageSize).toBe(10);
  });

  it('does not let a route default cross the ceiling', () => {
    expect(readPagination({}, { defaultPageSize: 99999 }).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('pageArgs / paginate', () => {
  it('shifts by (page - 1) × pageSize', () => {
    expect(pageArgs(params({ page: 3, pageSize: 20 }))).toEqual({ skip: 40, take: 20 });
  });

  it('ignores the offset when a cursor is supplied', () => {
    // Combining skip and cursor would skip a whole page.
    expect(pageArgs(params({ page: 3, pageSize: 20, cursor: 'c' }))).toEqual({ skip: 0, take: 20 });
  });

  it('exposes a usable total: pageCount and hasMore', () => {
    const p = params({ page: 1, pageSize: 100 });
    expect(paginate(new Array(100).fill(0), 250, p)).toMatchObject({
      total: 250,
      pageCount: 3,
      hasMore: true,
    });
    expect(paginate(new Array(50).fill(0), 250, params({ page: 3, pageSize: 100 }))).toMatchObject({
      pageCount: 3,
      hasMore: false,
    });
  });

  it('pageCount is 1 on an empty list', () => {
    expect(paginate([], 0, params()).pageCount).toBe(1);
  });

  it('in cursor mode, a full page announces a continuation', () => {
    const p = params({ pageSize: 2, cursor: 'c' });
    expect(paginate([1, 2], 999, p).hasMore).toBe(true);
    expect(paginate([1], 999, p).hasMore).toBe(false);
  });
});

describe('stableOrderBy', () => {
  it('adds a tie-break on id, in the same direction', () => {
    expect(stableOrderBy(params({ sort: 'name', order: 'asc' }), ['name'], { name: 'asc' })).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('falls back on the default sort if the column is not allowed', () => {
    expect(stableOrderBy(params({ sort: 'passwordHash' }), ['name'], { createdAt: 'desc' })).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('does not double the tie-break when already sorting by id', () => {
    expect(stableOrderBy(params({ sort: 'id', order: 'asc' }), ['id'], { id: 'asc' })).toEqual([
      { id: 'asc' },
    ]);
  });
});

describe('curseur', () => {
  it('round-trips an integer, a string and a date', () => {
    const date = new Date('2026-08-21T10:00:00.000Z');
    expect(decodeCursor(encodeCursor(0, 42))).toEqual({ value: 0, id: 42 });
    expect(decodeCursor(encodeCursor('SH010', 7))).toEqual({ value: 'SH010', id: 7 });
    expect(decodeCursor(encodeCursor(date, 9))).toEqual({ value: date, id: 9 });
  });

  it('does not return a number as a string', () => {
    // A Prisma comparison on the wrong type is a 500 error, not a lopsided sort.
    expect(typeof decodeCursor(encodeCursor(12, 1))!.value).toBe('number');
  });

  it('treats an unreadable cursor as no cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('pas-du-base64-json')).toBeNull();
    expect(decodeCursor(Buffer.from('{"k":"n","v":1}').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('{"k":"d","v":"jamais","i":1}').toString('base64url'))).toBeNull();
  });

  it('compares the pair (value, id), not the value alone', () => {
    // That is the whole point: two thousand shots at order = 0 can only be told apart by id, otherwise the next page
    // restarts from the first tie.
    expect(cursorWhere('order', 'asc', { value: 0, id: 12 })).toEqual({
      OR: [{ order: { gt: 0 } }, { AND: [{ order: 0 }, { id: { gt: 12 } }] }],
    });
  });

  it('inverts the comparison in descending sort', () => {
    expect(cursorWhere('createdAt', 'desc', { value: 5, id: 3 })).toEqual({
      OR: [{ createdAt: { lt: 5 } }, { AND: [{ createdAt: 5 }, { id: { lt: 3 } }] }],
    });
  });

  it('reduces to the id when it is already the sort key', () => {
    expect(cursorWhere('id', 'asc', { value: 4, id: 4 })).toEqual({ id: { gt: 4 } });
  });
});

describe('withCursor', () => {
  it('leaves the filter intact without a cursor', () => {
    const where = { projectId: 1 };
    expect(withCursor(where, params(), 'order', 'asc')).toBe(where);
  });

  it('stacks the condition in AND without overwriting an existing OR', () => {
    // A task hangs from a shot OR an asset: spreading the cursor at the root would overwrite that OR and the list
    // would return the tasks of the whole studio.
    const where = { OR: [{ shotId: 1 }, { assetId: 2 }] };
    const out = withCursor(where, params({ cursor: encodeCursor(0, 5) }), 'order', 'asc') as {
      OR: unknown[];
      AND: unknown[];
    };
    expect(out.OR).toEqual(where.OR);
    expect(out.AND).toHaveLength(1);
    expect(out.AND[0]).toEqual(cursorWhere('order', 'asc', { value: 0, id: 5 }));
  });

  it('keeps an AND already present', () => {
    const where = { AND: [{ deletedAt: null }] };
    const out = withCursor(where, params({ cursor: encodeCursor(1, 2) }), 'order', 'asc') as {
      AND: unknown[];
    };
    expect(out.AND).toHaveLength(2);
    expect(out.AND[0]).toEqual({ deletedAt: null });
  });
});

describe('nextCursor / paginateCursor', () => {
  const rows = [
    { id: 1, order: 0 },
    { id: 2, order: 0 },
  ];

  it('returns no cursor on an incomplete page', () => {
    expect(nextCursor(rows, 10, (r) => r.order)).toBeNull();
    expect(nextCursor([], 10, (r: { id: number }) => r.id)).toBeNull();
  });

  it('returns the pair of the last row served on a full page', () => {
    expect(decodeCursor(nextCursor(rows, 2, (r) => r.order) ?? undefined)).toEqual({
      value: 0,
      id: 2,
    });
  });

  it('attaches the cursor to the standard envelope', () => {
    const page = paginateCursor(rows, 40, params({ pageSize: 2 }), (r) => r.order);
    expect(page).toMatchObject({ total: 40, page: 1, pageSize: 2, pageCount: 20, hasMore: true });
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({ value: 0, id: 2 });
  });
});
