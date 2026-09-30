// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { applyMark } from './noteEditorMarks';

/** Raccourci : marque la sélection notée entre crochets dans le texte d'exemple. */
const on = (text: string, kind: Parameters<typeof applyMark>[3]) => {
  const start = text.indexOf('[');
  const end = text.indexOf(']') - 1;
  return applyMark(text.replace(/[[\]]/g, ''), start, end, kind);
};

describe('applyMark — marques qui entourent', () => {
  it('met en gras la sélection et garde le texte sélectionné', () => {
    const out = on('un [mot] ici', 'bold');
    expect(out.value).toBe('un **mot** ici');
    expect(out.value.slice(out.selectionStart, out.selectionEnd)).toBe('mot');
  });

  it('retire la marque au second passage, marques comprises dans la sélection', () => {
    expect(applyMark('un **mot** ici', 3, 10, 'bold').value).toBe('un mot ici');
  });

  it('retire la marque quand seule le texte est sélectionné', () => {
    const out = applyMark('un **mot** ici', 5, 8, 'bold');
    expect(out.value).toBe('un mot ici');
    expect(out.value.slice(out.selectionStart, out.selectionEnd)).toBe('mot');
  });

  it('sait aussi l’italique et le code', () => {
    expect(on('un [mot] ici', 'italic').value).toBe('un *mot* ici');
    expect(on('un [mot] ici', 'code').value).toBe('un `mot` ici');
  });

  it('pose une marque vide là où il n’y a pas de sélection — on tape entre les deux', () => {
    const out = applyMark('un  ici', 3, 3, 'bold');
    expect(out.value).toBe('un **** ici');
    expect(out.selectionStart).toBe(5);
  });
});

describe('applyMark — marques de ligne', () => {
  it('transforme les lignes sélectionnées en liste à puces', () => {
    expect(applyMark('un\ndeux', 0, 7, 'bullet').value).toBe('- un\n- deux');
  });

  it('numérote dans l’ordre', () => {
    expect(applyMark('un\ndeux', 0, 7, 'number').value).toBe('1. un\n2. deux');
  });

  it('retire la liste au second passage', () => {
    expect(applyMark('- un\n- deux', 0, 11, 'bullet').value).toBe('un\ndeux');
  });

  it('prend la ligne entière même si le curseur est au milieu d’un mot', () => {
    expect(applyMark('une ligne', 5, 5, 'quote').value).toBe('> une ligne');
  });
});

describe('applyMark — lien', () => {
  it('garde le texte comme libellé et place le curseur là où va l’adresse', () => {
    const out = on('voir [la planche] ici', 'link');
    expect(out.value).toBe('voir [la planche]() ici');
    expect(out.selectionStart).toBe(out.value.indexOf('()') + 1);
  });
});
