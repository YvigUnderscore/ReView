// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildGuestAnnotation, frameOf, guestCommentContent } from './clientAnnotation';
import { readPoiPoints } from '../review/poi/poiPoints';
import { splitAnnotationParts } from '../review/reviewTypes';
import type { Shape } from '../../components/AnnotationCanvas';

const rect: Shape = { id: 'a', type: 'rect', color: '#ef4444', width: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe('buildGuestAnnotation — what the guest attaches to their feedback', () => {
  it('attaches nothing when there is neither a drawing nor a point', () => {
    expect(buildGuestAnnotation({ shapes: [] })).toBeUndefined();
    expect(buildGuestAnnotation({ shapes: [], hotspot: null })).toBeUndefined();
  });

  it('attaches the shapes as they are', () => {
    expect(buildGuestAnnotation({ shapes: [rect] })).toEqual([rect]);
  });

  // `splitAnnotationParts` keeps only one: the order decides which, as internally.
  it('places the surface point first among the shapes', () => {
    const parts = buildGuestAnnotation({
      shapes: [rect],
      hotspot: { position: '1,2,3', normal: '0,1,0', space: 'object' },
    });
    expect(parts?.[0]).toEqual({ type: 'hotspot', position: '1,2,3', normal: '0,1,0', space: 'object' });
    expect(parts?.[1]).toEqual(rect);
  });

  it('omits the space when the hotspot declares none', () => {
    const parts = buildGuestAnnotation({ shapes: [], hotspot: { position: '1,2,3', normal: '0,1,0' } });
    expect(parts?.[0]).toEqual({ type: 'hotspot', position: '1,2,3', normal: '0,1,0' });
  });

  /**
   * The contract that really matters: a client's feedback is reopened in the artist's review.
   * What the guest writes must therefore be read back by the SAME reader as the internal one.
   */
  it('produces a format that the internal review reads back', () => {
    const parts = buildGuestAnnotation({
      shapes: [rect],
      hotspot: { position: '1,2,3', normal: '0,1,0' },
    });
    expect(splitAnnotationParts(parts).shapes).toEqual([rect]);
    // A guest's hotspot is read back as a numbered point of interest "1".
    expect(readPoiPoints(parts)).toEqual([{ position: '1,2,3', normal: '0,1,0' }]);
  });
});

describe('guestCommentContent — a drawing alone counts as feedback', () => {
  it('keeps the guest text, trimmed of surrounding spaces', () => {
    expect(guestCommentContent('  trop sombre  ', undefined)).toBe('trop sombre');
  });

  // The server requires content: without a fallback, a drawing alone would be rejected with a 400.
  it('replaces empty text with a fallback as soon as there is an annotation', () => {
    expect(guestCommentContent('', [rect])).toBe('(annotation)');
    expect(guestCommentContent('   ', [rect])).toBe('(annotation)');
  });

  it('returns nothing when there is neither text nor drawing', () => {
    expect(guestCommentContent('', undefined)).toBeNull();
  });
});

describe('frameOf — the frame number the guest cites to the studio', () => {
  it('counts within the project numbering, not from zero', () => {
    expect(frameOf(0, 24, 1001)).toBe(1001);
    expect(frameOf(1, 24, 1001)).toBe(1025);
  });

  // A fractional frame rate is the common case in production, not an exception.
  it('rounds to the nearest frame on a fractional frame rate', () => {
    expect(frameOf(1, 23.976, 1)).toBe(25);
  });

  it('never goes below the first frame', () => {
    expect(frameOf(-5, 24, 1001)).toBe(1001);
  });

  // Unknown frame rate: better show the first frame than a NaN to the client.
  it('falls back to the first frame when the frame rate is unusable', () => {
    expect(frameOf(10, 0, 1001)).toBe(1001);
    expect(frameOf(10, Number.NaN, 1001)).toBe(1001);
  });
});
