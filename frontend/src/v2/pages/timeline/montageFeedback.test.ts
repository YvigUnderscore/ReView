// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { commentMarkers, shotLabelOf, stripHtml, type MontageComment } from './montageFeedback';
import type { TimelineClip } from '../../types/api';

const clip = (over: Partial<TimelineClip> & { order: number; startTime: number }): TimelineClip => ({
  duration: 10,
  shotId: over.order + 1,
  shotCode: `SH0${over.order}0`,
  shotName: 'Plan',
  sequenceId: 1,
  sequenceCode: 'SQ010',
  versionId: 10,
  versionName: 'v0001',
  department: 'ANIMATION',
  departmentName: 'Animation',
  mediaId: 100 + over.order,
  mediaName: 'plan.mp4',
  thumbnailUrl: null,
  placeholder: false,
  durationMismatch: false,
  ...over,
});

// Deux plans de 10 s : [0-10[ et [10-20[
const clips = [
  clip({ order: 0, startTime: 0 }),
  clip({ order: 1, startTime: 10, sequenceId: 2, sequenceCode: 'SQ020' }),
];

const comment = (over: Partial<MontageComment> & { id: number }): MontageComment => ({
  mediaObjectId: 100,
  content: 'à revoir',
  timestamp: 1,
  timelineTime: 1,
  sharedToShot: false,
  createdAt: '2026-08-09T10:00:00.000Z',
  ...over,
});

describe('shotLabelOf', () => {
  it('nomme le plan par sa séquence et son code', () => {
    expect(shotLabelOf(clips, 101)).toBe('SQ020 · SH010');
  });

  it('se contente du code quand le plan n’a pas de séquence', () => {
    const orphan = [clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null })];
    expect(shotLabelOf(orphan, 100)).toBe('SH000');
  });

  it('rend un tiret pour un média absent du montage', () => {
    expect(shotLabelOf(clips, 999)).toBe('—');
    expect(shotLabelOf(clips, null)).toBe('—');
  });

  // Un carton n'a pas de média : le confondre avec « pas d'ancrage » collerait tous les
  // retours orphelins sur le premier trou venu.
  it('n’assimile pas un carton à un retour sans ancrage', () => {
    const withGap = [clip({ order: 0, startTime: 0, mediaId: null, placeholder: true })];
    expect(shotLabelOf(withGap, null)).toBe('—');
  });
});

describe('commentMarkers', () => {
  it('place chaque retour à sa position dans le film', () => {
    const markers = commentMarkers([comment({ id: 1, timelineTime: 12.5 })], clips);
    expect(markers[0]).toMatchObject({ id: 1, time: 12.5, shared: false });
  });

  it('distingue les retours déjà renvoyés sur la review', () => {
    const markers = commentMarkers([comment({ id: 2, sharedToShot: true })], clips);
    expect(markers[0]!.shared).toBe(true);
  });

  // Un retour sans position de film reste visible : on le replace d'après son plan.
  it('replace un retour sans position d’après son plan et sa frame', () => {
    const markers = commentMarkers(
      [comment({ id: 3, timelineTime: null, mediaObjectId: 101, timestamp: 4 })],
      clips,
    );
    expect(markers[0]!.time).toBe(14);
  });

  it('borne le repli à la durée du plan', () => {
    const markers = commentMarkers(
      [comment({ id: 4, timelineTime: null, mediaObjectId: 101, timestamp: 99 })],
      clips,
    );
    expect(markers[0]!.time).toBe(20);
  });

  it('étiquette le repère avec son plan et le texte du retour', () => {
    const markers = commentMarkers([comment({ id: 5, content: '<p>trop <b>long</b></p>' })], clips);
    expect(markers[0]!.label).toBe('SQ010 · SH000 — trop long');
  });
});

describe('stripHtml', () => {
  it('rend le texte nu d’un contenu balisé', () => {
    expect(stripHtml('<p>Bonjour <em>le</em> monde</p>')).toBe('Bonjour le monde');
  });

  it('encaisse un contenu déjà nu', () => {
    expect(stripHtml('simple')).toBe('simple');
  });
});
