// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Marked } from 'marked';
import { isInternalDocHref, resolveDocHref } from './docsManifest';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * URL débarrassée de ses espaces et caractères de contrôle : le navigateur les ignore lui
 * aussi dans un `href`, un `java\tscript:` y reste donc parfaitement exécutable.
 */
// eslint-disable-next-line no-control-regex -- retirer les caractères de contrôle (nul compris) est le but même de cette regex
const protocolOf = (url: string) => url.replace(/[\u0000-\u0020]/g, '').toLowerCase();

/** Protocole exécutable dans un lien ? (`data:` y sert à servir du HTML) */
export const isUnsafeHref = (url: string): boolean => /^(javascript|vbscript|data):/.test(protocolOf(url));

/** Protocole exécutable dans une image ? `data:image/…` reste légitime en markdown. */
export const isUnsafeSrc = (url: string): boolean => /^(javascript|vbscript):/.test(protocolOf(url));

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
    } else if (isUnsafeHref(href)) {
      // `[clic](javascript:…)` en markdown produit un href exécutable : le HTML brut est
      // échappé plus haut, mais pas les URLs que marked construit lui-même.
      a.removeAttribute('href');
    }
  }
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (isInternalDocHref(src)) img.setAttribute('src', `/docs/${resolveDocHref(currentPath, src)}`);
    else if (isUnsafeSrc(src)) img.removeAttribute('src');
    /**
     * Pas de `loading="lazy"`.
     *
     * Le contenu est monté dans le conteneur défilant de la page, et le navigateur n'y
     * déclenchait jamais le chargement : les captures restaient des carrés de deux pixels,
     * même après avoir fait défiler jusqu'à elles. Une page de documentation porte deux ou
     * trois images ; les charger tout de suite ne coûte rien.
     */
  }
  return tpl.innerHTML;
}
