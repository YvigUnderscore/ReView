// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { docWords, filterSections, matchingHeadings, searchDocs } from './docsSearch';
import type { DocsSection } from './docsManifest';

/**
 * The engine shared by the `/docs` table of contents and the Ctrl+K palette.
 *
 * The defect it repairs: the table-of-contents filter ignored chapter titles, which the palette
 * exploited. Searching "watermark" in the documentation page therefore returned nothing, while
 * Ctrl+K opened the right page on the right chapter: two contradictory answers to the same
 * question. The tests below cover the shared engine; those of the palette
 * (`components/palette/surfaceSearch.test.ts`) verify its wrapping.
 */

const page = (path: string, title: string, summary = '', headings: string[] = []) => ({
  path,
  title,
  summary,
  updated: '2026-09-20',
  headings,
});

const sections: DocsSection[] = [
  {
    dir: 'user-guide',
    label: 'User Guide',
    pages: [
      page('user-guide/review-video.md', 'Video review', 'Frame-accurate playback and comparison.', [
        'Transport & timeline',
        'Safe areas',
      ]),
      page('user-guide/boards.md', 'Boards'),
      page('user-guide/sharing.md', 'Sharing with clients', 'One link, and what it bounds.', [
        'Video source, watermark, downloads',
      ]),
    ],
  },
  {
    dir: 'admin-guide',
    label: 'Admin Guide',
    pages: [
      page('admin-guide/secure-distribution.md', 'Secure distribution', 'Everything that leaves.', [
        'Four défences',
        'Viewer watermark',
      ]),
    ],
  },
];

describe('docWords', () => {
  it('folds case and accents, and splits on spaces', () => {
    expect(docWords('  DÉFENCES  Watermark ')).toEqual(['defences', 'watermark']);
  });
  it('returns an empty list for an empty input: everything then passes', () => {
    expect(docWords('   ')).toEqual([]);
  });
});

describe('filterSections', () => {
  it('without a query, returns everything', () => {
    expect(filterSections(sections, '  ')).toEqual(sections);
  });

  it('filters by title (case-insensitive) and removes empty sections', () => {
    const out = filterSections(sections, 'VIDEO review');
    expect(out).toHaveLength(1);
    expect(out[0].pages.map((p) => p.path)).toEqual(['user-guide/review-video.md']);
  });

  it('also filters by path', () => {
    const out = filterSections(sections, 'boards.md');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual(['user-guide/boards.md']);
  });

  it('searches down into the subtitle: that is where the words of readers live', () => {
    const out = filterSections(sections, 'comparison');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual(['user-guide/review-video.md']);
  });

  /** The starting defect: this word lives only in chapter titles. */
  it('finds a page by a CHAPTER TITLE, as the palette does', () => {
    const out = filterSections(sections, 'watermark');
    expect(out.flatMap((s) => s.pages.map((p) => p.path))).toEqual([
      'user-guide/sharing.md',
      'admin-guide/secure-distribution.md',
    ]);
  });

  it('requires all the words', () => {
    expect(filterSections(sections, 'watermark boards')).toEqual([]);
  });

  it('ignores accents on both sides', () => {
    for (const typed of ['defences', 'DÉFENCES'])
      expect(
        filterSections(sections, typed).flatMap((s) => s.pages.map((p) => p.title)),
        typed,
      ).toEqual(['Secure distribution']);
  });

  it('keeps the table-of-contents reading order: it is filtered, not ranked', () => {
    const out = filterSections(sections, 'video');
    expect(out.map((s) => s.dir)).toEqual(['user-guide']);
    expect(out[0].pages.map((p) => p.path)).toEqual(['user-guide/review-video.md', 'user-guide/sharing.md']);
  });

  it('remains filterable on a manifest without chapters (earlier build)', () => {
    const old: DocsSection[] = [
      {
        dir: 'api',
        label: 'Api',
        pages: [{ ...page('api/overview.md', 'API overview'), headings: undefined }],
      },
    ];
    expect(filterSections(old, 'overview')).toHaveLength(1);
    expect(filterSections(old, 'watermark')).toEqual([]);
  });
});

describe('matchingHeadings', () => {
  const target = sections[1].pages[0];

  it('returns the chapters that carry the search: the reason for the result', () => {
    expect(matchingHeadings(target, docWords('watermark'))).toEqual(['Viewer watermark']);
  });

  it('one word is enough here: the page has already answered, we are looking for where to enter', () => {
    expect(matchingHeadings(target, docWords('watermark defences'))).toEqual([
      'Four défences',
      'Viewer watermark',
    ]);
  });

  it('caps the list, so the table of contents stays readable', () => {
    expect(matchingHeadings(target, docWords('e'), 1)).toHaveLength(1);
  });

  it('returns nothing without a search, or on a page without chapters', () => {
    expect(matchingHeadings(target, [])).toEqual([]);
    expect(matchingHeadings(sections[0].pages[1], docWords('boards'))).toEqual([]);
  });
});

describe('searchDocs', () => {
  it('places the title before the chapter: what carries the word goes ahead of what mentions it', () => {
    const hits = searchDocs(sections, 'video');
    expect(hits.map((h) => h.page.title)).toEqual(['Video review', 'Sharing with clients']);
  });

  it('names the chapter found', () => {
    const [hit] = searchDocs(sections, 'watermark');
    expect(hit.page.title).toBe('Sharing with clients');
    expect(hit.heading).toBe('Video source, watermark, downloads');
  });

  it('returns nothing for an empty input: a ranking is not a table of contents', () => {
    expect(searchDocs(sections, '  ')).toEqual([]);
  });
});
