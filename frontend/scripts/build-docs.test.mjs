// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { orderSections, pageTitle, sectionLabel } from './build-docs.mjs';

const dir = mkdtempSync(join(tmpdir(), 'review-build-docs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const md = (name, content) => {
  const file = join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
};

describe('sectionLabel', () => {
  it('met en capitales chaque mot d’un nom de dossier', () => {
    expect(sectionLabel('getting-started')).toBe('Getting Started');
    expect(sectionLabel('api')).toBe('Api');
  });
});

describe('orderSections', () => {
  it('range les sections connues dans l’ordre du sommaire', () => {
    expect(orderSections(['development', 'api', 'getting-started'])).toEqual([
      'getting-started',
      'api',
      'development',
    ]);
  });

  it('renvoie les sections inconnues à la fin, par ordre alphabétique', () => {
    expect(orderSections(['zebra', 'api', 'alpha'])).toEqual(['api', 'alpha', 'zebra']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const dirs = ['development', 'api'];
    orderSections(dirs);
    expect(dirs).toEqual(['development', 'api']);
  });
});

describe('pageTitle', () => {
  it('retient le premier titre de niveau 1', async () => {
    expect(await pageTitle(md('page.md', '# Validation & tests\n\nTexte.\n'))).toBe('Validation & tests');
  });

  it('retombe sur le nom du fichier quand la page n’a pas de titre', async () => {
    expect(await pageTitle(md('sans-titre.md', 'Juste du texte.\n'))).toBe('sans-titre');
  });

  it('ignore un titre de niveau 2', async () => {
    expect(await pageTitle(md('niveau2.md', '## Sous-titre\n\n# Vrai titre\n'))).toBe('Vrai titre');
  });
});
