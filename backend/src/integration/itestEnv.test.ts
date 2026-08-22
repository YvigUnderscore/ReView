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

describe('itestEnv — base jetable des tests d’intégration', () => {
  it('dérive la base d’intégration de DATABASE_URL sans toucher au reste de l’URL', () => {
    const url = resolveItestDatabaseUrl({ DATABASE_URL: DEV });
    expect(databaseNameOf(url)).toBe(ITEST_DATABASE_NAME);
    expect(new URL(url).searchParams.get('schema')).toBe('public');
    expect(new URL(url).username).toBe('review');
    expect(new URL(url).port).toBe('5432');
  });

  it('ITEST_DATABASE_URL est prioritaire sur DATABASE_URL', () => {
    const explicit = 'postgresql://ci:ci@db:5432/other_itest';
    expect(resolveItestDatabaseUrl({ DATABASE_URL: DEV, ITEST_DATABASE_URL: explicit })).toBe(explicit);
  });

  it('accepte une DATABASE_URL déjà pointée sur la base d’intégration (cas CI)', () => {
    const ci = 'postgresql://review:x@localhost:5432/review_itest?schema=public';
    expect(resolveItestDatabaseUrl({ DATABASE_URL: ci })).toBe(ci);
  });

  it('refuse toute base dont le nom ne finit pas par _itest : la suite fait migrate reset --force', () => {
    expect(() => resolveItestDatabaseUrl({ ITEST_DATABASE_URL: DEV })).toThrow(/must end with/);
    expect(() =>
      resolveItestDatabaseUrl({ ITEST_DATABASE_URL: 'postgresql://u:p@prod:5432/review_prod' }),
    ).toThrow(/review_prod/);
  });

  it('refuse un environnement sans URL de base plutôt que de deviner', () => {
    expect(() => resolveItestDatabaseUrl({})).toThrow(/DATABASE_URL/);
    expect(() => resolveItestDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });

  it('l’URL de maintenance vise la base postgres, seule d’où l’on peut créer les autres', () => {
    const url = resolveItestDatabaseUrl({ DATABASE_URL: DEV });
    expect(databaseNameOf(adminDatabaseUrl(url))).toBe('postgres');
  });

  it('withDatabaseName ne remplace que le nom de la base', () => {
    expect(withDatabaseName(DEV, 'x_itest')).toBe(
      'postgresql://review:review_dev@localhost:5432/x_itest?schema=public',
    );
  });
});
