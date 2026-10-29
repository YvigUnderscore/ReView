// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The body of a comment is **HTML** — that is the product's format, not an accident: the editor
 * produces it, `CommentItem` renders it, and the ShotGrid import converts its notes to it. Wherever a
 * comment is shown full width, this HTML must be rendered.
 *
 * But a one-line preview cannot render it: block tags inside a sentence would break the layout. The
 * text therefore has to be extracted — and forgetting to do so shows at once, since the reader then
 * receives the markup in full. This is what the home page used to display: "<p><em>ShotGrid</em></p><p>The hero lands two frames late.</p>".
 *
 * These previews used to live in the editing module; there are now two of them, hence this shared module.
 */

/**
 * Bare text of an already sanitised content.
 *
 * Tags become a space rather than nothing: `<p>a</p><p>b</p>` must read "a b", not "ab". Spaces are
 * then collapsed, which absorbs the extra space when the tag already separated them.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One-line preview: bare text, cut on a word boundary.
 *
 * Cutting at the exact character gives "The hero lands two fra…", which reads badly; stepping back
 * to the last space costs a few characters and makes the sentence readable.
 */
export function excerpt(html: string, max = 120): string {
  const texte = stripHtml(html);
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}
