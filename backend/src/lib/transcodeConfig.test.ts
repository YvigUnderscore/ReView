// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { selectRenditions, type TranscodeConfig } from './transcodeConfig';

const config: TranscodeConfig = {
  enabled: true,
  crf: 23,
  preset: 'veryfast',
  audioBitrateK: 128,
  maxHeight: 2160,
  ladder: [
    { height: 360, videoBitrateK: 800 },
    { height: 720, videoBitrateK: 2500 },
    { height: 1080, videoBitrateK: 5000 },
    { height: 2160, videoBitrateK: 14000 },
  ],
};

describe('transcodeConfig.selectRenditions (Phase 22)', () => {
  it('garde les paliers ≤ hauteur source', () => {
    expect(selectRenditions(config, 1080).map((r) => r.height)).toEqual([360, 720, 1080]);
  });

  it('borne par maxHeight (pas d’up-scale au-delà du plafond)', () => {
    expect(selectRenditions({ ...config, maxHeight: 720 }, 2160).map((r) => r.height)).toEqual([360, 720]);
  });

  it('source plus petite que le plus petit palier → une rendition à la hauteur source', () => {
    const out = selectRenditions(config, 240);
    expect(out).toHaveLength(1);
    expect(out[0].height).toBe(240);
  });

  it('source 4K → toute l’échelle', () => {
    expect(selectRenditions(config, 2160).map((r) => r.height)).toEqual([360, 720, 1080, 2160]);
  });
});
