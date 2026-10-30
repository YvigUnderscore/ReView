// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { docWords } from './docsSearch';

/**
 * Highlights the searched term in the open page.
 *
 * The table of contents says *which* page answers, but not *where*. On a page of forty
 * paragraphs, "watermark" then had to be searched by eye, or with the browser's Ctrl+F, which
 * does not see collapsed chapters and ignores accents.
 *
 * **The highlight is applied to the DOM, never to the HTML string.** A `replace()` on the source
 * text would repaint a class name, an `href` or an anchor identifier: the word "note" would
 * highlight `class="doc-callout"`, and an unclosed `<mark>` in the middle of a tag would break
 * the rest of the page. Here only the **text nodes** are touched: attributes, anchors (`id`) and
 * structure are out of reach, and the highlight content is set through `textContent`, so user
 * input cannot inject anything, even when typing `<img onerror=…>`.
 */

/** Text node or element, without depending on the presence of the global `Node` in tests. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Below two characters, nothing is highlighted: a single letter would repaint the whole page,
 * which amounts to signalling nothing at all. The table-of-contents *filter*, however, accepts
 * a lone letter: filtering seventy pages does not cost the same as painting a page.
 */
export const MIN_HIGHLIGHT_WORD = 2;

/**
 * Character-by-character folding: lowercase and accents removed, **length unchanged**.
 *
 * This is the condition for highlighting: a position found in the folded text must designate
 * exactly the same characters in the original text. `normalize('NFD')` decomposes and lengthens,
 * hence shifts everything, so each character is folded in isolation, and the original is kept
 * whenever its fold does not have the same length.
 */
export function foldKeepingLength(text: string): string {
  let out = '';
  for (const ch of text) {
    const folded = ch
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '');
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

interface Span {
  start: number;
  end: number;
}

/** Occurrences of the searched words, merged when they overlap, from left to right. */
export function matchSpans(text: string, words: string[]): Span[] {
  const folded = foldKeepingLength(text);
  const found: Span[] = [];
  for (const word of words) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length))
      found.push({ start: at, end: at + word.length });
  }

  found.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** All text nodes of the subtree, collected before any modification. */
function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const visit = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === TEXT_NODE) out.push(child as Text);
      else if (child.nodeType === ELEMENT_NODE) visit(child);
    }
  };
  visit(root);
  return out;
}

/** Replaces a text node with its fragments, the occurrences wrapped in `<mark>`. */
function markNode(node: Text, spans: Span[], firstHit: boolean): void {
  const text = node.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const [index, span] of spans.entries()) {
    if (span.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, span.start)));
    const mark = document.createElement('mark');
    mark.className = 'doc-hit';
    if (firstHit && index === 0) mark.setAttribute('data-doc-hit', 'first');
    // `textContent`: the searched term becomes text again, never markup.
    mark.textContent = text.slice(span.start, span.end);
    fragment.appendChild(mark);
    cursor = span.end;
  }
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

export interface DocHighlight {
  html: string;
  /** Number of highlighted occurrences: what the reader sees announced at the top of the page. */
  count: number;
}

/**
 * Applies the highlight to the HTML already rendered by `renderDocHtml`. An empty search (or one
 * reduced to single-letter words) renders the page unchanged: the highlight is removed by
 * clearing the field, so there is nothing to undo.
 */
export function highlightDocHtml(html: string, query: string): DocHighlight {
  const words = docWords(query).filter((word) => word.length >= MIN_HIGHLIGHT_WORD);
  if (words.length === 0 || !html) return { html, count: 0 };

  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  let count = 0;
  for (const node of textNodes(tpl.content)) {
    const spans = matchSpans(node.data, words);
    if (spans.length === 0) continue;
    markNode(node, spans, count === 0);
    count += spans.length;
  }

  return count === 0 ? { html, count: 0 } : { html: tpl.innerHTML, count };
}
