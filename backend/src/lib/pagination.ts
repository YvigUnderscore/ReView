// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Standardised server-side pagination and sorting (10.D1, revised for feature-film volumes).
 *
 * Every list route bounds its results via `paginationQuery` (shared Zod schema) and answers with the envelope
 * `{ items, total, page, pageSize, pageCount, hasMore }`.
 *
 * The default and the ceiling were conflated (`max(100).default(100)`): a caller could ask for nothing more than what was
 * already served, so pagination existed only on paper. They are now distinct — a reasonable default for a screen, a ceiling
 * high enough for a client that knows what it is doing.
 *
 * Two modes coexist, the response has the same shape in both cases:
 * - **page/pageSize**: `skip`/`take`, the only one able to jump to page N;
 * - **cursor** (`cursor`): resumes after the last row served. At 2000 shots, this is the mode that neither duplicates nor
 *   skips rows when a creation slips in, and that does not force Postgres to walk N rows before starting to return any.
 */

/** Page size served when the caller does not ask for one. */
export const DEFAULT_PAGE_SIZE = 100;

/** Hard ceiling: beyond it, it is no longer a page but an export. */
export const MAX_PAGE_SIZE = 500;

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Variant for large lists (shots, tasks): the cursor is opaque and always comes from the `nextCursor` of a previous
 * response. When supplied, it takes precedence over `page`.
 */
export const cursorPaginationQuery = paginationQuery.extend({
  cursor: z.string().min(1).max(300).optional(),
});

export type PaginationParams = z.infer<typeof cursorPaginationQuery>;

/**
 * Extracts and coerces the pagination parameters from `req.query`.
 * In Express 5, `req.query` is a getter: the coercion done by the `validate` middleware does not persist (the values
 * remain strings). We therefore re-parse here to obtain reliable numbers (unknown keys are ignored by the schema).
 *
 * `defaultPageSize` serves the lists a screen consumes in one block (sequence tree, upload destinations): they remain
 * bounded, but not to the size of a page of cards. An explicit value from the caller always wins.
 */
export function readPagination(query: unknown, opts: { defaultPageSize?: number } = {}): PaginationParams {
  const parsed = cursorPaginationQuery.parse(query);
  const asked =
    typeof query === 'object' && query !== null && (query as Record<string, unknown>).pageSize !== undefined;
  if (!asked && opts.defaultPageSize !== undefined) {
    parsed.pageSize = Math.min(Math.max(1, Math.trunc(opts.defaultPageSize)), MAX_PAGE_SIZE);
  }
  return parsed;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Number of pages (≥ 1), so that the client does not have to redo the rounding. */
  pageCount: number;
  /** Are there rows left after these? This is what a "load more" reads. */
  hasMore: boolean;
}

/** Envelope of lists that accept a cursor — `null` = end of list. */
export interface CursorPaginated<T> extends Paginated<T> {
  nextCursor: string | null;
}

