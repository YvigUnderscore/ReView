// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  orderPages,
  orderSections,
  pageTitle,
  parsePageMeta,
  plainText,
  sectionLabel,
  unlistedPages,
} from './build-docs.mjs';

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

describe('parsePageMeta', () => {
  const page = [
    '# Video review',
    '',
    '*Frame-accurate playback, comparison and timeline markers.*',
    '',
    '> Updated: 2026-08-23',
    '',
    '## Transport',
  ].join('\n');

  it('lit titre, sous-titre et date de mise à jour', () => {
    expect(parsePageMeta(page, 'fallback')).toEqual({
      title: 'Video review',
      summary: 'Frame-accurate playback, comparison and timeline markers.',
      updated: '2026-08-23',
    });
  });

  it('tolère une page sans préambule : elle reste servable', () => {
    expect(parsePageMeta('# Titre seul\n\nTexte.\n', 'fallback')).toEqual({
      title: 'Titre seul',
      summary: '',
      updated: '',
    });
  });

  it('ne prend pas un paragraphe en gras pour un sous-titre', () => {
    expect(parsePageMeta('# Titre\n\n**Gras.**\n', 'fallback').summary).toBe('');
  });

  it('retombe sur le nom de fichier quand il n’y a pas de titre', () => {
    expect(parsePageMeta('Texte.\n', 'sans-titre').title).toBe('sans-titre');
  });
});

describe('orderPages', () => {
  it('suit l’ordre de lecture de la section, pas l’alphabet', () => {
    expect(orderPages('api', ['python-client.md', 'overview.md', 'authentication.md'])).toEqual([
      'overview.md',
      'authentication.md',
      'python-client.md',
    ]);
  });

  it('range les pages hors sommaire à la fin, par ordre alphabétique', () => {
    expect(orderPages('api', ['zeta.md', 'overview.md', 'alpha.md'])).toEqual([
      'overview.md',
      'alpha.md',
      'zeta.md',
    ]);
  });

  it('retombe sur l’alphabet pour une section inconnue', () => {
    expect(orderPages('tutorials', ['b.md', 'a.md'])).toEqual(['a.md', 'b.md']);
  });

  it('ne modifie pas le tableau reçu', () => {
    const files = ['python-client.md', 'overview.md'];
    orderPages('api', files);
    expect(files).toEqual(['python-client.md', 'overview.md']);
  });
});

describe('unlistedPages', () => {
  it('signale les pages absentes du sommaire', () => {
    expect(unlistedPages('api', ['overview.md', 'nouvelle.md'])).toEqual(['nouvelle.md']);
  });

  it('ne signale rien pour une section sans sommaire', () => {
    expect(unlistedPages('tutorials', ['a.md'])).toEqual([]);
  });
});

describe('plainText', () => {
  it('retire le markdown en ligne — titre et sous-titre sont rendus en texte brut', () => {
    expect(plainText('From `git clone` to a running studio')).toBe('From git clone to a running studio');
    expect(plainText('the only **ADMIN** of the studio')).toBe('the only ADMIN of the studio');
    expect(plainText('see [the guide](x.md) first')).toBe('see the guide first');
  });

  it('laisse le texte ordinaire intact', () => {
    expect(plainText('  Video review  ')).toBe('Video review');
  });
});
