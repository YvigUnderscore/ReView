// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  adminDatabaseUrl,
  databaseNameOf,
  ITEST_DATABASE_NAME,
  resolveItestDatabaseUrl,
  withDatabaseName,
} from './itestEnv';

const DEV = 'postgresql://review:review_dev@localhost:5432/review?schema=public';

describe('itestEnv — throwaway database for integration tests', () => {
  it('derives the integration database from DATABASE_URL without touching the rest of the URL', () => {
    const url = resolveItestDatabaseUrl({ DATABASE_URL: DEV });
    expect(databaseNameOf(url)).toBe(ITEST_DATABASE_NAME);
    expect(new URL(url).searchParams.get('schema')).toBe('public');
    expect(new URL(url).username).toBe('review');
    expect(new URL(url).port).toBe('5432');
  });

  it('ITEST_DATABASE_URL takes precedence over DATABASE_URL', () => {
    const explicit = 'postgresql://ci:ci@db:5432/other_itest';
    expect(resolveItestDatabaseUrl({ DATABASE_URL: DEV, ITEST_DATABASE_URL: explicit })).toBe(explicit);
  });

  it('accepts a DATABASE_URL already pointing at the integration database (CI case)', () => {
    const ci = 'postgresql://review:x@localhost:5432/review_itest?schema=public';
    expect(resolveItestDatabaseUrl({ DATABASE_URL: ci })).toBe(ci);
  });

  it('refuses any database whose name does not end in _itest: the suite runs migrate reset --force', () => {
    expect(() => resolveItestDatabaseUrl({ ITEST_DATABASE_URL: DEV })).toThrow(/must end with/);
    expect(() =>
      resolveItestDatabaseUrl({ ITEST_DATABASE_URL: 'postgresql://u:p@prod:5432/review_prod' }),
    ).toThrow(/review_prod/);
  });

  it('refuses an environment without a database URL rather than guessing', () => {
    expect(() => resolveItestDatabaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => resolveItestDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });

  it('the maintenance URL targets the postgres database, the only one from which the others can be created', () => {
    const url = resolveItestDatabaseUrl({ DATABASE_URL: DEV });
    expect(databaseNameOf(adminDatabaseUrl(url))).toBe('postgres');
  });

  it('withDatabaseName only replaces the database name', () => {
    expect(withDatabaseName(DEV, 'x_itest')).toBe(
      'postgresql://review:review_dev@localhost:5432/x_itest?schema=public',
    );
  });
});
