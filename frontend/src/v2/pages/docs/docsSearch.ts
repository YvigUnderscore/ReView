// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fold } from '../../components/settings/settingsFilter';
import type { DocsPage, DocsSection } from './docsManifest';

/**
 * The documentation search engine: **one**, for the two surfaces that search it.
 *
 * They did not search the same thing. The Ctrl+K palette exploited the chapter titles of the
 * manifest (its table of contents); the table-of-contents filter of `/docs`, however, only looked
 * at the title, subtitle and path of the page. Typing "watermark" in the documentation page
 * therefore returned nothing, while the palette opened the right page on the right chapter: two
 * contradictory answers to the same question, in the same product. Both now go through the
 * functions below.
 *
 * Three shared rules:
 *   - **case and accents ignored** on both sides (`fold`), as for settings;
 *   - **all words required**: "watermark client" does not return half the manual;
 *   - the **chapter found is rendered with the result**: it is the reason for the match, and
 *     what allows opening the page at the right place.
 */

/**
 * Quality of a match, from the sharpest to the vaguest. Same reasoning as `lib/searchRank` on the
 * server: the title identifies, the chapter locates, and the file path merely attests.
 */
export const DOC_SCORE = { title: 40, summary: 30, heading: 20, path: 10, words: 1 } as const;

/** The words of a search, folded. An empty list means no search: everything passes. */
export function docWords(query: string): string[] {
  const needle = fold(query.trim());
  return needle ? needle.split(/\s+/) : [];
}

/** Everything through which a page can be found: title, subtitle, path, chapters. */
export function docHaystack(page: DocsPage): string {
  return fold([page.title, page.summary, page.path, ...(page.headings ?? [])].join(' '));
}

/** Does the page answer? All words must be present, wherever they are in the page. */
export function docMatches(page: DocsPage, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = docHaystack(page);
  return words.every((word) => hay.includes(word));
}

/**
 * Chapters of the page that carry the search: what is shown under the result to say *why* the
 * page matches, and what it is opened on.
 *
 * A single word is enough here, whereas `docMatches` requires them all: the page has already
 * answered, and we are now looking for where to enter it.
 */
export function matchingHeadings(page: DocsPage, words: string[], limit = 3): string[] {
  if (words.length === 0) return [];
  return (page.headings ?? [])
    .filter((heading) => {
      const folded = fold(heading);
      return words.some((word) => folded.includes(word));
    })
    .slice(0, limit);
}

/** A page found, with its section, its rank and the chapter that answered. */
export interface DocsHit {
  section: DocsSection;
  page: DocsPage;
  score: number;
  heading: string | null;
}

/** How closely this page matches what was typed. The chapter found serves as the reason. */
function docRank(page: DocsPage, needle: string, words: string[]): { score: number; heading: string | null } {
  // The whole input first ("video review" designates a chapter, not two scattered words);
  // failing that, the first chapter carrying one of the words.
  const heading =
    (page.headings ?? []).find((h) => fold(h).includes(needle)) ??
    matchingHeadings(page, words, 1)[0] ??
    null;
  if (fold(page.title).includes(needle)) return { score: DOC_SCORE.title, heading };
  if (fold(page.summary).includes(needle)) return { score: DOC_SCORE.summary, heading };
  if ((page.headings ?? []).some((h) => fold(h).includes(needle)))
    return { score: DOC_SCORE.heading, heading };
  if (fold(page.path).includes(needle)) return { score: DOC_SCORE.path, heading };
  // Found word by word, since the whole input appears nowhere as one piece.
  return { score: DOC_SCORE.words, heading };
}

/**
 * Pages answering the input, **ranked**: the order of the palette. Stable sort (ES2019): at
 * equal score, the reading order of the table of contents breaks the tie.
 */
export function searchDocs(sections: DocsSection[], query: string): DocsHit[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const words = needle.split(/\s+/);

  return sections
    .flatMap((section) =>
      section.pages
        .filter((page) => docMatches(page, words))
        .map((page) => ({ section, page, ...docRank(page, needle, words) })),
    )
    .sort((a, b) => b.score - a.score);
}

/**
 * Filtered sections, **in table-of-contents order**: the view of the side panel, where nothing
 * is ranked: we strike out what does not answer. Emptied sections disappear.
 */
export function filterSections(sections: DocsSection[], query: string): DocsSection[] {
  const words = docWords(query);
  if (words.length === 0) return sections;
  return sections
    .map((section) => ({ ...section, pages: section.pages.filter((page) => docMatches(page, words)) }))
    .filter((section) => section.pages.length > 0);
}
