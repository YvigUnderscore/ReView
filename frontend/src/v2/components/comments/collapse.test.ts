// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  COLLAPSE_CHARS,
  COLLAPSE_LINES,
  VISIBLE_REPLIES,
  isLongText,
  lineCount,
  plainLength,
  splitReplies,
} from './collapse';

describe('mesure du contenu — le balisage ne compte pas', () => {
  it('mesure le texte brut, pas les balises', () => {
    expect(plainLength('<span class="text-primary">@yvig</span> ok')).toBe('@yvig ok'.length);
  });

  it('compte les lignes du texte brut', () => {
    expect(lineCount('a\nb\nc')).toBe(3);
  });
});

describe('isLongText — les deux seuils de repliage', () => {
  it('laisse déplié un commentaire court', () => {
    expect(isLongText('trop sombre sur la frame 1012')).toBe(false);
  });

  it('replie au-delà du plafond de caractères', () => {
    expect(isLongText('x'.repeat(COLLAPSE_CHARS))).toBe(false);
    expect(isLongText('x'.repeat(COLLAPSE_CHARS + 1))).toBe(true);
  });

  it('replie un texte court mais haut', () => {
    expect(isLongText('x\n'.repeat(COLLAPSE_LINES - 2))).toBe(false);
    expect(isLongText('x\n'.repeat(COLLAPSE_LINES + 2))).toBe(true);
  });
});

describe('splitReplies — fil long', () => {
  const replies = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('rend tout un fil court', () => {
    expect(splitReplies(replies(VISIBLE_REPLIES))).toEqual({
      hidden: [],
      shown: replies(VISIBLE_REPLIES),
    });
  });

  it('ne rend que les dernières réponses au-delà du seuil', () => {
    const { hidden, shown } = splitReplies(replies(VISIBLE_REPLIES + 5));
    expect(hidden).toEqual([0, 1, 2, 3, 4]);
    expect(shown).toHaveLength(VISIBLE_REPLIES);
    expect(shown[shown.length - 1]).toBe(VISIBLE_REPLIES + 4);
  });

  it('ne mute pas la liste reçue', () => {
    const source = replies(3);
    splitReplies(source).shown.push(99);
    expect(source).toHaveLength(3);
  });
});
