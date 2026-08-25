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

/** Encarts de la documentation, à la syntaxe des alertes GitHub (`> [!NOTE]`). */
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];
/** Libellé affiché en tête d'encart, dans la langue du lecteur (jamais dans le markdown). */
export type CalloutLabels = Record<CalloutKind, string>;

/** Titre de niveau 2 ou 3 d'une page — le sommaire « chapitres » du panneau latéral. */
export interface DocChapter {
  id: string;
  text: string;
  level: 2 | 3;
}

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
 * Ancre stable d'un titre — l'algorithme de GitHub, au caractère près : minuscules,
 * ponctuation retirée, **chaque** espace devenu un tiret (« Transport & timeline » donne
 * donc `transport--timeline`, avec deux tirets). Les mêmes pages se lisent sur GitHub et
 * dans l'application : un `page.md#chapitre` doit y désigner le même titre des deux côtés.
 */
export function slugifyHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  return slug || 'section';
}

/** Un titre répété dans la page reçoit un suffixe numérique, comme sur GitHub. */
const uniqueSlug = (text: string, seen: Map<string, number>): string => {
  const base = slugifyHeading(text);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
};

const CALLOUT_RE = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i;
const UPDATED_RE = /^\s*Updated\s*:/i;

/**
 * Retire le préambule conventionnel — titre, sous-titre en italique, ligne « Updated: » —
 * quand la page en porte un. Ces trois informations sont déjà rendues par l'en-tête de la
 * page, avec la date au format du lecteur : les laisser dans le corps les afficherait deux
 * fois. Une page qui ne suit pas la convention n'est pas touchée.
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

/** Liens : `.md` interne → navigation SPA, externe → nouvel onglet, exécutable → neutralisé. */
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
      // `[clic](javascript:…)` en markdown produit un href exécutable : le HTML brut est
      // échappé plus haut, mais pas les URLs que marked construit lui-même.
      a.removeAttribute('href');
    }
  }
}

/**
 * Images : chemin relatif → `/docs/…`, et une image seule dans son paragraphe devient une
 * figure légendée par son texte alternatif. La légende porte alors la description ; l'image
 * passe en `alt=""` pour qu'un lecteur d'écran ne l'annonce pas deux fois.
 *
 * Pas de `loading="lazy"` : le contenu est monté dans le conteneur défilant de la page, et
 * le navigateur n'y déclenchait jamais le chargement — les captures restaient des carrés de
 * deux pixels, même après avoir fait défiler jusqu'à elles.
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

/** `> [!NOTE] …` → encart typé, libellé dans la langue du lecteur. */
function rewriteCallouts(root: DocumentFragment, labels: CalloutLabels): void {
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const head = quote.querySelector('p');
    const kind = head?.textContent?.match(CALLOUT_RE)?.[1]?.toLowerCase() as CalloutKind | undefined;
    if (!head || !kind) continue;

    // Le contenu est déjà échappé : réécrire `innerHTML` pour retirer le marqueur en tête
    // ne réintroduit rien d'exécutable.
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

/** Titres ancrables, tableaux défilables, blocs de code étiquetés par leur langage. */
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
 * Markdown → HTML pour la page /docs.
 * - préambule conventionnel retiré (l'en-tête de page le rend lui-même) ;
 * - liens internes .md → <a data-doc="chemin/résolu.md"> (interceptés par la page) ;
 * - liens externes → nouvel onglet (noopener) ;
 * - images relatives → servies depuis /docs/<chemin résolu>, seules dans leur paragraphe
 *   elles deviennent une figure légendée ;
 * - `> [!NOTE]` → encart typé ; titres ancrés ; tableaux défilables.
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
 * Sommaire de la page, lu sur le HTML déjà rendu — les ancres y sont posées, donc un
 * chapitre ne peut pas pointer à côté de son titre.
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
