// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Version texte d'un email, dérivée de son HTML.
 *
 * Nos messages ne partaient qu'en HTML. C'est une faute à trois titres : les filtres
 * anti-spam pénalisent un message sans alternative texte, les aperçus (liste de la boîte,
 * notification de montre, lecteur d'écran) affichent alors du balisage brut, et un client
 * en mode texte ne montre rien du tout.
 *
 * Plutôt que d'écrire deux fois chaque message — et d'en oublier un —, on dérive le texte
 * du HTML déjà rendu. La conversion est volontairement modeste : elle ne vise pas à
 * reproduire la mise en page, mais à rendre le message lisible et ses liens accessibles.
 */

/** Entités HTML que nos gabarits produisent réellement. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => {
      const known = ENTITIES[m.toLowerCase()];
      if (known !== undefined) return known;
      const numeric = /^&#(\d+);$/.exec(m);
      return numeric ? String.fromCodePoint(Number(numeric[1])) : m;
    })
    .replace(/\u00A0/g, ' ');
}

/**
 * Marqueur interne de séparation de cellule. Un caractère de la zone d'usage privé
 * plutôt qu'un NUL : le second est un caractère de contrôle, interdit en expression
 * régulière par le lint, et le premier n'apparaît jamais dans un email.
 */
const CELL_SEP = '\uE000';

/**
 * Un lien devient « libellé (adresse) » — sauf quand le libellé EST l'adresse, auquel cas
 * la répéter n'apprendrait rien. Un bouton « Accepter l'invitation » sans son adresse
 * serait inutilisable en texte : c'est tout l'intérêt de la conversion.
 */
function inlineLinks(html: string): string {
  return html.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const label = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
    if (!label) return href;
    if (label === href) return label;
    return `${label} (${href})`;
  });
}

/** Le texte brut d'un email, à partir de son HTML. */
export function htmlToText(html: string): string {
  const withLinks = inlineLinks(html);
  const blocks = withLinks
    // Ce qui n'a pas de texte lisible disparaît entièrement, contenu compris.
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
    // Un bloc vide ne produit pas de ligne vide : nos gabarits en posent pour la mise en
    // page (espaceurs, cellules de calage), et le texte s'en trouverait aéré au hasard.
    .replace(/<(p|div|td|th|tr|li|h[1-4])\b[^>]*>\s*<\/\1>/gi, '')
    // Une cellule de tableau vaut un séparateur : sans lui, deux colonnes se collent.
    .replace(/<\/(td|th)>/gi, ` ${CELL_SEP} `)
    // Les blocs deviennent des sauts de ligne, les sauts explicites aussi.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|h4|li|table)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(blocks)
    .replace(/[ \t]*\uE000[ \t]*/g, ' \u00B7 ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Texte d'aperçu affiché dans la liste des messages, avant même l'ouverture.
 *
 * Sans lui, les clients y placent le premier texte trouvé — chez nous le nom du studio,
 * répété d'un message à l'autre. Il est masqué de plusieurs façons parce qu'aucune ne
 * fonctionne partout : hauteur nulle, transparence, et caractères invisibles pour pousser
 * hors du champ le texte qui suivrait.
 */
export function preheader(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const spacer = '&#847;&zwnj;&nbsp;'.repeat(60);
  return `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escaped}${spacer}</div>`;
}
