// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { framesAt, timecodeAt, timecodeFromFrames, toEdl } from './notesEdl';

/**
 * An EDL is read by editing software: the slightest misaligned column and the import fails without a word. So we verify
 * the shape of the lines as much as the timecodes.
 */

describe('timecodeFromFrames', () => {
  it('counts the frames within the second', () => {
    expect(timecodeFromFrames(0, 24)).toBe('00:00:00:00');
    expect(timecodeFromFrames(23, 24)).toBe('00:00:00:23');
    expect(timecodeFromFrames(24, 24)).toBe('00:00:01:00');
    expect(timecodeFromFrames(24 * 3600, 24)).toBe('01:00:00:00');
  });

  it('rounds the fractional rate (23.976 → 24 frames per second)', () => {
    expect(timecodeFromFrames(23, 23.976)).toBe('00:00:00:23');
    expect(timecodeFromFrames(24, 23.976)).toBe('00:00:01:00');
  });

  it('never goes below zero', () => {
    expect(timecodeFromFrames(-10, 25)).toBe('00:00:00:00');
    expect(framesAt(-3, 25)).toBe(0);
    expect(framesAt(2, 0)).toBe(0);
  });
});

describe('timecodeAt', () => {
  it('converts seconds', () => {
    expect(timecodeAt(1.5, 24)).toBe('00:00:01:12');
  });
});

describe('toEdl', () => {
  const edl = toEdl({
    title: 'Dailies\ndu jour',
    fps: 24,
    clips: [
      {
        name: 'SH010_comp_v003.mov',
        duration: 4,
        markers: [
          { at: 1.5, color: 'RED', label: 'Alice: flicker\nà gauche' },
          { at: 99, color: 'GREEN', label: 'Bob: ok' },
        ],
      },
      { name: 'SH020_comp_v001.mov', duration: 2, markers: [] },
      { name: 'carton vide', duration: 0, markers: [{ at: 0, color: 'CYAN', label: 'ignorée' }] },
    ],
  });
  const lines = edl.split('\n');

  it('opens with a single-line title and the non-drop rate', () => {
    expect(lines[0]).toBe('TITLE: Dailies du jour');
    expect(lines[1]).toBe('FCM: NON-DROP FRAME');
  });

  it('numbers the events and chains the record timecodes', () => {
    expect(lines[3]).toBe('001  AX       V     C       00:00:00:00 00:00:04:00 00:00:00:00 00:00:04:00');
    expect(edl).toContain('002  AX       V     C       00:00:00:00 00:00:02:00 00:00:04:00 00:00:06:00');
  });

  it('gives the real media name as a comment, the reel remaining auxiliary', () => {
    expect(lines[4]).toBe('* FROM CLIP NAME: SH010_comp_v003.mov');
  });

  it('places a note per marker, at the record timecode', () => {
    expect(lines[5]).toBe('* LOC: 00:00:01:12 RED Alice: flicker à gauche');
  });

  it('brings back into the clip a marker placed beyond its end', () => {
    expect(lines[6]).toBe('* LOC: 00:00:03:23 GREEN Bob: ok');
  });

  it('skips a clip of zero duration, markers included', () => {
    expect(edl).not.toContain('carton vide');
    expect(edl).not.toContain('ignorée');
  });
});

describe('toEdl — edge cases', () => {
  it('truncates an oversized label', () => {
    const edl = toEdl({
      title: 'x',
      fps: 24,
      clips: [{ name: 'a', duration: 1, markers: [{ at: 0, color: 'WHITE', label: 'z'.repeat(400) }] }],
    });
    const loc = edl.split('\n').find((l) => l.startsWith('* LOC:'))!;
    expect(loc.length).toBeLessThan(220);
    expect(loc.endsWith('…')).toBe(true);
  });

  it('falls back on 24 frames per second when the rate is absurd', () => {
    const edl = toEdl({ title: 'x', fps: 0, clips: [{ name: 'a', duration: 1, markers: [] }] });
    expect(edl).toContain('00:00:01:00');
  });
});
