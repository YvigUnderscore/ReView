// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Ce que les index posés en SQL doivent respecter pour SERVIR l'application.
 *
 * Un index peut être parfaitement écrit et rester inerte : ces contrôles gardent la seule
 * règle qui l'a décidé ici, découverte en mesurant et non en lisant.
 *
 * **Le piège de l'enum.** Prisma n'écrit pas `status = 'READY'` mais
 * `status = CAST($n::text AS "MediaStatus")`. La fonction d'entrée d'un enum (`enum_in`) est
 * STABLE et non IMMUTABLE : Postgres ne sait donc pas prouver que la requête implique le
 * prédicat d'un index partiel qui, lui, compare à une constante. Un index partiel fondé sur
 * `status` (ou sur un booléen, que Prisma passe aussi en paramètre) n'est jamais utilisé par
 * l'application — il coûte à chaque écriture et ne rend rien. Seules les nullités
 * (`IS NULL`, `IS NOT NULL`) sont écrites littéralement par Prisma, donc prouvables.
 * Vérifié : le plan de `MediaService.listPublished` passe du `Seq Scan` + `top-N heapsort`
 * (4 466 blocs lus) au parcours ordonné (1 337 blocs, 1,0 ms) selon que le prédicat s'en
 * tient aux nullités ou non — à prédicat « mieux ciblé », aucun effet.
 *
 * Ces tests lisent les fichiers de migration : ils ne mesurent pas un plan (c'est le rôle
 * d'`EXPLAIN`, dont les relevés sont consignés dans l'en-tête de chaque migration), ils
 * empêchent de reposer le piège.
 */

const MIGRATIONS = path.join(process.cwd(), 'prisma', 'migrations');

/** Le SQL de toutes les migrations, concaténé, commentaires retirés. */
function allMigrationSql(): string {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(path.join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'))
    .join('\n')
    .replace(/--[^\n]*/g, '');
}

/** Prédicat de chaque `CREATE INDEX … WHERE …` du dépôt, tel qu'il est écrit. */
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

describe('index partiels — leur prédicat doit être prouvable depuis Prisma', () => {
  it('ne se fonde que sur des nullités, jamais sur un enum ni sur un booléen', () => {
    const nullity = /^"?[A-Za-z_][A-Za-z0-9_]*"?\s+IS\s+(NOT\s+)?NULL$/i;
    const offenders = partialIndexPredicates().filter(({ predicate }) =>
      predicate
        .replace(/^\(|\)$/g, '')
        .split(/\s+AND\s+/i)
        .some((clause) => !nullity.test(clause.replace(/^\(|\)$/g, '').trim())),
    );
    expect(offenders).toEqual([]);
  });

  it('couvre au moins un prédicat, sinon le contrôle ne contrôle rien', () => {
    expect(partialIndexPredicates().length).toBeGreaterThan(0);
  });
});

describe('MediaObject — l’index des listings porte l’ordre, pas un filtre qui ne filtre rien', () => {
  const sql = allMigrationSql().replace(/\s+/g, ' ');

  it('retire l’index à quatre colonnes que les deux listings n’ont jamais emprunté', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS "MediaObject_deletedAt_published_status_createdAt_idx"');
  });

  it('pose l’ordre des listings sur « createdAt » décroissant, corbeille exclue', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "MediaObject_alive_recent_idx" ON "MediaObject" \("createdAt" DESC, "id" DESC\) WHERE "deletedAt" IS NULL/,
    );
  });

  it('laisse au balayage de purge de corbeille de quoi travailler', () => {
    // Retirer l'index à quatre colonnes privait `lib/trash.ts` de son seul appui sur
    // `deletedAt` : mesuré, sa requête repassait de 3 à 37 blocs lus.
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "MediaObject_trashed_idx" ON "MediaObject" \("deletedAt"\) WHERE "deletedAt" IS NOT NULL/,
    );
  });
});
