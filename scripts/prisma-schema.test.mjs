// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Invariants du modèle de données.
 *
 * Deux familles de garanties vivent hors de portée du compilateur, et se sont donc perdues
 * en silence :
 *
 *  1. **Les index de clés étrangères.** Postgres indexe la colonne RÉFÉRENCÉE, jamais celle
 *     qui référence. Trente-quatre colonnes de rattachement s'étaient accumulées sans index
 *     de tête — dont `MediaObject.uploaderId`, balayé intégralement à chaque demande
 *     d'upload. Rien ne le signalait : un `@@index` oublié ne casse aucun test, il rend la
 *     requête lente. Le contrôle ci-dessous relit le schéma et refuse toute nouvelle
 *     relation dont la clé n'ouvre pas un index.
 *
 *  2. **Ce que Prisma ne sait pas exprimer.** Index partiels (portées nullables) et
 *     contraintes CHECK n'existent que dans le SQL des migrations : `schema.prisma` les
 *     ignore, `prisma validate` aussi. Une migration ultérieure peut les faire disparaître
 *     sans que rien ne proteste. On vérifie donc leur présence par leur nom.
 *
 * Volontairement textuel : le but n'est pas de réimplémenter l'analyseur de Prisma, mais
 * d'empêcher la disparition silencieuse de garde-fous que personne ne relit.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = join(ROOT, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = join(ROOT, 'backend', 'prisma', 'migrations');

/** Corps de chaque `model X { … }` du schéma, indexé par nom. */
export function parseModels(schema) {
  const models = new Map();
  for (const [, name, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    models.set(name, body);
  }
  return models;
}

/** Colonnes portant une clé étrangère (`@relation(fields: [...])`) dans un corps de modèle. */
export function foreignKeyColumns(body) {
  const columns = [];
  for (const [, list] of body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*\)/g)) {
    columns.push(...list.split(',').map((c) => c.trim()));
  }
  return columns;
}

/**
 * Colonnes qui ouvrent un index. Seule la PREMIÈRE colonne d'un index composite compte :
 * un index `(userId, projectId)` ne sert à rien pour une recherche par `projectId`.
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
  // `PipelineEnsureService` rattrape la violation d'unicité (P2002) pour converger vers
  // l'entité gagnante. Sans contrainte en face, ce rattrapage ne se déclenche jamais et
  // deux publications simultanées créent deux jumelles.
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
  // Index partiels : Postgres tient les NULL pour distincts, un `@@unique` ordinaire ne
  // couvre donc pas les portées nullables (référentiel de studio, plan sans séquence,
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

  // CHECK : les trois XOR du modèle. Une ligne rattachée aux deux parents — ou à aucun —
  // n'apparaît dans AUCUN listing sans être fausse pour autant : elle est invisible.
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
