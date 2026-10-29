// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { qualityEncoderArgs, bitrateEncoderArgs } from './videoEncoder';

describe('videoEncoder', () => {
  it('libx264: crf + x264 preset + scene-cut disabled via sc_threshold', () => {
    expect(qualityEncoderArgs('libx264', 23, 'veryfast')).toEqual([
      '-c:v libx264',
      '-preset veryfast',
      '-crf 23',
    ]);
    expect(bitrateEncoderArgs('libx264', 'medium')).toContain('-sc_threshold');
  });

  it('nvenc: cq + mapped pN preset + no-scenecut', () => {
    expect(qualityEncoderArgs('h264_nvenc', 23, 'veryfast')).toEqual([
      '-c:v h264_nvenc',
      '-preset p3',
      '-cq 23',
    ]);
    const b = bitrateEncoderArgs('h264_nvenc', 'slow');
    expect(b).toContain('h264_nvenc');
    expect(b).toContain('p6');
    expect(b).toContain('-no-scenecut');
    expect(b).not.toContain('-sc_threshold');
  });

  it('unknown preset → p4 by default on nvenc', () => {
    expect(qualityEncoderArgs('h264_nvenc', 20, 'exotique')).toContain('-preset p4');
  });
});
