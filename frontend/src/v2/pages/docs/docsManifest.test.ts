// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  filterSections,
  isInternalDocHref,
  neighbours,
  resolveDocHref,
  sectionLabel,
  sectionOf,
  type DocsSection,
} from './docsManifest';
import { t } from '../../i18n';

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

const page = (path: string, title: string, summary = '') => ({ path, title, summary, updated: '2026-08-23' });

const sections: DocsSection[] = [
  {
    dir: 'user-guide',
    label: 'User Guide',
    pages: [
      page('user-guide/review-video.md', 'Video review', 'Frame-accurate playback and comparison.'),
      page('user-guide/boards.md', 'Boards'),
    ],
  },
  { dir: 'api', label: 'Api', pages: [page('api/errors.md', 'Error handling')] },
];

describe('filterSections', () => {
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
  it('cherche jusque dans le sous-titre — c’est là que vivent les mots du lecteur', () => {
    const out = filterSections(sections, 'comparison');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual(['user-guide/review-video.md']);
  });
});

describe('sectionOf', () => {
  it('rend la section qui porte la page', () => {
    expect(sectionOf(sections, 'api/errors.md')?.dir).toBe('api');
  });
  it('rend undefined pour une page absente du sommaire', () => {
    expect(sectionOf(sections, 'inconnue.md')).toBeUndefined();
  });
});

describe('neighbours', () => {
  it('enjambe la frontière des sections — le sommaire se lit d’un bout à l’autre', () => {
    const { previous, next } = neighbours(sections, 'user-guide/boards.md');
    expect(previous?.path).toBe('user-guide/review-video.md');
    expect(next?.path).toBe('api/errors.md');
  });
  it('la première page n’a pas de précédente, la dernière pas de suivante', () => {
    expect(neighbours(sections, 'user-guide/review-video.md').previous).toBeUndefined();
    expect(neighbours(sections, 'api/errors.md').next).toBeUndefined();
  });
  it('rend un couple vide pour une page absente', () => {
    expect(neighbours(sections, 'inconnue.md')).toEqual({});
  });
});

describe('sectionLabel', () => {
  it('traduit les sections connues', () => {
    expect(sectionLabel({ dir: 'user-guide', label: 'User Guide' }, t)).toBe(t('docs.sectionUserGuide'));
  });
  it('garde le libellé du manifest pour un dossier inconnu', () => {
    expect(sectionLabel({ dir: 'tutorials', label: 'Tutorials' }, t)).toBe('Tutorials');
  });
});
