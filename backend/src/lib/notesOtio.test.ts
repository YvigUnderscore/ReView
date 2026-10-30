// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { toOtio } from './notesOtio';

/**
 * OTIO is JSON typed by schema names: that is what a reader checks before anything else. So we compare the structure
 * produced with the document `otio.adapters.write_to_string` would write for the same timeline.
 */

interface OtioTime {
  OTIO_SCHEMA: string;
  rate: number;
  value: number;
}
interface OtioRange {
  OTIO_SCHEMA: string;
  start_time: OtioTime;
  duration: OtioTime;
}
interface OtioMarkerOut {
  OTIO_SCHEMA: string;
  name: string;
  color: string;
  marked_range: OtioRange;
  metadata: { ReView?: { noteId?: number } };
}
interface OtioClipOut {
  OTIO_SCHEMA: string;
  name: string;
  source_range: OtioRange;
  markers: OtioMarkerOut[];
  media_reference: { OTIO_SCHEMA: string; target_url?: string };
}
interface OtioDoc {
  OTIO_SCHEMA: string;
  name: string;
  global_start_time: OtioTime;
  tracks: {
    OTIO_SCHEMA: string;
    children: Array<{ OTIO_SCHEMA: string; kind: string; children: OtioClipOut[] }>;
  };
}

const parse = (text: string): OtioDoc => JSON.parse(text) as OtioDoc;

const document = parse(
  toOtio({
    name: 'Dailies 21/08',
    fps: 25,
    clips: [
      {
        name: 'SH010_comp_v003',
        duration: 4,
        url: 'https://minio/SH010.mp4',
        markers: [
          { at: 2, span: 0.4, color: 'RED', name: 'Alice: flicker', metadata: { noteId: 12 } },
          { at: 50, color: 'GREEN', name: 'Bob: ok' },
        ],
      },
      { name: 'SH020_comp_v001', duration: 2, markers: [] },
      { name: 'vide', duration: 0, markers: [] },
    ],
  }),
);

const track = document.tracks.children[0]!;
const clip = track.children[0]!;

describe('toOtio', () => {
  it('produces a timeline with a single video track', () => {
    expect(document.OTIO_SCHEMA).toBe('Timeline.1');
    expect(document.name).toBe('Dailies 21/08');
    expect(document.tracks.OTIO_SCHEMA).toBe('Stack.1');
    expect(track.OTIO_SCHEMA).toBe('Track.1');
    expect(track.kind).toBe('Video');
  });

  it('expresses durations in frames at the given rate', () => {
    expect(document.global_start_time).toEqual({ OTIO_SCHEMA: 'RationalTime.1', rate: 25, value: 0 });
    expect(clip.source_range.duration.value).toBe(100);
    expect(clip.source_range.start_time.value).toBe(0);
  });

  it('discards clips of zero duration', () => {
    expect(track.children).toHaveLength(2);
    expect(track.children.map((c) => c.name)).not.toContain('vide');
  });

  it('places the notes as clip markers, range included', () => {
    const [first, second] = clip.markers;
    expect(first?.OTIO_SCHEMA).toBe('Marker.2');
    expect(first?.color).toBe('RED');
    expect(first?.name).toBe('Alice: flicker');
    expect(first?.marked_range.start_time.value).toBe(50);
    expect(first?.marked_range.duration.value).toBe(10);
    expect(first?.metadata.ReView?.noteId).toBe(12);
    // A marker outside the clip comes back onto its last frame rather than disappearing.
    expect(second?.marked_range.start_time.value).toBe(99);
    expect(second?.marked_range.duration.value).toBe(0);
  });

  it('declares an external reference when the URL exists, missing otherwise', () => {
    expect(clip.media_reference.OTIO_SCHEMA).toBe('ExternalReference.1');
    expect(clip.media_reference.target_url).toBe('https://minio/SH010.mp4');
    expect(track.children[1]?.media_reference.OTIO_SCHEMA).toBe('MissingReference.1');
  });
});
