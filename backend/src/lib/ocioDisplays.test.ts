// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { parseOcioDisplays, isValidDisplayView } from './ocioDisplays';

const SAMPLE = `ocio_profile_version: 2

roles:
  scene_linear: ACEScg

displays:
  sRGB - Display:
    - !<View> {name: ACES 1.0 - SDR Video, view_transform: ACES 1.0 - SDR Video, display_colorspace: sRGB - Display}
    - !<View> {name: Un-tone-mapped, view_transform: Un-tone-mapped, display_colorspace: sRGB - Display}
    - !<View> {name: Raw, colorspace: Raw}
  Rec.1886 Rec.709 - Display:
    - !<View> {name: ACES 1.0 - SDR Video, view_transform: ACES 1.0 - SDR Video, display_colorspace: Rec.1886 Rec.709 - Display}

active_displays: [sRGB - Display]
`;

describe('ocioDisplays — extraction of displays/views (39.B)', () => {
  it('extracts the displays and their views', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(displays).toHaveLength(2);
    expect(displays[0]).toEqual({
      name: 'sRGB - Display',
      views: ['ACES 1.0 - SDR Video', 'Un-tone-mapped', 'Raw'],
    });
    expect(displays[1]!.name).toBe('Rec.1886 Rec.709 - Display');
    expect(displays[1]!.views).toEqual(['ACES 1.0 - SDR Video']);
  });

  it('stops at the next top-level key (active_displays ignored)', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(displays.some((d) => d.name.startsWith('active'))).toBe(false);
  });

  it('returns empty when there is no displays section', () => {
    expect(parseOcioDisplays('roles:\n  scene_linear: ACEScg\n')).toEqual([]);
  });

  it('isValidDisplayView validates the pair', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(isValidDisplayView(displays, 'sRGB - Display', 'Raw')).toBe(true);
    expect(isValidDisplayView(displays, 'sRGB - Display', 'Inexistant')).toBe(false);
    expect(isValidDisplayView(displays, 'Autre', 'Raw')).toBe(false);
  });
});
