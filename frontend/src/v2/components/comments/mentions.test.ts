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
  it('mentionHandle: username first, otherwise the local part of the email', () => {
    expect(mentionHandle({ username: 'yvig', email: 'y@x.fr' })).toBe('yvig');
    expect(mentionHandle({ username: null, email: 'jean.dupont@studio.fr' })).toBe('jean.dupont');
  });

  describe('activeMentionQuery', () => {
    it('detects @ at the start of the text and after a space', () => {
      expect(activeMentionQuery('@yv', 3)).toEqual({ start: 0, query: 'yv' });
      expect(activeMentionQuery('ok @jean', 8)).toEqual({ start: 3, query: 'jean' });
    });
    it('ignores an @ stuck to a word (email) or to a finished mention', () => {
      expect(activeMentionQuery('y@x.fr', 6)).toBeNull();
      expect(activeMentionQuery('@jean fait', 10)).toBeNull();
    });
    it('caret in the middle: only the part before it counts', () => {
      expect(activeMentionQuery('@jea reste', 4)).toEqual({ start: 0, query: 'jea' });
    });
  });

  it('filterCandidates: handle prefix or label fragment, 6 max', () => {
    const cs = [
      { id: 1, handle: 'yvig', label: 'Yvig B' },
      { id: 2, handle: 'jean.dupont', label: 'Jean Dupont' },
      { id: 3, handle: 'marie', label: 'Marie Curie' },
    ];
    expect(filterCandidates(cs, 'j').map((c) => c.id)).toEqual([2]);
    expect(filterCandidates(cs, 'dupont').map((c) => c.id)).toEqual([2]);
    expect(filterCandidates(cs, '').length).toBe(3);
  });

  it('insertMention replaces the partial input and places the caret after it', () => {
    const out = insertMention('ok @jea reste', 7, 3, 'jean.dupont');
    expect(out.text).toBe('ok @jean.dupont  reste');
    expect(out.caret).toBe(3 + '@jean.dupont '.length);
  });

  describe('highlightMentions', () => {
    it('wraps tokens outside tags', () => {
      expect(highlightMentions('salut @yvig !')).toBe(
        'salut <span class="text-primary font-medium">@yvig</span> !',
      );
    });
    it('does not touch tag attributes or emails', () => {
      expect(highlightMentions('<a href="mailto:a@b.fr">a@b.fr</a>')).toBe(
        '<a href="mailto:a@b.fr">a@b.fr</a>',
      );
    });
  });
});
