// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  activeMentionQuery,
  filterCandidates,
  highlightMentions,
  insertMention,
  mentionHandle,
} from './mentions';

describe('mentions (32.B)', () => {
  it('mentionHandle : pseudo prioritaire, sinon partie locale de l’email', () => {
    expect(mentionHandle({ username: 'yvig', email: 'y@x.fr' })).toBe('yvig');
    expect(mentionHandle({ username: null, email: 'jean.dupont@studio.fr' })).toBe('jean.dupont');
  });

  describe('activeMentionQuery', () => {
    it('détecte @ en début de texte et après un espace', () => {
      expect(activeMentionQuery('@yv', 3)).toEqual({ start: 0, query: 'yv' });
      expect(activeMentionQuery('ok @jean', 8)).toEqual({ start: 3, query: 'jean' });
    });
    it('ignore un @ collé à un mot (email) ou une mention terminée', () => {
      expect(activeMentionQuery('y@x.fr', 6)).toBeNull();
      expect(activeMentionQuery('@jean fait', 10)).toBeNull();
    });
    it('caret au milieu : seule la partie avant compte', () => {
      expect(activeMentionQuery('@jea reste', 4)).toEqual({ start: 0, query: 'jea' });
    });
  });

  it('filterCandidates : préfixe du handle ou fragment du libellé, 6 max', () => {
    const cs = [
      { id: 1, handle: 'yvig', label: 'Yvig B' },
      { id: 2, handle: 'jean.dupont', label: 'Jean Dupont' },
      { id: 3, handle: 'marie', label: 'Marie Curie' },
    ];
    expect(filterCandidates(cs, 'j').map((c) => c.id)).toEqual([2]);
    expect(filterCandidates(cs, 'dupont').map((c) => c.id)).toEqual([2]);
    expect(filterCandidates(cs, '').length).toBe(3);
  });

  it('insertMention remplace la saisie partielle et place le caret après', () => {
    const out = insertMention('ok @jea reste', 7, 3, 'jean.dupont');
    expect(out.text).toBe('ok @jean.dupont  reste');
    expect(out.caret).toBe(3 + '@jean.dupont '.length);
  });

  describe('highlightMentions', () => {
    it('enveloppe les jetons hors balises', () => {
      expect(highlightMentions('salut @yvig !')).toBe(
        'salut <span class="text-primary font-medium">@yvig</span> !',
      );
    });
    it('ne touche pas aux attributs de balises ni aux emails', () => {
      expect(highlightMentions('<a href="mailto:a@b.fr">a@b.fr</a>')).toBe(
        '<a href="mailto:a@b.fr">a@b.fr</a>',
      );
    });
  });
});
