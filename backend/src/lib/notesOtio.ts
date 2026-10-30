// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenTimelineIO (JSON) of a playlist or an edit, review notes as markers.
 *
 * Written by hand rather than with the Python library: the subset ReView needs — one timeline, one video track,
 * end-to-end clips, markers — fits in a few stable schemas, and one more dependency would be paid for on every deployment.
 *
 * The approach is that of a **minimal but valid** OTIO: only schemas that every OTIO version since 0.14 can read back
 * (`Timeline.1`, `Stack.1`, `Track.1`, `Clip.1`, `Marker.2`, `ExternalReference.1`, `MissingReference.1`,
 * `RationalTime.1`, `TimeRange.1`). In particular `Clip.1`/`media_reference` rather than `Clip.2`/`media_references`:
 * a recent reader upgrades the version on its own, the reverse is not true.
 *
 * PURE serialisation (no dependency): the service supplies resolved clips and markers.
 */

/** Marker colours defined by OTIO (`otio.schema.MarkerColor`). */
export type OtioColor = 'RED' | 'GREEN' | 'BLUE' | 'CYAN' | 'YELLOW' | 'MAGENTA' | 'WHITE';

export interface OtioMarker {
  name: string;
  color: OtioColor;
  /** Position within the clip, in seconds from its start. */
  at: number;
  /** Duration of the commented range, in seconds (0 = point marker). */
  span?: number;
  /** ReView metadata carried as-is (note id, state, author...). */
  metadata?: Record<string, unknown>;
}

export interface OtioClip {
  name: string;
  /** Clip duration in seconds. */
  duration: number;
  /** Media URL, if one is published; otherwise the reference is declared missing. */
  url?: string | null;
  markers: OtioMarker[];
  metadata?: Record<string, unknown>;
}

export interface OtioInput {
  name: string;
  fps: number;
  clips: OtioClip[];
}

const rationalTime = (frames: number, rate: number) => ({
  OTIO_SCHEMA: 'RationalTime.1',
  rate,
  value: frames,
});

const timeRange = (startFrames: number, durationFrames: number, rate: number) => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rationalTime(startFrames, rate),
  duration: rationalTime(durationFrames, rate),
});

/** Rounded frames of an instant — same convention as the EDL. */
const framesAt = (seconds: number, fps: number): number =>
  !Number.isFinite(seconds) || fps <= 0 ? 0 : Math.max(0, Math.round(seconds * fps));

function mediaReference(url: string | null | undefined) {
  if (!url) return { OTIO_SCHEMA: 'MissingReference.1', name: '', available_range: null, metadata: {} };
  return {
    OTIO_SCHEMA: 'ExternalReference.1',
    name: '',
    available_range: null,
    metadata: {},
    target_url: url,
  };
}

function marker(m: OtioMarker, fps: number, clipFrames: number) {
  const start = Math.min(framesAt(m.at, fps), Math.max(0, clipFrames - 1));
  const duration = Math.min(framesAt(m.span ?? 0, fps), Math.max(0, clipFrames - start));
  return {
    OTIO_SCHEMA: 'Marker.2',
    name: m.name,
    color: m.color,
    comment: '',
    marked_range: timeRange(start, duration, fps),
    metadata: m.metadata ? { ReView: m.metadata } : {},
  };
}

function clip(c: OtioClip, fps: number) {
  const frames = framesAt(c.duration, fps);
  return {
    OTIO_SCHEMA: 'Clip.1',
    name: c.name,
    source_range: timeRange(0, frames, fps),
    effects: [],
    markers: c.markers.map((m) => marker(m, fps, frames)),
    enabled: true,
    media_reference: mediaReference(c.url),
    metadata: c.metadata ? { ReView: c.metadata } : {},
  };
}

/**
 * Serialises a sequence of clips into an OTIO document (indented JSON, as `otio.adapters.write_to_string` writes it).
 * Zero-duration clips are discarded: OTIO accepts them, but no editing software does anything with them.
 */
export function toOtio(input: OtioInput): string {
  const fps = input.fps > 0 ? input.fps : 24;
  const children = input.clips.filter((c) => framesAt(c.duration, fps) > 0).map((c) => clip(c, fps));
  const document = {
    OTIO_SCHEMA: 'Timeline.1',
    name: input.name,
    global_start_time: rationalTime(0, fps),
    metadata: { ReView: { generator: 'ReView' } },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      metadata: {},
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'V1',
          kind: 'Video',
          source_range: null,
          effects: [],
          markers: [],
          enabled: true,
          metadata: {},
          children,
        },
      ],
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}
