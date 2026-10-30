// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  isInternalDocHref,
  neighbours,
  resolveDocHref,
  sectionLabel,
  sectionOf,
  type DocsSection,
} from './docsManifest';
import { t } from '../../i18n';

describe('resolveDocHref', () => {
  it('resolves a relative link in the same folder', () => {
    expect(resolveDocHref('user-guide/review-video.md', 'annotations.md')).toBe('user-guide/annotations.md');
  });
  it('resolves ../ climbs', () => {
    expect(resolveDocHref('user-guide/review-video.md', '../api/errors.md')).toBe('api/errors.md');
  });
  it('resolves from the root (README.md)', () => {
    expect(resolveDocHref('README.md', 'getting-started/installation.md')).toBe(
      'getting-started/installation.md',
    );
  });
  it('preserves anchors', () => {
    expect(resolveDocHref('api/index.md', './errors.md#codes')).toBe('api/errors.md#codes');
  });
});

describe('isInternalDocHref', () => {
  it('accepts relative paths', () => {
    expect(isInternalDocHref('annotations.md')).toBe(true);
    expect(isInternalDocHref('../api/errors.md')).toBe(true);
  });
  it('rejects protocols, bare anchors and absolute paths', () => {
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

// Search (the table-of-contents filter and the palette ranking) lives in `docsSearch`:
// its tests are in `docsSearch.test.ts`.

describe('sectionOf', () => {
  it('returns the section that holds the page', () => {
    expect(sectionOf(sections, 'api/errors.md')?.dir).toBe('api');
  });
  it('returns undefined for a page absent from the table of contents', () => {
    expect(sectionOf(sections, 'inconnue.md')).toBeUndefined();
  });
});

describe('neighbours', () => {
  it('crosses section boundaries: the table of contents reads from end to end', () => {
    const { previous, next } = neighbours(sections, 'user-guide/boards.md');
    expect(previous?.path).toBe('user-guide/review-video.md');
    expect(next?.path).toBe('api/errors.md');
  });
  it('the first page has no previous, the last one has no next', () => {
    expect(neighbours(sections, 'user-guide/review-video.md').previous).toBeUndefined();
    expect(neighbours(sections, 'api/errors.md').next).toBeUndefined();
  });
  it('returns an empty pair for an absent page', () => {
    expect(neighbours(sections, 'inconnue.md')).toEqual({});
  });
});

describe('sectionLabel', () => {
  it('translates known sections', () => {
    expect(sectionLabel({ dir: 'user-guide', label: 'User Guide' }, t)).toBe(t('docs.sectionUserGuide'));
  });
  it('keeps the manifest label for an unknown folder', () => {
    expect(sectionLabel({ dir: 'tutorials', label: 'Tutorials' }, t)).toBe('Tutorials');
  });
});
