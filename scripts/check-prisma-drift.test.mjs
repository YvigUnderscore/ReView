// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareStatements,
  normalizeStatements,
  shadowUrlFrom,
  SHADOW_DATABASE_NAME,
} from './check-prisma-drift.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('check-prisma-drift — reading the diff script', () => {
  it('splits the SQL into statements and drops comments and layout', () => {
    const sql = [
      '-- DropIndex',
      'DROP INDEX "MediaObject_originalName_trgm_idx";',
      '',
      '-- AddColumn',
      'ALTER TABLE "Shot"',
      '  ADD COLUMN "note" TEXT;',
    ].join('\n');
    expect(normalizeStatements(sql)).toEqual([
      'DROP INDEX "MediaObject_originalName_trgm_idx"',
      'ALTER TABLE "Shot" ADD COLUMN "note" TEXT',
    ]);
  });

  it('an empty script produces no statement (nominal case: no drift)', () => {
    expect(normalizeStatements('')).toEqual([]);
    expect(normalizeStatements('-- rien à faire\n\n')).toEqual([]);
  });
});

describe('check-prisma-drift — comparison with the list of accepted divergences', () => {
  const allowed = ['DROP INDEX "a_trgm_idx"', 'DROP INDEX "b_trgm_idx"'];

  it('accepts exactly the declared divergences', () => {
    expect(compareStatements(allowed, allowed)).toEqual({ unexpected: [], stale: [] });
  });

  it('reports an unexpected statement — the forgotten `migrate dev`', () => {
    const observed = [...allowed, 'ALTER TABLE "Shot" ADD COLUMN "note" TEXT'];
    expect(compareStatements(observed, allowed).unexpected).toEqual([
      'ALTER TABLE "Shot" ADD COLUMN "note" TEXT',
    ]);
  });

  it('reports a declared divergence that no longer occurs — the list has become misleading', () => {
    expect(compareStatements([allowed[0]], allowed).stale).toEqual([allowed[1]]);
  });

  it('an empty list refuses any divergence', () => {
    expect(compareStatements(['DROP INDEX "x"'], []).unexpected).toEqual(['DROP INDEX "x"']);
  });
});

describe('check-prisma-drift — shadow database', () => {
  it('derives a shadow URL without touching the credentials or the port', () => {
    const url = shadowUrlFrom('postgresql://review:pw@localhost:5432/review?schema=public');
    expect(new URL(url).pathname).toBe(`/${SHADOW_DATABASE_NAME}`);
    expect(new URL(url).username).toBe('review');
    expect(new URL(url).searchParams.get('schema')).toBe('public');
  });

  it('the shadow database is never a working database', () => {
    expect(SHADOW_DATABASE_NAME).not.toBe('review');
    expect(SHADOW_DATABASE_NAME).not.toBe('review_itest');
  });
});

describe('prisma-drift-allowed.json', () => {
  const file = JSON.parse(readFileSync(path.join(here, 'prisma-drift-allowed.json'), 'utf8'));

  it('each accepted divergence carries its statement and its justification', () => {
    expect(Array.isArray(file.allowed)).toBe(true);
    for (const entry of file.allowed) {
      expect(typeof entry.statement).toBe('string');
      expect(entry.statement.length).toBeGreaterThan(0);
      // Without a written reason, an entry becomes a rug under which anything can be swept.
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  it('no statement is declared twice', () => {
    const statements = file.allowed.map((e) => e.statement);
    expect(new Set(statements).size).toBe(statements.length);
  });
});
