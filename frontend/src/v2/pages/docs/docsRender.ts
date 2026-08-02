// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Marked } from 'marked';
import { isInternalDocHref, resolveDocHref } from './docsManifest';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Convention DOCUMENTATION/ : markdown pur. Le HTML brut (bloc ou inline) est
// échappé — pas d'injection possible, comportement identique en test (happy-dom).
const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }: { text: string }) {
      return escapeHtml(text);
    },
  },
});

/**
 * Markdown → HTML pour la page /docs.
 * - liens internes .md → <a data-doc="chemin/résolu.md"> (interceptés par la page) ;
 * - liens externes → nouvel onglet (noopener) ;
 * - images relatives → servies depuis /docs/<chemin résolu>.
 */
export function renderDocHtml(markdown: string, currentPath: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = md.parse(markdown, { async: false });

  for (const a of tpl.content.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (isInternalDocHref(href) && /\.md(#|$)/.test(href)) {
      a.setAttribute('data-doc', resolveDocHref(currentPath, href));
      a.removeAttribute('href');
    } else if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (isInternalDocHref(src)) img.setAttribute('src', `/docs/${resolveDocHref(currentPath, src)}`);
    img.setAttribute('loading', 'lazy');
  }
  return tpl.innerHTML;
}
