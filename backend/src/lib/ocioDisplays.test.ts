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

describe('ocioDisplays — extraction displays/views (39.B)', () => {
  it('extrait les displays et leurs views', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(displays).toHaveLength(2);
    expect(displays[0]).toEqual({
      name: 'sRGB - Display',
      views: ['ACES 1.0 - SDR Video', 'Un-tone-mapped', 'Raw'],
    });
    expect(displays[1].name).toBe('Rec.1886 Rec.709 - Display');
    expect(displays[1].views).toEqual(['ACES 1.0 - SDR Video']);
  });

  it('s’arrête à la clé de premier niveau suivante (active_displays ignoré)', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(displays.some((d) => d.name.startsWith('active'))).toBe(false);
  });

  it('renvoie vide si pas de section displays', () => {
    expect(parseOcioDisplays('roles:\n  scene_linear: ACEScg\n')).toEqual([]);
  });

  it('isValidDisplayView valide le couple', () => {
    const displays = parseOcioDisplays(SAMPLE);
    expect(isValidDisplayView(displays, 'sRGB - Display', 'Raw')).toBe(true);
    expect(isValidDisplayView(displays, 'sRGB - Display', 'Inexistant')).toBe(false);
    expect(isValidDisplayView(displays, 'Autre', 'Raw')).toBe(false);
  });
});
