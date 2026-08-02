// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { filterSections, isInternalDocHref, resolveDocHref, type DocsSection } from './docsManifest';

describe('resolveDocHref', () => {
  it('résout un lien relatif dans le même dossier', () => {
    expect(resolveDocHref('user-guide/review-video.md', 'annotations.md')).toBe('user-guide/annotations.md');
  });
  it('résout les remontées ../', () => {
    expect(resolveDocHref('user-guide/review-video.md', '../api/errors.md')).toBe('api/errors.md');
  });
  it('résout depuis la racine (README.md)', () => {
    expect(resolveDocHref('README.md', 'getting-started/installation.md')).toBe(
      'getting-started/installation.md',
    );
  });
  it('préserve les ancres', () => {
    expect(resolveDocHref('api/index.md', './errors.md#codes')).toBe('api/errors.md#codes');
  });
});

describe('isInternalDocHref', () => {
  it('accepte les chemins relatifs', () => {
    expect(isInternalDocHref('annotations.md')).toBe(true);
    expect(isInternalDocHref('../api/errors.md')).toBe(true);
  });
  it('rejette protocoles, ancres seules et chemins absolus', () => {
    expect(isInternalDocHref('https://example.com')).toBe(false);
    expect(isInternalDocHref('mailto:x@y.z')).toBe(false);
    expect(isInternalDocHref('#section')).toBe(false);
    expect(isInternalDocHref('/docs/foo.md')).toBe(false);
  });
});

describe('filterSections', () => {
  const sections: DocsSection[] = [
    {
      dir: 'user-guide',
      label: 'User Guide',
      pages: [
        { path: 'user-guide/review-video.md', title: 'Video review' },
        { path: 'user-guide/boards.md', title: 'Boards' },
      ],
    },
    { dir: 'api', label: 'Api', pages: [{ path: 'api/errors.md', title: 'Error handling' }] },
  ];

  it('sans requête, rend tout', () => {
    expect(filterSections(sections, '  ')).toEqual(sections);
  });
  it('filtre par titre (insensible à la casse) et retire les sections vides', () => {
    const out = filterSections(sections, 'VIDEO');
    expect(out).toHaveLength(1);
    expect(out[0].pages.map((p) => p.path)).toEqual(['user-guide/review-video.md']);
  });
  it('filtre aussi par chemin', () => {
    const out = filterSections(sections, 'errors');
    expect(out.map((s) => s.dir)).toEqual(['api']);
  });
});
