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

describe('check-prisma-drift — lecture du script de différence', () => {
  it('découpe le SQL en instructions et jette commentaires et mise en page', () => {
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

  it('un script vide ne produit aucune instruction (cas nominal : pas de dérive)', () => {
    expect(normalizeStatements('')).toEqual([]);
    expect(normalizeStatements('-- rien à faire\n\n')).toEqual([]);
  });
});

describe('check-prisma-drift — confrontation à la liste des divergences admises', () => {
  const allowed = ['DROP INDEX "a_trgm_idx"', 'DROP INDEX "b_trgm_idx"'];

  it('accepte exactement les divergences déclarées', () => {
    expect(compareStatements(allowed, allowed)).toEqual({ unexpected: [], stale: [] });
  });

  it('relève une instruction inattendue — le `migrate dev` oublié', () => {
    const observed = [...allowed, 'ALTER TABLE "Shot" ADD COLUMN "note" TEXT'];
    expect(compareStatements(observed, allowed).unexpected).toEqual([
      'ALTER TABLE "Shot" ADD COLUMN "note" TEXT',
    ]);
  });

  it('relève une divergence déclarée qui ne se produit plus — la liste devenue mensongère', () => {
    expect(compareStatements([allowed[0]], allowed).stale).toEqual([allowed[1]]);
  });

  it('une liste vide refuse toute divergence', () => {
    expect(compareStatements(['DROP INDEX "x"'], []).unexpected).toEqual(['DROP INDEX "x"']);
  });
});

describe('check-prisma-drift — base fantôme', () => {
  it('dérive une URL fantôme sans toucher aux identifiants ni au port', () => {
    const url = shadowUrlFrom('postgresql://review:pw@localhost:5432/review?schema=public');
    expect(new URL(url).pathname).toBe(`/${SHADOW_DATABASE_NAME}`);
    expect(new URL(url).username).toBe('review');
    expect(new URL(url).searchParams.get('schema')).toBe('public');
  });

  it('la base fantôme n’est jamais une base de travail', () => {
    expect(SHADOW_DATABASE_NAME).not.toBe('review');
    expect(SHADOW_DATABASE_NAME).not.toBe('review_itest');
  });
});

describe('prisma-drift-allowed.json', () => {
  const file = JSON.parse(readFileSync(path.join(here, 'prisma-drift-allowed.json'), 'utf8'));

  it('chaque divergence admise porte son instruction et sa justification', () => {
    expect(Array.isArray(file.allowed)).toBe(true);
    for (const entry of file.allowed) {
      expect(typeof entry.statement).toBe('string');
      expect(entry.statement.length).toBeGreaterThan(0);
      // Sans motif écrit, une entrée devient un tapis sous lequel glisser n'importe quoi.
      expect(entry.why.length).toBeGreaterThan(40);
    }
  });

  it('aucune instruction n’est déclarée deux fois', () => {
    const statements = file.allowed.map((e) => e.statement);
    expect(new Set(statements).size).toBe(statements.length);
  });
});
