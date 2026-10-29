// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  orderPages,
  orderSections,
  pageHeadings,
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
  it('capitalizes each word of a folder name', () => {
    expect(sectionLabel('getting-started')).toBe('Getting Started');
    expect(sectionLabel('api')).toBe('Api');
  });
});

describe('orderSections', () => {
  it('orders the known sections in the table-of-contents order', () => {
    expect(orderSections(['development', 'api', 'getting-started'])).toEqual([
      'getting-started',
      'api',
      'development',
    ]);
  });

  it('returns unknown sections at the end, in alphabetical order', () => {
    expect(orderSections(['zebra', 'api', 'alpha'])).toEqual(['api', 'alpha', 'zebra']);
  });

  it('does not modify the array received', () => {
    const dirs = ['development', 'api'];
    orderSections(dirs);
    expect(dirs).toEqual(['development', 'api']);
  });
});

describe('pageTitle', () => {
  it('keeps the first level-1 heading', async () => {
    expect(await pageTitle(md('page.md', '# Validation & tests\n\nTexte.\n'))).toBe('Validation & tests');
  });

  it('falls back to the file name when the page has no title', async () => {
    expect(await pageTitle(md('sans-titre.md', 'Juste du texte.\n'))).toBe('sans-titre');
  });

  it('ignores a level-2 heading', async () => {
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

  it('reads title, subtitle and update date', () => {
    expect(parsePageMeta(page, 'fallback')).toEqual({
      title: 'Video review',
      summary: 'Frame-accurate playback, comparison and timeline markers.',
      updated: '2026-08-23',
    });
  });

  it('tolerates a page without a preamble: it remains servable', () => {
    expect(parsePageMeta('# Titre seul\n\nTexte.\n', 'fallback')).toEqual({
      title: 'Titre seul',
      summary: '',
      updated: '',
    });
  });

  it('does not take a bold paragraph for a subtitle', () => {
    expect(parsePageMeta('# Titre\n\n**Gras.**\n', 'fallback').summary).toBe('');
  });

  it('falls back to the file name when there is no title', () => {
    expect(parsePageMeta('Texte.\n', 'sans-titre').title).toBe('sans-titre');
  });
});

/**
 * Chapter titles are the only content index of the documentation: without them, the
 * palette returned nothing for "watermark", although three chapters talk about it.
 */
describe('pageHeadings', () => {
  it('keeps the chapters, not the page title', () => {
    const page = '# Secure distribution\n\n## Viewer watermark\n\ntexte\n\n### Burn-in\n';
    expect(pageHeadings(page)).toEqual(['Viewer watermark', 'Burn-in']);
  });

  it('ignores the hashes of a code block: a shell comment is not a chapter', () => {
    const page = ['## Vrai chapitre', '', '```bash', '## pas un chapitre', '```', ''].join('\n');
    expect(pageHeadings(page)).toEqual(['Vrai chapitre']);
  });

  it('renders the title as plain text and does not repeat it', () => {
    const page = '## Using `ffmpeg`\n\n## Using `ffmpeg`\n\n## The **hard** part\n';
    expect(pageHeadings(page)).toEqual(['Using ffmpeg', 'The hard part']);
  });

  it('returns an empty list for a page without chapters', () => {
    expect(pageHeadings('# Titre\n\nUn paragraphe.\n')).toEqual([]);
  });
});

describe('orderPages', () => {
  it('follows the reading order of the section, not the alphabet', () => {
    expect(orderPages('api', ['python-client.md', 'overview.md', 'authentication.md'])).toEqual([
      'overview.md',
      'authentication.md',
      'python-client.md',
    ]);
  });

  it('puts the pages outside the table of contents at the end, in alphabetical order', () => {
    expect(orderPages('api', ['zeta.md', 'overview.md', 'alpha.md'])).toEqual([
      'overview.md',
      'alpha.md',
      'zeta.md',
    ]);
  });

  it('falls back to the alphabet for an unknown section', () => {
    expect(orderPages('tutorials', ['b.md', 'a.md'])).toEqual(['a.md', 'b.md']);
  });

  it('does not modify the array received', () => {
    const files = ['python-client.md', 'overview.md'];
    orderPages('api', files);
    expect(files).toEqual(['python-client.md', 'overview.md']);
  });
});

describe('unlistedPages', () => {
  it('reports the pages missing from the table of contents', () => {
    expect(unlistedPages('api', ['overview.md', 'nouvelle.md'])).toEqual(['nouvelle.md']);
  });

  it('reports nothing for a section without a table of contents', () => {
    expect(unlistedPages('tutorials', ['a.md'])).toEqual([]);
  });
});

describe('plainText', () => {
  it('strips inline markdown: title and subtitle are rendered as plain text', () => {
    expect(plainText('From `git clone` to a running studio')).toBe('From git clone to a running studio');
    expect(plainText('the only **ADMIN** of the studio')).toBe('the only ADMIN of the studio');
    expect(plainText('see [the guide](x.md) first')).toBe('see the guide first');
  });

  it('leaves ordinary text intact', () => {
    expect(plainText('  Video review  ')).toBe('Video review');
  });
});
