// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Marked } from 'marked';
import { isInternalDocHref, resolveDocHref } from './docsManifest';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * URL stripped of spaces and control characters: browsers ignore those in an `href` too, so a
 * `java\tscript:` URL would otherwise remain fully executable.
 */
// eslint-disable-next-line no-control-regex -- stripping control characters (NUL included) is the whole purpose of this regex
const protocolOf = (url: string) => url.replace(/[\u0000-\u0020]/g, '').toLowerCase();

/** Executable protocol in a link? (`data:` is used to serve HTML) */
export const isUnsafeHref = (url: string): boolean => /^(javascript|vbscript|data):/.test(protocolOf(url));

/** Executable protocol in an image? `data:image/…` remains legitimate in markdown. */
export const isUnsafeSrc = (url: string): boolean => /^(javascript|vbscript):/.test(protocolOf(url));

/** Documentation callouts, using GitHub alert syntax (`> [!NOTE]`). */
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
/** Label shown at the head of a callout, in the reader language (never in the markdown). */
export type CalloutLabels = Record<CalloutKind, string>;

/** Level 2 or 3 heading of a page: the "chapters" table of contents in the side panel. */
export interface DocChapter {
  id: string;
  text: string;
  level: 2 | 3;
}

// DOCUMENTATION/ convention: pure markdown. Raw HTML (block or inline) is escaped: no injection
// is possible, and the behaviour is identical under test (happy-dom).
const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
  },
});

/**
 * Stable anchor of a heading: GitHub's algorithm, to the character. Lowercased, punctuation
 * removed, **each** space turned into a dash ("Transport & timeline" thus gives
 * `transport--timeline`, with two dashes). The same pages are read on GitHub and in the
 * application, so a `page.md#chapter` must designate the same heading on both sides.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'section';
}

/** A heading repeated in the page receives a numeric suffix, as on GitHub. */
const uniqueSlug = (text: string, seen: Map<string, number>): string => {
  const base = slugifyHeading(text);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
};

const CALLOUT_RE = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i;
const UPDATED_RE = /^\s*Updated\s*:/i;

/**
 * Removes the conventional preamble (title, italic subtitle, "Updated:" line) when the page has
 * one. These three pieces are already rendered by the page header, with the date in the reader's
 * format: leaving them in the body would display them twice. A page that does not follow the
 * convention is left untouched.
 */
function stripPreamble(root: DocumentFragment): void {
  const first = root.firstElementChild;
  if (first?.tagName !== 'H1') return;
  first.remove();

  const lead = root.firstElementChild;
  if (lead?.tagName === 'P' && lead.children.length === 1 && lead.children[0]?.tagName === 'EM')
    lead.remove();

  const updated = root.firstElementChild;
  if (updated?.tagName === 'BLOCKQUOTE' && UPDATED_RE.test(updated.textContent ?? '')) updated.remove();
}

/** Links: internal `.md` becomes SPA navigation, external opens a new tab, executable is neutralized. */
function rewriteLinks(root: DocumentFragment, currentPath: string): void {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (isInternalDocHref(href) && /\.md(#|$)/.test(href)) {
      a.setAttribute('data-doc', resolveDocHref(currentPath, href));
      a.removeAttribute('href');
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.setAttribute('data-external', '');
    } else if (isUnsafeHref(href)) {
      // A `[click](javascript:…)` in markdown produces an executable href: raw HTML is escaped
      // above, but not the URLs that marked builds itself.
      a.removeAttribute('href');
    }
  }
}

/**
 * Images: relative path → `/docs/…`, and a lone image in its paragraph becomes a figure captioned
 * by its alt text. The caption then carries the description, and the image gets `alt=""` so a
 * screen reader does not announce it twice.
 *
 * No `loading="lazy"`: the content is mounted in the page's scrolling container, and the browser
 * never triggered loading there. The captures stayed two-pixel squares, even after scrolling
 * down to them.
 */
