// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Schema-level guards on the indexes written in SQL, to SERVE the application.
 *
 * An index can be perfectly written and remain inert: these checks guard the only rule that decided it here,
 * discovered by measuring rather than by reading.
 *
 * **The enum trap.** Prisma does not write `status = 'READY'` but `status = CAST($n::text AS "MediaStatus")`. An enum's
 * input function (`enum_in`) is STABLE and not IMMUTABLE: Postgres therefore cannot prove that the query implies the
 * predicate of a partial index that compares against a constant. A partial index based on `status` (or on a boolean,
 * which Prisma also passes as a parameter) is never used by the application — it costs on every write and yields
 * nothing. Only nullity tests (`IS NULL`, `IS NOT NULL`) are written literally by Prisma, hence provable.
 * Verified: the plan of `MediaService.listPublished` goes from `Seq Scan` + `top-N heapsort` (4,466 blocks read) to the
 * ordered index walk (1,337 blocks, 1.0 ms) depending on whether the predicate sticks to nullity tests or not — with a
 * "better targeted" predicate, no effect.
 *
 * These tests read the migration files: they do not measure a plan (that is the role of `EXPLAIN`, whose readings are
 * recorded in the header of each migration), they prevent the trap from being walked into again.
 */

const MIGRATIONS = path.join(process.cwd(), 'prisma', 'migrations');

/** The SQL of all migrations, concatenated, comments stripped. */
function allMigrationSql(): string {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(path.join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '');
}

/** Predicate of each `CREATE INDEX … WHERE …` in the repository, as written. */
function partialIndexPredicates(): { index: string; predicate: string }[] {
  const statements = allMigrationSql().split(';');
  const found: { index: string; predicate: string }[] = [];
  for (const statement of statements) {
    const flat = statement.replace(/\s+/g, ' ').trim();
    const match = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"([^"]+)".* WHERE (.+)$/i.exec(flat);
    if (match) found.push({ index: match[1]!, predicate: match[2]!.trim() });
  }
  return found;
}

describe('partial indexes — their predicate must be provable from Prisma', () => {
  it('relies only on nullity tests, never on an enum or a boolean', () => {
    const nullity = /^"?[A-Za-z_][A-Za-z0-9_]*"?\s+IS\s+(NOT\s+)?NULL$/i;
    const offenders = partialIndexPredicates().filter(({ predicate }) =>
      predicate
        .replace(/^\(|\)$/g, '')
        .split(/\s+AND\s+/i)
        .some((clause) => !nullity.test(clause.replace(/^\(|\)$/g, '').trim())),
    );
    expect(offenders).toEqual([]);
  });

  it('covers at least one predicate, otherwise the check checks nothing', () => {
    expect(partialIndexPredicates().length).toBeGreaterThan(0);
  });
});

describe('MediaObject — the listings index carries the order, not a filter that filters nothing', () => {
  const sql = allMigrationSql().replace(/\s+/g, ' ');

  it('removes the four-column index that the two listings never borrowed', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS "MediaObject_deletedAt_published_status_createdAt_idx"');
  });

  it('sets the listing order on "createdAt" descending, trash excluded', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "MediaObject_alive_recent_idx" ON "MediaObject" \("createdAt" DESC, "id" DESC\) WHERE "deletedAt" IS NULL/,
    );
  });

  it('leaves the trash purge sweep something to work with', () => {
    // Removing the four-column index deprived `lib/trash.ts` of its only support on `deletedAt`: measured, its query
    // went from 3 to 37 blocks read.
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "MediaObject_trashed_idx" ON "MediaObject" \("deletedAt"\) WHERE "deletedAt" IS NOT NULL/,
    );
  });
});
