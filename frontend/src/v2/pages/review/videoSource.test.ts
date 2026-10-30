// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canPlayHlsMaster, hlsMasterUrl } from './videoSource';

const hls = { renditions: [{ height: 720, width: 1280, videoBitrateK: 2500 }] };
const trim = { inFrame: 24, outFrame: 240 };

describe('canPlayHlsMaster — the trim takes precedence over the adaptive ladder', () => {
  it('serves HLS when the media is not trimmed', () => {
    expect(canPlayHlsMaster({ hls, trim: null, trimProxyReady: false })).toBe(true);
  });

  it('refuses HLS once the trimmed proxy is ready: the master ignores the trim', () => {
    expect(canPlayHlsMaster({ hls, trim, trimProxyReady: true })).toBe(false);
  });

  it('keeps HLS while the trimmed proxy is being built', () => {
    // The timeline greys out the areas outside the trim so the user sees what will be removed.
    expect(canPlayHlsMaster({ hls, trim, trimProxyReady: false })).toBe(true);
  });

  it('without renditions, there is nothing to serve', () => {
    expect(canPlayHlsMaster({ hls: null, trim: null, trimProxyReady: false })).toBe(false);
    expect(canPlayHlsMaster({ hls: null, trim, trimProxyReady: true })).toBe(false);
  });
});

describe('hlsMasterUrl', () => {
  it('points to the master served by the authenticated proxy', () => {
    expect(hlsMasterUrl(42, { hls, trim: null, trimProxyReady: false })).toBe(
      '/api/media/42/hls/master.m3u8',
    );
  });

  it('returns null when the trim is active, so the player falls back to the MP4 proxy', () => {
    expect(hlsMasterUrl(42, { hls, trim, trimProxyReady: true })).toBeNull();
  });
});
