// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseSceneTimes, sceneFrames } from './sceneDetect';

describe('sceneDetect — marqueurs auto « Plan n » (34.H)', () => {
  it('parse les pts_time de la sortie showinfo', () => {
    const stderr = [
      '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  12800 pts_time:0.533333 duration:...',
      'bruit sans rapport',
      '[Parsed_showinfo_1 @ 0x1] n:   1 pts: 172032 pts_time:7.168 fmt:yuv420p',
    ].join('\n');
    expect(parseSceneTimes(stderr)).toEqual([0.533333, 7.168]);
  });

  it('convertit en frames uniques croissantes, sans la frame 0', () => {
    expect(sceneFrames([0, 0.5, 0.51, 2], 24)).toEqual([12, 48]);
  });

  it('borne au garde-fou et replie le fps invalide sur 24', () => {
    const times = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(sceneFrames(times, NaN, 3)).toEqual([24, 48, 72]);
  });
});
