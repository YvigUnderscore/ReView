// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isAllowed, isIdentifierLike, isUtilityClasses, scan } from './check-untranslated.mjs';

/** Throwaway .tsx file: `scan` reads from disk, not from memory. */
const dir = mkdtempSync(join(tmpdir(), 'review-untranslated-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const scanSource = (source, name = 'Sample.tsx') => {
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return scan(file);
};

describe('isAllowed', () => {
  it('lets through the acronyms and units of the admitted vocabulary', () => {
    expect(isAllowed('API')).toBe(true);
    expect(isAllowed('1920 px')).toBe(true);
    expect(isAllowed('dailies')).toBe(true);
  });

  it('refuses ordinary prose', () => {
    expect(isAllowed('Supprimer le projet')).toBe(false);
    expect(isAllowed('Delete project')).toBe(false);
  });

  it('lets through a text with no letters at all', () => {
    expect(isAllowed('— 12 : 34 %')).toBe(true);
  });
});

describe('isUtilityClasses', () => {
  it('recognises a stack of Tailwind classes', () => {
    expect(isUtilityClasses('flex items-center gap-2')).toBe(true);
  });

  it('does not take a sentence for classes', () => {
    expect(isUtilityClasses('Ajouter un plan')).toBe(false);
  });

  it('requires at least one compound word — two bare words are not classes', () => {
    expect(isUtilityClasses('flex block')).toBe(false);
  });
});

describe('isIdentifierLike', () => {
  it('sets aside identifiers, paths and keys', () => {
    for (const text of ['task-status', 'camelCase', 'SCREAMING_SNAKE', '/api/projects', 'review:tree:']) {
      expect(isIdentifierLike(text), text).toBe(true);
    }
  });

  it('does not take prose for an identifier', () => {
    expect(isIdentifierLike('Ajouter un plan')).toBe(false);
  });
});

describe('scan', () => {
  it('reports hard-coded JSX text', () => {
    expect(scanSource('export const A = () => <p>Ajouter un plan</p>;')).toContain('Ajouter un plan');
  });

  it('reports a hard-coded visible prop', () => {
    expect(scanSource('export const A = () => <input placeholder="Nom du projet" />;')).toContain(
      'Nom du projet',
    );
  });

  it('reports a sentence assembled around an interpolation', () => {
    const found = scanSource('export const A = (n: number) => <p>{`${n} fichiers supprimés`}</p>;');
    expect(found.join(' ')).toMatch(/fichiers supprim/);
  });

  it('lets through text translated by t()', () => {
    expect(scanSource('export const A = ({ t }) => <p>{t("shots.add")}</p>;')).toEqual([]);
  });

  it('lets through a technical literal placed in <code>', () => {
    expect(scanSource('export const A = () => <code>docker compose up -d</code>;')).toEqual([]);
  });

  it('lets through a CSS class and a URL', () => {
    expect(
      scanSource('export const A = () => <a className="flex items-center" href="/api/docs" />;'),
    ).toEqual([]);
  });

  /**
   * Blind spot closed in Phase 50: the shortcut help passed its key names as a LIST
   * (`keys={['Espace', 'Maj']}`), and the check stopped at the opening bracket. The thirteen
   * other languages displayed "Espace" and "Maj".
   */
  it('reports a hard-coded key name passed in a list', () => {
    const found = scanSource('export const A = () => <Keys keys={["Espace", "Maj"]} />;');
    expect(found).toContain('Espace');
    expect(found).toContain('Maj');
  });

  it('lets through key names that no language renders otherwise', () => {
    // Each element is judged on its own: glued end to end, "Ctrl K" would pass for a sentence.
    expect(scanSource('export const A = () => <Keys keys={["Ctrl", "K"]} />;')).toEqual([]);
  });
});

/**
 * The three blind spots closed after the audit of 2026-08-21: the check passed green
 * while eight French strings reached the screen.
 */
describe('scan — text returned by a function', () => {
  it('reports a literal returned by a function declared `: string`', () => {
    const src = `export function statut(u: { s: string }): string {
      switch (u.s) { case 'pending': return 'En attente…'; default: return 'Traitement…'; }
    }`;
    expect(scanSource(src, 'Fn.ts')).toEqual(['En attente…', 'Traitement…']);
  });

  it('reports a literal returned by a function with a speaking name', () => {
    expect(
      scanSource('export const statusLabel = (s: string) => (s ? "Terminé" : "En cours");', 'B.ts'),
    ).toEqual(['Terminé', 'En cours']);
  });

  it('lets through a technical function, even when declared `: string`', () => {
    expect(
      scanSource('export function bucket(id: number): string { return `derived/${id}`; }', 'C.ts'),
    ).toEqual([]);
  });

  it('lets through a MIME type and a CSS value returned by a function', () => {
    const src = `export const fallbackType = (m?: string): string => m ?? 'application/octet-stream';
      export function clip(): string { return 'polygon(0 0, 0 0, 0 0)'; }`;
    expect(scanSource(src, 'D.ts')).toEqual([]);
  });
});

describe('scan — label table and t() outside a function', () => {
  it('reports the text of a label table whose key is a business identifier', () => {
    const src = `export const VERSION_STATUS_LABEL: Record<string, string> = {
      DRAFT: 'Brouillon', REVIEW: 'En review',
    };`;
    expect(scanSource(src, 'E.ts')).toEqual(['Brouillon', 'En review']);
  });

  it('reports a t() called outside any function — the language is frozen there at import', () => {
    const src = `import { t } from '../i18n';
      export const LABELS = { DRAFT: t('reviews.draft') };`;
    expect(scanSource(src, 'F.ts')).toEqual(["t('reviews.draft') hors fonction — langue figée à l'import"]);
  });

  it('laisse passer un t() appelé dans une fonction, un constructeur compris', () => {
    const src = `import { t } from '../i18n';
      export class E extends Error { constructor() { super(t('uploads.error.storage')); } }
      export const label = () => t('reviews.draft');`;
    expect(scanSource(src, 'G.ts')).toEqual([]);
  });
});

describe('scan — concaténation', () => {
  it('relève une phrase assemblée par +', () => {
    const found = scanSource('export const A = ({ n }: { n: number }) => <p>{"Reste " + n + " objets"}</p>;');
    // The order follows the walk of the tree (`('Reste ' + n) + ' objets'`), not the sentence.
    expect([...found].sort()).toEqual(['Reste', 'objets']);
  });
});
