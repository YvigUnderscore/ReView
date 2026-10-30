// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { commentMarkers, shotLabelOf, type MontageComment } from './montageFeedback';
import { stripHtml } from '../../lib/richText';
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
  mediaKind: 'VIDEO',
  thumbnailUrl: null,
  placeholder: false,
  durationMismatch: false,
  ...over,
});

// Two shots of 10 s: [0-10[ and [10-20[
const clips = [
  clip({ order: 0, startTime: 0 }),
  clip({ order: 1, startTime: 10, sequenceId: 2, sequenceCode: 'SQ020' }),
];

const comment = (over: Partial<MontageComment> & { id: number }): MontageComment => ({
  mediaObjectId: 100,
  author: null,
  guestName: null,
  cameraState: null,
  annotation: null,
  isEdited: false,
  isResolved: false,
  content: 'à revoir',
  timestamp: 1,
  timelineTime: 1,
  sharedToShot: false,
  createdAt: '2026-08-09T10:00:00.000Z',
  ...over,
});

describe('shotLabelOf', () => {
  it('names the shot by its sequence and code', () => {
    expect(shotLabelOf(clips, 101)).toBe('SQ020 · SH010');
  });

  it('uses only the code when the shot has no sequence', () => {
    const orphan = [clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null })];
    expect(shotLabelOf(orphan, 100)).toBe('SH000');
  });

  it('returns a dash for a media absent from the montage', () => {
    expect(shotLabelOf(clips, 999)).toBe('—');
    expect(shotLabelOf(clips, null)).toBe('—');
  });

  // A placeholder has no media: confusing it with "no anchor" would pin every orphan note onto
  // the first gap that comes along.
  it('does not treat a placeholder as a note without an anchor', () => {
    const withGap = [clip({ order: 0, startTime: 0, mediaId: null, placeholder: true })];
    expect(shotLabelOf(withGap, null)).toBe('—');
  });
});

describe('commentMarkers', () => {
  it('places each note at its position in the film', () => {
    const markers = commentMarkers([comment({ id: 1, timelineTime: 12.5 })], clips);
    expect(markers[0]).toMatchObject({ id: 1, time: 12.5, shared: false });
  });

  it('distinguishes the notes already sent back to the review', () => {
    const markers = commentMarkers([comment({ id: 2, sharedToShot: true })], clips);
    expect(markers[0].shared).toBe(true);
  });

  // A note without a film position stays visible: it is placed according to its shot.
  it('places a note without a position according to its shot and frame', () => {
    const markers = commentMarkers(
      [comment({ id: 3, timelineTime: null, mediaObjectId: 101, timestamp: 4 })],
      clips,
    );
    expect(markers[0].time).toBe(14);
  });

  it('caps the fallback at the shot duration', () => {
    const markers = commentMarkers(
      [comment({ id: 4, timelineTime: null, mediaObjectId: 101, timestamp: 99 })],
      clips,
    );
    expect(markers[0].time).toBe(20);
  });

  it('labels the marker with its shot and the note text', () => {
    const markers = commentMarkers([comment({ id: 5, content: '<p>trop <b>long</b></p>' })], clips);
    expect(markers[0].label).toBe('SQ010 · SH000 — trop long');
  });
});

describe('stripHtml', () => {
  it('returns the bare text of tagged content', () => {
    expect(stripHtml('<p>Bonjour <em>le</em> monde</p>')).toBe('Bonjour le monde');
  });

  it('handles content that is already bare', () => {
    expect(stripHtml('simple')).toBe('simple');
  });
});
