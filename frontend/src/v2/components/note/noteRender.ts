// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Marked } from 'marked';
import { isUnsafeHref, isUnsafeSrc } from '../../pages/docs/docsRender';
import { isNoteImageKey, parseImageOptions } from './noteMarkdown';

/**
 * Rendering the markdown of an entity's note.
 *
 * Distinct from `renderDocHtml`: the documentation rewrites the repository's internal links, strips a preamble and
 * translates call-out boxes, none of which makes sense for a shot brief. What is common, however, are the two guards, and
 * they are taken over as they are: **raw HTML is escaped** (the server stores text, it sanitises nothing) and executable
 * protocols are removed from links as well as images.
 *
 * A note is written by a supervisor, not by a stranger, but "written by someone trusted" has never prevented a copy-paste
 * from some arbitrary website.
 *
 * Two things are added here, which markdown cannot express alone: the **layout** of an image (carried by its title, see
 * `noteMarkdown`) and the **resolution of keys**: a note stores `note-images/shot/12/…`, never a presigned URL, which would
 * have expired long before the brief is reread.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
  },
});

/** Turns a storage key into a displayable URL; returns `undefined` if it is unknown. */
export type ImageResolver = (src: string) => string | undefined;

/**
 * Markdown → sanitised HTML.
 *
 * Sanitisation goes through the DOM rather than through expressions on the string: it is the browser that decides what an
 * `href` attribute is, and only it can do so faithfully.
 */
export function renderNoteHtml(markdown: string, resolve?: ImageResolver): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = md.parse(markdown, { async: false });

  for (const a of tpl.content.querySelectorAll('a[href]')) {
    if (isUnsafeHref(a.getAttribute('href') ?? '')) a.removeAttribute('href');
    else {
      // A note links outwards (a board, a production document): the link opens alongside, and `noreferrer` prevents
      // delivering the address of the instance.
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
    }
  }
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (isUnsafeSrc(src)) {
      img.remove();
      continue;
    }
    // The title carries the layout; it must not end up as a tooltip under the cursor.
    const options = parseImageOptions(img.getAttribute('title') ?? undefined);
    img.removeAttribute('title');
    img.setAttribute('data-align', options.align);
    if (options.width !== 100) img.setAttribute('style', `width:${options.width}%`);

    const resolved = resolve?.(src);
    if (resolved) img.setAttribute('src', resolved);
    else if (isNoteImageKey(src)) {
      // The key does not have its URL yet (resolution in progress, or project closed to the reader): leaving the `src`
      // as is would show a broken image icon, which reads as "the board was lost". An empty frame says better what is happening.
      const placeholder = tpl.ownerDocument.createElement('span');
      placeholder.setAttribute('data-note-image-pending', '');
      placeholder.setAttribute('style', img.getAttribute('style') ?? '');
      img.replaceWith(placeholder);
      continue;
    }
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
  }
  return tpl.innerHTML;
}
