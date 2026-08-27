// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mettre un texte en forme sans écrire de syntaxe.
 *
 * Le bloc de texte reste du markdown — c'est ce qui garde la fiche portable — mais personne
 * n'a à taper les étoiles : on sélectionne, on clique (ou Ctrl+B), et la marque se pose. Et
 * elle se **retire au second geste**, sinon le bouton « gras » sur un texte déjà gras
 * produirait `****texte****`, ce qui n'est plus gras du tout.
 *
 * Tout est pur, à dessein : la position du curseur après coup fait partie du résultat, et
 * c'est précisément ce qu'on ne peut vérifier qu'en le testant hors du DOM.
 */

export type MarkKind = 'bold' | 'italic' | 'code' | 'link' | 'bullet' | 'number' | 'quote';

export interface MarkResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Les marques qui entourent la sélection, et ce qu'elles écrivent de part et d'autre. */
const WRAPS: Partial<Record<MarkKind, { before: string; after: string }>> = {
  bold: { before: '**', after: '**' },
  italic: { before: '*', after: '*' },
  code: { before: '`', after: '`' },
};

/** Les marques qui préfixent chaque ligne. */
const PREFIXES: Partial<Record<MarkKind, (index: number) => string>> = {
  bullet: () => '- ',
  number: (index) => `${index + 1}. `,
  quote: () => '> ',
};

function applyWrap(value: string, start: number, end: number, before: string, after: string): MarkResult {
  const selected = value.slice(start, end);

  // Déjà marqué ? On retire — depuis l'intérieur comme depuis l'extérieur de la sélection.
  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length >= before.length + after.length
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      selectionStart: start,
      selectionEnd: start + inner.length,
    };
  }
  if (
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    const next = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    return { value: next, selectionStart: start - before.length, selectionEnd: end - before.length };
  }

  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { value: next, selectionStart: start + before.length, selectionEnd: end + before.length };
}

/** Les bornes de ligne qui couvrent la sélection — préfixer se fait par lignes entières. */
function lineRange(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf('\n', Math.max(start - 1, 0)) + 1;
  const nextBreak = value.indexOf('\n', end);
  return [from, nextBreak === -1 ? value.length : nextBreak];
}

/** Une ligne déjà préfixée par une puce, un numéro ou un chevron. */
const MARKED_LINE = /^\s*([-*]|\d+\.|>)\s/;

function applyPrefix(value: string, start: number, end: number, prefix: (i: number) => string): MarkResult {
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split('\n');
  // Une liste déjà posée se retire : c'est le même bouton, et l'artiste s'attend au retrait.
  const marked = lines.every((line) => line.trim() === '' || MARKED_LINE.test(line));
  const next = lines
    .map((line, i) => (marked ? line.replace(MARKED_LINE, '') : `${prefix(i)}${line}`))
    .join('\n');
  const patched = value.slice(0, from) + next + value.slice(to);
  return { value: patched, selectionStart: from, selectionEnd: from + next.length };
}

/**
 * Pose (ou retire) une marque sur la sélection.
 *
 * Le lien est le seul cas particulier : il n'entoure pas, il déplace le curseur là où il
 * reste quelque chose à écrire — l'adresse, que personne ne peut deviner à notre place.
 */
export function applyMark(value: string, start: number, end: number, kind: MarkKind): MarkResult {
  const wrap = WRAPS[kind];
  if (wrap) return applyWrap(value, start, end, wrap.before, wrap.after);

  const prefix = PREFIXES[kind];
  if (prefix) return applyPrefix(value, start, end, prefix);

  const label = value.slice(start, end);
  const next = `${value.slice(0, start)}[${label}]()${value.slice(end)}`;
  // Curseur entre les parenthèses : l'adresse est ce qu'il reste à faire.
  const caret = start + label.length + 3;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}
