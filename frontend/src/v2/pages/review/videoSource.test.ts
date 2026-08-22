// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canPlayHlsMaster, hlsMasterUrl } from './videoSource';

const hls = { renditions: [{ height: 720, width: 1280, videoBitrateK: 2500 }] };
const trim = { inFrame: 24, outFrame: 240 };

describe('canPlayHlsMaster — la coupe passe avant l’échelle adaptative', () => {
  it('sert le HLS quand le média n’est pas coupé', () => {
    expect(canPlayHlsMaster({ hls, trim: null, trimProxyReady: false })).toBe(true);
  });

  it('refuse le HLS dès que le proxy coupé est prêt : le master ignore la coupe', () => {
    expect(canPlayHlsMaster({ hls, trim, trimProxyReady: true })).toBe(false);
  });

  it('garde le HLS le temps que le proxy coupé se fabrique', () => {
    // La timeline grise alors les zones hors coupe : l'utilisateur voit ce qui va partir.
    expect(canPlayHlsMaster({ hls, trim, trimProxyReady: false })).toBe(true);
  });

  it('sans renditions, il n’y a rien à servir', () => {
    expect(canPlayHlsMaster({ hls: null, trim: null, trimProxyReady: false })).toBe(false);
    expect(canPlayHlsMaster({ hls: null, trim, trimProxyReady: true })).toBe(false);
  });
});

describe('hlsMasterUrl', () => {
  it('pointe le master servi par le proxy authentifié', () => {
    expect(hlsMasterUrl(42, { hls, trim: null, trimProxyReady: false })).toBe(
      '/api/media/42/hls/master.m3u8',
    );
  });

  it('rend null quand la coupe est active — le lecteur reprend le proxy MP4', () => {
    expect(hlsMasterUrl(42, { hls, trim, trimProxyReady: true })).toBeNull();
  });
});
