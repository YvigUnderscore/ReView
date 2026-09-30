// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { frameLabel, isFromReview, mediaFrameRate, stripHtml } from './ShotgridNoteSync';

describe('frameLabel', () => {
  it('donne la frame quand la cadence est connue', () => {
    // Un retour de review se discute en frames, pas en secondes.
    expect(frameLabel(4, 25)).toBe('frame 100');
    expect(frameLabel(2.5, 24)).toBe('frame 60');
  });

  it('retombe sur le temps quand la cadence manque', () => {
    expect(frameLabel(65, null)).toBe('1:05');
    expect(frameLabel(9, null)).toBe('0:09');
  });

  it('ne fabrique pas de repère sans horodatage', () => {
    expect(frameLabel(null, 25)).toBeNull();
  });
});

describe('mediaFrameRate', () => {
  it('lit la cadence relevée par le pipeline', () => {
    expect(mediaFrameRate({ frameRate: 25 })).toBe(25);
    expect(mediaFrameRate({ fps: '23.976' })).toBeCloseTo(23.976);
  });

  it('ignore ce qui n’est pas une cadence exploitable', () => {
    expect(mediaFrameRate({ frameRate: 0 })).toBeNull();
    expect(mediaFrameRate({})).toBeNull();
    expect(mediaFrameRate(null)).toBeNull();
  });
});

describe('stripHtml', () => {
  it('rend un texte lisible dans une note ShotGrid', () => {
    expect(stripHtml('<p>Le raccord <strong>saute</strong></p>')).toBe('Le raccord saute');
    expect(stripHtml('<p>Un</p><p>Deux</p>')).toBe('Un\nDeux');
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });

  it('restitue les entités échappées', () => {
    expect(stripHtml('<p>1 &lt; 2 &amp; 3 &gt; 2</p>')).toBe('1 < 2 & 3 > 2');
  });
});

describe('isFromReview', () => {
  it('reconnaît une note née dans ReView', () => {
    // Sans ce repère, la note reviendrait en double de son propre commentaire.
    expect(isFromReview('Retour\n[ReView] Admin')).toBe(true);
    expect(isFromReview('Note écrite dans ShotGrid')).toBe(false);
    expect(isFromReview(null)).toBe(false);
  });
});
