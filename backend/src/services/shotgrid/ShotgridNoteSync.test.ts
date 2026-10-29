// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { frameLabel, isFromReview, mediaFrameRate, stripHtml } from './ShotgridNoteSync';

describe('frameLabel', () => {
  it('gives the frame when the rate is known', () => {
        // A review feedback is discussed in frames, not in seconds.
    expect(frameLabel(4, 25)).toBe('frame 100');
    expect(frameLabel(2.5, 24)).toBe('frame 60');
  });

  it('falls back to the time when the rate is missing', () => {
    expect(frameLabel(65, null)).toBe('1:05');
    expect(frameLabel(9, null)).toBe('0:09');
  });

  it('does not make up a reference without a timestamp', () => {
    expect(frameLabel(null, 25)).toBeNull();
  });
});

describe('mediaFrameRate', () => {
  it('reads the rate recorded by the pipeline', () => {
    expect(mediaFrameRate({ frameRate: 25 })).toBe(25);
    expect(mediaFrameRate({ fps: '23.976' })).toBeCloseTo(23.976);
  });

  it('ignores what is not a usable rate', () => {
    expect(mediaFrameRate({ frameRate: 0 })).toBeNull();
    expect(mediaFrameRate({})).toBeNull();
    expect(mediaFrameRate(null)).toBeNull();
  });
});

describe('stripHtml', () => {
  it('returns readable text in a ShotGrid note', () => {
    expect(stripHtml('<p>Le raccord <strong>saute</strong></p>')).toBe('Le raccord saute');
    expect(stripHtml('<p>Un</p><p>Deux</p>')).toBe('Un\nDeux');
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });

  it('restores the escaped entities', () => {
    expect(stripHtml('<p>1 &lt; 2 &amp; 3 &gt; 2</p>')).toBe('1 < 2 & 3 > 2');
  });
});

describe('isFromReview', () => {
  it('recognizes a note born in ReView', () => {
        // Without this mark, the note would come back as a duplicate of its own comment.
    expect(isFromReview('Retour\n[ReView] Admin')).toBe(true);
    expect(isFromReview('Note écrite dans ShotGrid')).toBe(false);
    expect(isFromReview(null)).toBe(false);
  });
});
