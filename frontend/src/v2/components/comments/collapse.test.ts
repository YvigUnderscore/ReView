// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { CLIP_SLACK, VISIBLE_REPLIES, isClipped, plainLength, splitReplies } from './collapse';

describe('content measurement — markup is not counted', () => {
  it('counts the plain text, not the tags', () => {
    expect(plainLength('<span class="text-primary">@yvig</span> ok')).toBe('@yvig ok'.length);
  });
});

/**
 * The collapse indicator was decided by character count: the same note got the same answer
 * in a 15rem card and in the much wider thread, and the click revealed nothing. We now measure
 * the overflow of the collapsed element instead.
 */
describe('isClipped — does the collapse hide anything?', () => {
  it('sees nothing hidden when all the content fits', () => {
    expect(isClipped({ scrollHeight: 48, clientHeight: 48 })).toBe(false);
  });

  it('sees what the collapse hides', () => {
    expect(isClipped({ scrollHeight: 80, clientHeight: 48 })).toBe(true);
  });

  it('ignores a gap that hides no text', () => {
    expect(isClipped({ scrollHeight: 48 + CLIP_SLACK, clientHeight: 48 })).toBe(false);
    expect(isClipped({ scrollHeight: 48 + CLIP_SLACK + 1, clientHeight: 48 })).toBe(true);
  });

  it('concludes nothing without an element to measure', () => {
    expect(isClipped(null)).toBe(false);
  });
});

describe('splitReplies — long thread', () => {
  const replies = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('renders a whole short thread', () => {
    expect(splitReplies(replies(VISIBLE_REPLIES))).toEqual({
      hidden: [],
      shown: replies(VISIBLE_REPLIES),
    });
  });

  it('renders only the latest replies beyond the threshold', () => {
    const { hidden, shown } = splitReplies(replies(VISIBLE_REPLIES + 5));
    expect(hidden).toEqual([0, 1, 2, 3, 4]);
    expect(shown).toHaveLength(VISIBLE_REPLIES);
    expect(shown[shown.length - 1]).toBe(VISIBLE_REPLIES + 4);
  });

  it('does not mutate the received list', () => {
    const source = replies(3);
    splitReplies(source).shown.push(99);
    expect(source).toHaveLength(3);
  });
});
