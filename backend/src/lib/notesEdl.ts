// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CMX3600 EDL of a playlist or an edit, review notes included as markers.
 *
 * This is the format every editing suite can read (Resolve, Premiere, Avid, Hiero). One event per clip, end to end on the
 * record timeline; each note becomes a `* LOC:` line — the Resolve/Premiere convention for a marker — placed at the record
 * timecode where it was written.
 *
 * Deliberately conservative: reel `AX` (auxiliary) and real name in `* FROM CLIP NAME:`, because the CMX3600 reel column
 * holds eight characters and a studio media name never fits there. Non-drop only: ReView does not store a source
 * timecode, everything starts at 00:00:00:00 — better a coherent EDL than an EDL that claims to know the timecode of the
 * tape.
 *
 * PURE serialisation (no dependency): the service supplies resolved clips and markers.
 */

/** Marker colours accepted by Resolve/Premiere EDLs. */
export type EdlColor = 'RED' | 'GREEN' | 'BLUE' | 'CYAN' | 'YELLOW' | 'WHITE';

export interface EdlMarker {
  /** Position within the clip, in seconds from its start. */
  at: number;
  color: EdlColor;
  /** Marker label (author + text) — folded onto one line. */
  label: string;
}

export interface EdlClip {
  /** Readable name of the media (`* FROM CLIP NAME:`). */
  name: string;
  /** Clip duration in seconds. */
  duration: number;
  markers: EdlMarker[];
}

export interface EdlInput {
  title: string;
  fps: number;
  clips: EdlClip[];
}

/** Maximum length of a marker label: beyond it, readers truncate on their own. */
const MAX_LABEL = 180;

/** Frame index of an instant, for a given rate. */
export function framesAt(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.max(0, Math.round(seconds * fps));
}

/** Non-drop HH:MM:SS:FF timecode of a frame index. */
export function timecodeFromFrames(frame: number, fps: number): string {
  const perSecond = Math.max(1, Math.round(fps));
  const f = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(f / perSecond);
  const p = (n: number) => String(n).padStart(2, '0');
  const hh = p(Math.floor(totalSeconds / 3600) % 24);
  const mm = p(Math.floor(totalSeconds / 60) % 60);
  return `${hh}:${mm}:${p(totalSeconds % 60)}:${p(f % perSecond)}`;
}

/** Non-drop timecode of an instant in seconds. */
export const timecodeAt = (seconds: number, fps: number): string =>
  timecodeFromFrames(framesAt(seconds, fps), fps);

/** An EDL line supports neither line breaks nor tabs. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}

/** A CMX3600 event: number, reel, track, hard cut, four timecodes. */
function eventLine(index: number, srcIn: string, srcOut: string, recIn: string, recOut: string): string {
  const num = String(index).padStart(3, '0');
  return `${num}  ${'AX'.padEnd(8)} ${'V'.padEnd(5)} ${'C'.padEnd(8)}${srcIn} ${srcOut} ${recIn} ${recOut}`;
}

/**
 * Serialises a sequence of clips into an EDL. Clips of zero or negative duration are ignored: an event of zero length
 * makes the import fail in most readers.
 */
export function toEdl(input: EdlInput): string {
  const fps = input.fps > 0 ? input.fps : 24;
  const lines = [`TITLE: ${oneLine(input.title)}`, 'FCM: NON-DROP FRAME', ''];
  let recordFrame = 0;
  let event = 0;
  for (const clip of input.clips) {
    const length = framesAt(clip.duration, fps);
    if (length <= 0) continue;
    event += 1;
    const srcIn = timecodeFromFrames(0, fps);
    const srcOut = timecodeFromFrames(length, fps);
    const recIn = timecodeFromFrames(recordFrame, fps);
    const recOut = timecodeFromFrames(recordFrame + length, fps);
    lines.push(eventLine(event, srcIn, srcOut, recIn, recOut));
    lines.push(`* FROM CLIP NAME: ${oneLine(clip.name)}`);
    for (const marker of clip.markers) {
      // A marker placed beyond the end of the clip is brought back onto its last frame: outside the event, readers attach
      // it to the next clip.
      const offset = Math.min(framesAt(marker.at, fps), Math.max(0, length - 1));
      const at = timecodeFromFrames(recordFrame + offset, fps);
      lines.push(`* LOC: ${at} ${marker.color} ${oneLine(marker.label)}`);
    }
    lines.push('');
    recordFrame += length;
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
