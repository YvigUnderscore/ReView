// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { docWords } from './docsSearch';

/**
 * Surlignage du terme cherché dans la page ouverte.
 *
 * Le sommaire dit *quelle* page répond ; il ne disait pas *où*. Sur une page de quarante
 * paragraphes, « watermark » se cherchait ensuite à l'œil, ou au Ctrl+F du navigateur —
 * lequel ne voit pas les chapitres repliés et ignore les accents.
 *
 * **Le surlignage se pose sur le DOM, jamais sur la chaîne HTML.** Un `replace()` sur le
 * texte source repeindrait un nom de classe, un `href`, un identifiant d'ancre : le mot
 * « note » surlignerait `class="doc-callout"`, et un `<mark>` ouvert au milieu d'une balise
 * casserait le reste de la page. Ici on ne touche qu'aux **nœuds de texte** : les attributs,
 * les ancres (`id`) et la structure sont hors d'atteinte, et le contenu du surlignage est
 * posé par `textContent` — la saisie de l'utilisateur ne peut donc rien injecter, même en
 * tapant `<img onerror=…>`.
 */

/** Nœud de texte / élément, sans dépendre de la présence du global `Node` côté test. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * En deçà de deux caractères, on ne surligne pas : une seule lettre repeindrait la page
 * entière, ce qui revient à ne rien signaler du tout. Le *filtre* du sommaire, lui, accepte
 * la lettre seule — filtrer soixante-dix pages n'a pas le même coût que peindre une page.
 */
export const MIN_HIGHLIGHT_WORD = 2;

/**
 * Repli caractère par caractère — minuscules et accents retirés, **longueur inchangée**.
 *
 * C'est la condition du surlignage : une position trouvée dans le texte replié doit désigner
 * exactement les mêmes caractères dans le texte d'origine. `normalize('NFD')` décompose et
 * allonge, donc décale tout ; on replie donc chaque caractère isolément, et on garde
 * l'original chaque fois que son repli n'a pas la même longueur.
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

/** Occurrences des mots cherchés, fusionnées quand elles se chevauchent, de gauche à droite. */
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

/** Tous les nœuds de texte du sous-arbre, relevés avant toute modification. */
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

/** Remplace un nœud de texte par ses fragments, les occurrences enveloppées de `<mark>`. */
function markNode(node: Text, spans: Span[], firstHit: boolean): void {
  const text = node.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const [index, span] of spans.entries()) {
    if (span.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, span.start)));
    const mark = document.createElement('mark');
    mark.className = 'doc-hit';
    if (firstHit && index === 0) mark.setAttribute('data-doc-hit', 'first');
    // `textContent` : le terme cherché redevient du texte, jamais du balisage.
    mark.textContent = text.slice(span.start, span.end);
    fragment.appendChild(mark);
    cursor = span.end;
  }
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
  node.parentNode?.replaceChild(fragment, node);
}

export interface DocHighlight {
  html: string;
  /** Nombre d'occurrences surlignées — ce que le lecteur voit annoncé en tête de page. */
  count: number;
}

/**
 * Pose le surlignage sur le HTML déjà rendu par `renderDocHtml`. Une recherche vide (ou
 * réduite à des mots d'une lettre) rend la page inchangée : le surlignage se retire en
 * effaçant le champ, il n'y a rien à défaire.
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
