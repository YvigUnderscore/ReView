// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isInterlaced, parseFrameRate, parseFrameRateFraction, parseProbeOutput, probeArgs } from './ffprobe';

const sample = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: { duration: '12.3456' },
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '24000/1001' },
      { codec_type: 'audio' },
    ],
    ...over,
  });

describe('parseFrameRate', () => {
  it('ffprobe rational rounded to the hundredth (historical value of metadata.fps)', () => {
    expect(parseFrameRate('24000/1001')).toBe(23.98);
    expect(parseFrameRate('25/1')).toBe(25);
    expect(parseFrameRate('30000/1001')).toBe(29.97);
  });

  it('unusable values: undefined', () => {
    expect(parseFrameRate('0/0')).toBeUndefined();
    expect(parseFrameRate('25')).toBeUndefined();
    expect(parseFrameRate(undefined)).toBeUndefined();
    expect(parseFrameRate(25)).toBeUndefined();
    expect(parseFrameRate('a/b')).toBeUndefined();
  });
});

describe('parseFrameRateFraction', () => {
  it('keeps the exact frame rate rather than its rounding', () => {
    expect(parseFrameRateFraction('24000/1001')).toEqual({ num: 24000, den: 1001 });
    expect(parseFrameRateFraction('30000/1001')).toEqual({ num: 30000, den: 1001 });
    // The historical rounding, for its part, loses 0.004 frame per second.
    expect(parseFrameRate('24000/1001')).toBe(23.98);
    expect(24000 / 1001).not.toBe(23.98);
  });

  it('reduces the fraction: 50/2 and 25/1 describe the same rate', () => {
    expect(parseFrameRateFraction('50/2')).toEqual({ num: 25, den: 1 });
    expect(parseFrameRateFraction('25/1')).toEqual({ num: 25, den: 1 });
  });

  it('leaves a non-integer fraction intact (nothing to reduce)', () => {
    expect(parseFrameRateFraction('29.97/1')).toEqual({ num: 29.97, den: 1 });
  });

  it('rejects anything that is not a frame rate', () => {
    expect(parseFrameRateFraction('0/0')).toBeUndefined();
    expect(parseFrameRateFraction('25')).toBeUndefined();
    expect(parseFrameRateFraction('a/b')).toBeUndefined();
    expect(parseFrameRateFraction(undefined)).toBeUndefined();
    expect(parseFrameRateFraction(25)).toBeUndefined();
  });
});

describe('parseProbeOutput', () => {
  it('extracts duration, dimensions, frame rate and audio presence', () => {
    expect(parseProbeOutput(sample())).toEqual({
      duration: 12.35,
      width: 1920,
      height: 1080,
      fps: 23.98,
      // The exact frame rate now accompanies the historical rounding.
      fpsNum: 24000,
      fpsDen: 1001,
      hasAudio: true,
    });
  });

  it('numbers arrive as strings in the raw JSON', () => {
    const raw = JSON.stringify({
      format: { duration: '3' },
      streams: [{ codec_type: 'video', width: '640', height: '480' }],
    });
    expect(parseProbeOutput(raw)).toMatchObject({ duration: 3, width: 640, height: 480 });
  });

  it('media without an audio track', () => {
    const raw = JSON.stringify({
      format: { duration: '5' },
      streams: [{ codec_type: 'video', width: 10, height: 10 }],
    });
    expect(parseProbeOutput(raw).hasAudio).toBe(false);
  });

  it('still image: no duration', () => {
    const raw = JSON.stringify({
      format: {},
      streams: [{ codec_type: 'video', width: 800, height: 600 }],
    });
    const p = parseProbeOutput(raw);
    expect(p.duration).toBeUndefined();
    expect(p.width).toBe(800);
  });

  it('unreadable or empty output: empty result, never an exception', () => {
    expect(parseProbeOutput('')).toEqual({});
    expect(parseProbeOutput('not json')).toEqual({});
    expect(parseProbeOutput('{}')).toEqual({
      duration: undefined,
      width: undefined,
      height: undefined,
      fps: undefined,
      hasAudio: false,
    });
  });

  it('duration "N/A": ignored rather than NaN', () => {
    const raw = JSON.stringify({ format: { duration: 'N/A' }, streams: [] });
    expect(parseProbeOutput(raw).duration).toBeUndefined();
  });

  /**
   * Post-production masters: a ProRes MOV or an MXF regularly carries an attached picture (cover art, NLE
   * thumbnail) declared as a video stream. Taken as the main track, it imposed its definition on the whole
   * pipeline — proxy encoded at 120 px, HLS ladder computed from it, wrong review frame.
   */
  it('discards the attached picture of a master in favour of the real track', () => {
    const raw = JSON.stringify({
      format: { duration: '10' },
      streams: [
        { codec_type: 'video', width: 120, height: 120, disposition: { attached_pic: 1 } },
        { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1', codec_name: 'prores' },
      ],
    });
    expect(parseProbeOutput(raw)).toMatchObject({ width: 1920, height: 1080, videoCodec: 'prores' });
  });

  it('without a declared attached picture, keeps the track with the largest area', () => {
    const raw = JSON.stringify({
      format: {},
      streams: [
        { codec_type: 'video', width: 320, height: 240 },
        { codec_type: 'video', width: 4096, height: 2160 },
      ],
    });
    expect(parseProbeOutput(raw)).toMatchObject({ width: 4096, height: 2160 });
  });

  it('returns nothing rather than something wrong when all tracks are attached', () => {
    const raw = JSON.stringify({
      format: {},
      streams: [{ codec_type: 'video', width: 96, height: 96, disposition: { attached_pic: 1 } }],
    });
    // No "normal" track: better the cover art than nothing at all.
    expect(parseProbeOutput(raw).width).toBe(96);
  });

  it('reads the field order and channel count of the richest track', () => {
    const raw = JSON.stringify({
      format: { duration: '4' },
      streams: [
        { codec_type: 'video', width: 720, height: 576, field_order: 'tt', r_frame_rate: '25/1' },
        { codec_type: 'audio', channels: 2 },
        { codec_type: 'audio', channels: 6 },
      ],
    });
    expect(parseProbeOutput(raw)).toMatchObject({ fieldOrder: 'tt', audioChannels: 6, hasAudio: true });
  });
});

describe('isInterlaced', () => {
  it('recognises the four interlaced field orders', () => {
    for (const order of ['tt', 'bb', 'tb', 'bt']) expect(isInterlaced(order), order).toBe(true);
  });

  it('never deinterlaces on doubt', () => {
    expect(isInterlaced('progressive')).toBe(false);
    expect(isInterlaced('unknown')).toBe(false);
    expect(isInterlaced(undefined)).toBe(false);
  });
});

describe('probeArgs', () => {
  it('requests the full JSON of the targeted file', () => {
    const args = probeArgs('/tmp/a b.mp4');
    expect(args).toContain('-print_format');
    expect(args).toContain('json');
    expect(args).toContain('-show_streams');
    // The path is a separate argument: never a shell, so nothing to escape.
    expect(args[args.length - 1]).toBe('/tmp/a b.mp4');
  });
});