/** Prisma `skip`/`take` arguments derived from the requested page. */
export function pageArgs(p: PaginationParams): { skip: number; take: number } {
  // A cursor replaces the offset: combining the two would skip a whole page.
  return { skip: p.cursor ? 0 : (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** Wraps a page of results in the standard envelope. */
export function paginate<T>(items: T[], total: number, p: PaginationParams): Paginated<T> {
  const pageCount = Math.max(1, Math.ceil(total / p.pageSize));
  // In cursor mode we ignore how many rows came before: a full page means there are probably more, a short page means the
  // list is finished.
  const hasMore = p.cursor ? items.length >= p.pageSize : (p.page - 1) * p.pageSize + items.length < total;
  return { items, total, page: p.page, pageSize: p.pageSize, pageCount, hasMore };
}

/**
 * Safe Prisma sort: only allows the columns of the allow-list (default otherwise), avoiding injection of an arbitrary field
 * into `orderBy`.
 */
export function orderByFrom(
  p: PaginationParams,
  allowed: readonly string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (p.sort && allowed.includes(p.sort)) return { [p.sort]: p.order };
  return fallback;
}

/**
 * The same sort, made **total** by a tie-break on `id`.
 *
 * Without it, `orderBy: { order: 'asc' }` on two thousand shots imported in passes — all at `order = 0` — leaves Postgres free
 * to return the ties in a different order from one query to the next: page 2 redisplays rows from page 1 and skips others.
 * The tie-break is mandatory as soon as a `skip`/`take` applies.
 */
export function stableOrderBy(
  p: PaginationParams,
  allowed: readonly string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Array<Record<string, 'asc' | 'desc'>> {
  const primary = orderByFrom(p, allowed, fallback);
  if ('id' in primary) return [primary];
  const direction = Object.values(primary)[0] ?? 'asc';
  return [primary, { id: direction }];
}

/** Sort values a cursor can carry. */
export type CursorValue = number | string | Date;

export interface DecodedCursor {
  value: CursorValue;
  id: number;
}

/**
 * Opaque cursor: the sort value of the last row served, plus its tie-break `id`. The type is marked (`n`/`s`/`d`) so that an
 * integer does not come back as a string — a Prisma comparison on the wrong type is a 500 error.
 */
export function encodeCursor(value: CursorValue, id: number): string {
  const tagged =
    value instanceof Date
      ? { k: 'd', v: value.toISOString(), i: id }
      : typeof value === 'number'
        ? { k: 'n', v: value, i: id }
        : { k: 's', v: value, i: id };
  return Buffer.from(JSON.stringify(tagged), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor. An unreadable cursor (truncated, forged, from an earlier version) counts as "no cursor": the list starts
 * over from the beginning rather than answering 500 for a parameter the user never typed themselves.
 */
export function decodeCursor(raw: string | undefined): DecodedCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { k, v, i } = parsed as { k?: unknown; v?: unknown; i?: unknown };
    if (typeof i !== 'number' || !Number.isInteger(i)) return null;
    if (k === 'n' && typeof v === 'number') return { value: v, id: i };
    if (k === 's' && typeof v === 'string') return { value: v, id: i };
    if (k === 'd' && typeof v === 'string') {
      const date = new Date(v);
      return Number.isNaN(date.getTime()) ? null : { value: date, id: i };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * "Strictly after this cursor" filter, as a comparison of the `(field, id)` pair: the exact counterpart of the sort
 * `[{ field }, { id }]`.
 */
export function cursorWhere(
  field: string,
  direction: 'asc' | 'desc',
  cur: DecodedCursor,
): Record<string, unknown> {
  const cmp = direction === 'asc' ? 'gt' : 'lt';
  if (field === 'id') return { id: { [cmp]: cur.id } };
  return {
    OR: [{ [field]: { [cmp]: cur.value } }, { AND: [{ [field]: cur.value }, { id: { [cmp]: cur.id } }] }],
  };
}

/**
 * Adds the cursor condition to an existing `where`.
 *
 * The filter is stacked in `AND` and never merged at the root: several of our lists already carry an `OR` (a task hangs from
 * a shot **or** an asset), which a spread would overwrite — and the list would then return the whole studio.
 */
export function withCursor<W>(where: W, p: PaginationParams, field: string, direction: 'asc' | 'desc'): W {
  const cur = decodeCursor(p.cursor);
  if (!cur) return where;
  const base = where as Record<string, unknown>;
  const previous = base.AND;
  const and = Array.isArray(previous) ? [...previous] : previous !== undefined ? [previous] : [];
  and.push(cursorWhere(field, direction, cur));
  return { ...base, AND: and } as W;
}

/**
 * Cursor to serve for the continuation. An incomplete page marks the end of the list: no need to make the client request a
 * page we know to be empty.
 */
export function nextCursor<T extends { id: number }>(
  rows: T[],
  take: number,
  pick: (row: T) => CursorValue,
): string | null {
  if (rows.length < take || rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  return encodeCursor(pick(last), last.id);
}

/** Wraps a page of results, attaching the continuation cursor. */
export function paginateCursor<T extends { id: number }>(
  items: T[],
  total: number,
  p: PaginationParams,
  pick: (row: T) => CursorValue,
): CursorPaginated<T> {
  return { ...paginate(items, total, p), nextCursor: nextCursor(items, p.pageSize, pick) };
}
