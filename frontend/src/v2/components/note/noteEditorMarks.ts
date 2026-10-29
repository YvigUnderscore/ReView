// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formatting a text without writing any syntax.
 *
 * The text block remains markdown, which is what keeps the note portable, but nobody has to type the asterisks: one
 * selects, clicks (or presses Ctrl+B), and the mark is applied. It is **removed on the second gesture**, otherwise the
 * "bold" button on an already bold text would produce `****text****`, which is no longer bold at all.
 *
 * Everything is pure, by design: the cursor position afterwards is part of the result, and that is precisely what can
 * only be verified by testing outside the DOM.
 */

export type MarkKind = 'bold' | 'italic' | 'code' | 'link' | 'bullet' | 'number' | 'quote';

export interface MarkResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Marks that wrap the selection, and what they write on either side. */
const WRAPS: Partial<Record<MarkKind, { before: string; after: string }>> = {
  bold: { before: '**', after: '**' },
  italic: { before: '*', after: '*' },
  code: { before: '`', after: '`' },
};

/** Marks that prefix each line. */
const PREFIXES: Partial<Record<MarkKind, (index: number) => string>> = {
  bullet: () => '- ',
  number: (index) => `${index + 1}. `,
  quote: () => '> ',
};

function applyWrap(value: string, start: number, end: number, before: string, after: string): MarkResult {
  const selected = value.slice(start, end);

  // Already marked? Remove it, whether from inside or outside the selection.
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

/** Line boundaries covering the selection: prefixing is done by whole lines. */
function lineRange(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf('\n', Math.max(start - 1, 0)) + 1;
  const nextBreak = value.indexOf('\n', end);
  return [from, nextBreak === -1 ? value.length : nextBreak];
}

/** A line already prefixed by a bullet, a number or a chevron. */
const MARKED_LINE = /^\s*([-*]|\d+\.|>)\s/;

function applyPrefix(value: string, start: number, end: number, prefix: (i: number) => string): MarkResult {
  const [from, to] = lineRange(value, start, end);
  const lines = value.slice(from, to).split('\n');
  // An existing list is removed: it is the same button, and the artist expects the removal.
  const marked = lines.every((line) => line.trim() === '' || MARKED_LINE.test(line));
  const next = lines
    .map((line, i) => (marked ? line.replace(MARKED_LINE, '') : `${prefix(i)}${line}`))
    .join('\n');
  const patched = value.slice(0, from) + next + value.slice(to);
  return { value: patched, selectionStart: from, selectionEnd: from + next.length };
}

/**
 * Applies (or removes) a mark on the selection.
 *
 * The link is the only special case: it does not wrap, it moves the cursor to where something still remains to be
 * written: the address, which nobody can guess on our behalf.
 */
export function applyMark(value: string, start: number, end: number, kind: MarkKind): MarkResult {
  const wrap = WRAPS[kind];
  if (wrap) return applyWrap(value, start, end, wrap.before, wrap.after);

  const prefix = PREFIXES[kind];
  if (prefix) return applyPrefix(value, start, end, prefix);

  const label = value.slice(start, end);
  const next = `${value.slice(0, start)}[${label}]()${value.slice(end)}`;
  // Cursor between the parentheses: the address is what remains to be written.
  const caret = start + label.length + 3;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}
