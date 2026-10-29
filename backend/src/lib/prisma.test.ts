// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { withPoolBounds } from './prisma';

/**
 * PERF-04 / INFRA-10 — the pool must no longer follow the hardware.
 *
 * Measured on the development database (32 logical cores seen by the process): 20 concurrent queries launched on a BARE URL
 * open 20 PostgreSQL connections and return `statement_timeout = 0`; the same load on the bounded URL below opens 10 and
 * returns `statement_timeout = 1min`. These cases pin down the exact form of the URL that produces this result — the encoding
 * of `options` in particular, which a pass through `URLSearchParams` would silently break (space written "+", token unknown on
 * the server side).
 */
const BASE = 'postgresql://review:pw@postgres:5432/review?schema=public';

describe('withPoolBounds', () => {
  it('bounds the pool, the wait and the duration of a request', () => {
    expect(withPoolBounds(BASE, {})).toBe(
      `${BASE}&connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000`,
    );
  });

  it('encodes the space as %20 and not as "+" (the server splits `options` on spaces)', () => {
    const url = withPoolBounds(BASE, {}) ?? '';
    expect(url).toContain('options=-c%20statement_timeout%3D60000');
    expect(url).not.toContain('+');
  });

  it('opens the query when the URL has none', () => {
    expect(withPoolBounds('postgresql://u:p@h:5432/db', {})).toBe(
      'postgresql://u:p@h:5432/db?connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000',
    );
  });

  it('leaves intact any parameter already set by the operator', () => {
    // The compose file already writes `connection_limit`/`pool_timeout` in both DATABASE_URLs: rewriting them here would
    // turn a readable setting into a ghost value.
    const explicit = `${BASE}&connection_limit=4&pool_timeout=5&options=-c%20statement_timeout%3D10000`;
    expect(withPoolBounds(explicit, {})).toBeUndefined();
  });

  it('only completes what is missing', () => {
    expect(withPoolBounds(`${BASE}&connection_limit=4`, {})).toBe(
      `${BASE}&connection_limit=4&pool_timeout=20&options=-c%20statement_timeout%3D60000`,
    );
  });

  it('follows DB_POOL, DB_POOL_TIMEOUT and DB_STATEMENT_TIMEOUT_MS', () => {
    expect(
      withPoolBounds(BASE, { DB_POOL: '4', DB_POOL_TIMEOUT: '30', DB_STATEMENT_TIMEOUT_MS: '5000' }),
    ).toBe(`${BASE}&connection_limit=4&pool_timeout=30&options=-c%20statement_timeout%3D5000`);
  });

  it('ignores an environment value that is not a positive integer', () => {
    // A `DB_POOL=0` or `DB_POOL=abc` set by mistake must not produce a URL that Prisma refuses at startup: we fall back to the default.
    for (const bad of ['0', '-3', 'abc', '', '2.5']) {
      expect(withPoolBounds(BASE, { DB_POOL: bad }), bad).toContain('connection_limit=10');
    }
  });

  it('does not touch a URL that is not a PostgreSQL connection', () => {
    expect(withPoolBounds(undefined, {})).toBeUndefined();
    expect(withPoolBounds('', {})).toBeUndefined();
    expect(withPoolBounds('mysql://u:p@h/db', {})).toBeUndefined();
  });

  it('does not take a "?" in the password for the start of the query', () => {
    // A badly encoded password would otherwise make half the credentials pass as parameters, and the produced URL would be unconnectable.
    expect(withPoolBounds('postgresql://u:pa?ss@h:5432/db', {})).toBe(
      'postgresql://u:pa?ss@h:5432/db?connection_limit=10&pool_timeout=20&options=-c%20statement_timeout%3D60000',
    );
  });
});
