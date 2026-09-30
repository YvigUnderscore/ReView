// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { CLIP_SLACK, VISIBLE_REPLIES, isClipped, plainLength, splitReplies } from './collapse';

describe('mesure du contenu — le balisage ne compte pas', () => {
  it('compte le texte brut, pas les balises', () => {
    expect(plainLength('<span class="text-primary">@yvig</span> ok')).toBe('@yvig ok'.length);
  });
});

/**
 * L'indicateur de repliage se décidait au nombre de caractères : la même remarque recevait la
 * même réponse dans une carte de 15 rem et dans le fil, bien plus large, et le clic ne révélait
 * rien. C'est le débordement de l'élément replié qu'on mesure désormais.
 */
describe('isClipped — le repliage cache-t-il quelque chose ?', () => {
  it('ne voit rien de caché quand tout le contenu tient', () => {
    expect(isClipped({ scrollHeight: 48, clientHeight: 48 })).toBe(false);
  });

  it('voit ce que le repliage masque', () => {
    expect(isClipped({ scrollHeight: 80, clientHeight: 48 })).toBe(true);
  });

  it('ignore un écart qui ne cache aucun texte', () => {
    expect(isClipped({ scrollHeight: 48 + CLIP_SLACK, clientHeight: 48 })).toBe(false);
    expect(isClipped({ scrollHeight: 48 + CLIP_SLACK + 1, clientHeight: 48 })).toBe(true);
  });

  it('ne conclut rien sans élément à mesurer', () => {
    expect(isClipped(null)).toBe(false);
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
