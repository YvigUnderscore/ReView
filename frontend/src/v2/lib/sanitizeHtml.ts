// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import DOMPurify from 'dompurify';

/**
 * The one gate before `dangerouslySetInnerHTML`.
 *
 * The renderers upstream (docs, notes, comments, changelog) already escape raw HTML and drop
 * executable URLs, but each with its own rules, and a single forgotten branch was enough to inject a
 * script: markdown from a remote release, a comment from another user. DOMPurify gives every one of
 * them the same last line of defence, whatever the renderer did.
 *
 * What the renderers legitimately produce is kept: `class`, `data-*` (doc links, callouts, image
 * alignment), inline `style` (image width), and `target`/`rel` on external links. Everything
 * executable goes: `<script>`, `on*` handlers, `javascript:` URLs, `<iframe>`, `<form>`.
 *
 * ESLint enforces it: `__html` must be a `sanitizeHtml(…)` call.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'] });
}
