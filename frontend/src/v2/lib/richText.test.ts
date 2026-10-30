// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { excerpt, stripHtml } from './richText';

describe('stripHtml', () => {
  /**
   * The case seen on screen: a note imported from ShotGrid, displayed as-is by the home page,
   * which showed its markup to the reader.
   */
  it('makes a note imported from ShotGrid readable', () => {
    const note =
      '<p><em>ShotGrid</em></p><p><strong>Timing</strong></p><p>The hero lands two frames late.</p>';
    expect(stripHtml(note)).toBe('ShotGrid Timing The hero lands two frames late.');
  });

  // A tag that disappears without leaving a space glues the words of two blocks together.
  it('separates blocks instead of gluing them', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a b');
    expect(stripHtml('un<br>deux')).toBe('un deux');
  });

  it('does not double the space when the tag already separated them', () => {
    expect(stripHtml('<p>un</p> <p>deux</p>')).toBe('un deux');
  });

  it('leaves a text without tags intact', () => {
    expect(stripHtml('simple')).toBe('simple');
    expect(stripHtml('')).toBe('');
  });

  it('removes the attributes along with the tag', () => {
    expect(stripHtml('<a href="http://x" title="y">lien</a>')).toBe('lien');
  });
});

describe('excerpt', () => {
  it('lets through what fits', () => {
    expect(excerpt('<p>court</p>', 40)).toBe('court');
  });

  it('cuts at a word, not in the middle', () => {
    const long = '<p>The hero lands two frames late and nobody noticed until the review</p>';
    const rendu = excerpt(long, 30);
    expect(rendu.endsWith('…')).toBe(true);
    expect(rendu.length).toBeLessThanOrEqual(31);
    // Step back to the space: the last word is whole, not truncated.
    expect(rendu.slice(0, -1).trim().split(' ').pop()).toMatch(/^\w+$/);
  });

  /**
   * A single word longer than the limit has no space to step back to: better to cut it than to
   * return an empty string.
   */
  it('still cuts an endless word', () => {
    expect(excerpt('<p>' + 'a'.repeat(50) + '</p>', 10)).toBe('aaaaaaaaaa…');
  });
});
