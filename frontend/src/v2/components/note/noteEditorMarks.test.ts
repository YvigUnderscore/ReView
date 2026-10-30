// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { applyMark } from './noteEditorMarks';

/** Shortcut: marks the selection with brackets in the sample text. */
const on = (text: string, kind: Parameters<typeof applyMark>[3]) => {
  const start = text.indexOf('[');
  const end = text.indexOf(']') - 1;
  return applyMark(text.replace(/[[\]]/g, ''), start, end, kind);
};

describe('applyMark — wrapping marks', () => {
  it('bolds the selection and keeps the selected text', () => {
    const out = on('un [mot] ici', 'bold');
    expect(out.value).toBe('un **mot** ici');
    expect(out.value.slice(out.selectionStart, out.selectionEnd)).toBe('mot');
  });

  it('removes the mark on the second pass, marks included in the selection', () => {
    expect(applyMark('un **mot** ici', 3, 10, 'bold').value).toBe('un mot ici');
  });

  it('removes the mark when only the text is selected', () => {
    const out = applyMark('un **mot** ici', 5, 8, 'bold');
    expect(out.value).toBe('un mot ici');
    expect(out.value.slice(out.selectionStart, out.selectionEnd)).toBe('mot');
  });

  it('handles italic and code too', () => {
    expect(on('un [mot] ici', 'italic').value).toBe('un *mot* ici');
    expect(on('un [mot] ici', 'code').value).toBe('un `mot` ici');
  });

  it('places an empty mark where there is no selection: one types between the two', () => {
    const out = applyMark('un  ici', 3, 3, 'bold');
    expect(out.value).toBe('un **** ici');
    expect(out.selectionStart).toBe(5);
  });
});

describe('applyMark — line marks', () => {
  it('turns the selected lines into a bulleted list', () => {
    expect(applyMark('un\ndeux', 0, 7, 'bullet').value).toBe('- un\n- deux');
  });

  it('numbers in order', () => {
    expect(applyMark('un\ndeux', 0, 7, 'number').value).toBe('1. un\n2. deux');
  });

  it('removes the list on the second pass', () => {
    expect(applyMark('- un\n- deux', 0, 11, 'bullet').value).toBe('un\ndeux');
  });

  it('takes the whole line even when the cursor is in the middle of a word', () => {
    expect(applyMark('une ligne', 5, 5, 'quote').value).toBe('> une ligne');
  });
});

describe('applyMark — link', () => {
  it('keeps the text as the label and places the cursor where the address goes', () => {
    const out = on('voir [la planche] ici', 'link');
    expect(out.value).toBe('voir [la planche]() ici');
    expect(out.selectionStart).toBe(out.value.indexOf('()') + 1);
  });
});
