// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants of the data model.
 *
 * Two families of guarantees live out of the compiler's reach, and were therefore lost
 * en silence :
 *
 *  1. **Foreign-key indexes.** Postgres indexes the REFERENCED column, never the one
 *     that references. Thirty-four link columns had piled up without a leading index
 *     — including `MediaObject.uploaderId`, fully scanned on every upload
 *     request. Nothing flagged it: a forgotten `@@index` breaks no test, it makes the
 *     query slow. The check below re-reads the schema and refuses any new
 *     relation whose key does not open an index.
 *
 *  2. **What Prisma cannot express.** Partial indexes (nullable scopes) and
 *     CHECK constraints only exist in the SQL of the migrations: `schema.prisma`
 *     ignores them, and so does `prisma validate`. A later migration can make them vanish
 *     without anything complaining. Their presence is therefore checked by name.
 *
 * Deliberately textual: the aim is not to reimplement Prisma's parser, but
 * to prevent the silent disappearance of guardrails that nobody re-reads.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(ROOT, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = join(ROOT, 'backend', 'prisma', 'migrations');

/** Body of each `model X { … }` of the schema, indexed by name. */
export function parseModels(schema) {
  const models = new Map();
  for (const [, name, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.set(name, body);
  }
  return models;
}

/** Columns carrying a foreign key (`@relation(fields: [...])`) in a model body. */
export function foreignKeyColumns(body) {
  const columns = [];
  for (const [, list] of body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*\)/g)) {
    columns.push(...list.split(',').map((c) => c.trim()));
  }
  return columns;
}

/**
 * Columns that open an index. Only the FIRST column of a composite index counts:
 * an index `(userId, projectId)` is useless for a search by `projectId`.
 */
export function indexedHeadColumns(body) {
  const heads = new Set();
  for (const [, list] of body.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]/g)) {
    heads.add(list.split(',')[0].trim());
  }
  for (const [, column] of body.matchAll(/^\s*(\w+)\s+\S+.*@(?:unique|id)\b/gm)) heads.add(column);
  return heads;
}

const schema = readFileSync(SCHEMA_PATH, 'utf8');
const models = parseModels(schema);

const migrationSql = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(MIGRATIONS_DIR, entry.name, 'migration.sql'), 'utf8'))
  .join('\n');

describe('index de clés étrangères', () => {
  it('lit un schéma plausible', () => {
    expect(models.size).toBeGreaterThan(40);
  });

  it('donne un index de tête à chaque clé étrangère', () => {
    const missing = [];
    for (const [name, body] of models) {
      const heads = indexedHeadColumns(body);
      for (const column of foreignKeyColumns(body)) {
        if (!heads.has(column)) missing.push(`${name}.${column}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('unicités métier des chemins « chercher puis créer »', () => {
  // `PipelineEnsureService` catches the uniqueness violation (P2002) to converge on
  // the winning entity. Without a constraint facing it, this catch never fires and
  // two simultaneous publications create two twins.
  const expected = [
    ['Task', '@@unique([shotId, departmentId, name])'],
    ['Task', '@@unique([assetId, departmentId, name])'],
    ['Version', '@@unique([taskId, name])'],
    ['Version', '@@unique([assetId, name])'],
  ];
  for (const [model, declaration] of expected) {
    it(`${model} porte ${declaration}`, () => {
      expect(models.get(model)).toContain(declaration);
    });
  }
});

describe('garde-fous SQL invisibles de Prisma', () => {
  // Partial indexes: Postgres treats NULLs as distinct, so a plain `@@unique` does not
  // cover nullable scopes (studio reference, shot without sequence,
  // montage de projet).
  const partialIndexes = [
    'Department_studio_key_unique',
    'Department_project_key_unique',
    'PipelineStatus_studio_code_unique',
    'PipelineStatus_project_code_unique',
    'Shot_project_code_no_sequence_unique',
    'Timeline_project_unique_no_sequence',
  ];
  for (const name of partialIndexes) {
    it(`conserve l'index partiel ${name}`, () => {
      expect(migrationSql).toContain(`CREATE UNIQUE INDEX "${name}"`);
    });
  }

  // CHECK: the three XORs of the model. A row attached to both parents — or to neither —
  // appears in NO listing without being wrong for all that: it is invisible.
  const checks = [
    'Task_parent_xor',
    'Version_parent_xor',
    'Board_parent_xor',
    'ShareLink_viewCount_non_negative',
  ];
  for (const name of checks) {
    it(`conserve la contrainte ${name}`, () => {
      expect(migrationSql).toContain(`ADD CONSTRAINT "${name}" CHECK`);
    });
  }

  it('ne réintroduit pas de suppression de ces objets', () => {
    for (const name of [...partialIndexes, ...checks]) {
      expect(migrationSql).not.toContain(`DROP INDEX "${name}"`);
      expect(migrationSql).not.toContain(`DROP CONSTRAINT "${name}"`);
    }
  });
});
