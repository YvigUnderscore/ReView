// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { STUB_LINE_HEIGHT, stubLayoutMetrics } from './layoutMetrics';

/**
 * Cinq fichiers de test s'appuient sur ce bouchon pour vérifier un repliage MESURÉ : s'il
 * mentait, ils vérifieraient son mensonge. On contrôle donc qu'il rend bien ce qu'il annonce —
 * et qu'il laisse le document tel qu'il l'a trouvé.
 */

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

const div = (className: string, text: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
};

describe('stubLayoutMetrics', () => {
  it('compte les lignes à la largeur demandée', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    expect(div('', 'x'.repeat(20)).scrollHeight).toBe(STUB_LINE_HEIGHT);
    expect(div('', 'x'.repeat(21)).scrollHeight).toBe(2 * STUB_LINE_HEIGHT);
    expect(div('', 'a\nb\nc').scrollHeight).toBe(3 * STUB_LINE_HEIGHT);
  });

  it('ne plafonne la hauteur visible que sur un élément replié', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    const wall = 'x'.repeat(200);
    expect(div('', wall).clientHeight).toBe(10 * STUB_LINE_HEIGHT);
    expect(div('line-clamp-3', wall).clientHeight).toBe(3 * STUB_LINE_HEIGHT);
    expect(div('max-h-32 overflow-hidden', wall).clientHeight).toBe(128);
  });

  it('ne plafonne pas en dessous du contenu : un texte court ne déborde jamais', () => {
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    const short = div('line-clamp-3', 'la soudure');
    expect(short.clientHeight).toBe(short.scrollHeight);
  });

  it('la même remarque déborde à 22 caractères par ligne et tient à 40', () => {
    const note = 'x'.repeat(90);
    restore = stubLayoutMetrics({ charsPerLine: 22 });
    const narrow = div('line-clamp-3', note);
    expect(narrow.scrollHeight).toBeGreaterThan(narrow.clientHeight);
    restore();
    restore = stubLayoutMetrics({ charsPerLine: 40 });
    const wide = div('line-clamp-3', note);
    expect(wide.scrollHeight).toBe(wide.clientHeight);
  });

  it('rend le document intact', () => {
    const before = document.createElement('div').scrollHeight;
    restore = stubLayoutMetrics({ charsPerLine: 20 });
    restore();
    restore = null;
    expect(document.createElement('div').scrollHeight).toBe(before);
  });
});