function rewriteImages(root: DocumentFragment, currentPath: string): void {
  for (const img of root.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (isInternalDocHref(src)) img.setAttribute('src', `/docs/${resolveDocHref(currentPath, src)}`);
    else if (isUnsafeSrc(src)) img.removeAttribute('src');
  }

  for (const p of [...root.querySelectorAll('p')]) {
    const only = p.children[0];
    if (p.children.length !== 1 || !only || only.tagName !== 'IMG') continue;
    if ((p.textContent ?? '').trim() !== '') continue;

    const figure = document.createElement('figure');
    const caption = only.getAttribute('alt')?.trim() ?? '';
    figure.appendChild(only);
    if (caption) {
      only.setAttribute('alt', '');
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;
      figure.appendChild(figcaption);
    }
    p.parentNode?.replaceChild(figure, p);
  }
}

/** `> [!NOTE] …` becomes a typed callout, labelled in the reader language. */
function rewriteCallouts(root: DocumentFragment, labels: CalloutLabels): void {
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const head = quote.querySelector('p');
    const kind = head?.textContent?.match(CALLOUT_RE)?.[1]?.toLowerCase() as CalloutKind | undefined;
    if (!head || !kind) continue;

    // The content is already escaped: rewriting `innerHTML` to strip the marker at the head does
    // not reintroduce anything executable.
    head.innerHTML = head.innerHTML.replace(CALLOUT_RE, '');
    if ((head.textContent ?? '').trim() === '' && head.children.length === 0) head.remove();

    const box = document.createElement('div');
    box.className = 'doc-callout';
    box.setAttribute('data-callout', kind);
    const label = document.createElement('p');
    label.className = 'doc-callout-label';
    label.textContent = labels[kind];
    box.appendChild(label);
    while (quote.firstChild) box.appendChild(quote.firstChild);
    quote.parentNode?.replaceChild(box, quote);
  }
}

/** Anchorable headings, scrollable tables, code blocks labelled by their language. */
function decorateStructure(root: DocumentFragment): void {
  const seen = new Map<string, number>();
  for (const h of root.querySelectorAll('h1, h2, h3, h4'))
    h.setAttribute('id', uniqueSlug(h.textContent ?? '', seen));

  for (const table of [...root.querySelectorAll('table')]) {
    const wrap = document.createElement('div');
    wrap.className = 'doc-table';
    table.parentNode?.replaceChild(wrap, table);
    wrap.appendChild(table);
  }

  for (const pre of root.querySelectorAll('pre')) {
    const lang = pre
      .querySelector('code')
      ?.getAttribute('class')
      ?.match(/language-([\w+-]+)/)?.[1];
    if (lang) pre.setAttribute('data-lang', lang);
  }
}

/**
 * Markdown → HTML for the /docs page.
 * - conventional preamble removed (the page header renders it itself);
 * - internal .md links → <a data-doc="resolved/path.md"> (intercepted by the page);
 * - external links → new tab (noopener);
 * - relative images → served from /docs/<resolved path>; alone in their paragraph they become
 *   a captioned figure;
 * - `> [!NOTE]` → typed callout; anchored headings; scrollable tables.
 */
export function renderDocHtml(markdown: string, currentPath: string, calloutLabels: CalloutLabels): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = md.parse(markdown, { async: false });

  stripPreamble(tpl.content);
  rewriteLinks(tpl.content, currentPath);
  rewriteImages(tpl.content, currentPath);
  rewriteCallouts(tpl.content, calloutLabels);
  decorateStructure(tpl.content);

  return tpl.innerHTML;
}

/**
 * Table of contents of the page, read from the already rendered HTML. The anchors are placed
 * there, so a chapter cannot point beside its heading.
 */
export function extractChapters(html: string): DocChapter[] {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return [...tpl.content.querySelectorAll('h2[id], h3[id]')].map((h) => ({
    id: h.getAttribute('id') ?? '',
    text: h.textContent?.trim() ?? '',
    level: h.tagName === 'H2' ? 2 : 3,
  }));
}
