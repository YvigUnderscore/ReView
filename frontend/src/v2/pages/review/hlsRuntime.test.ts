// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import Hls from 'hls.js';
import { canUseHlsJs, hlsMseSupport, isHlsPlaylistUrl, type HlsSupportScope } from './hlsRuntime';
import { hlsMasterUrl } from './videoSource';

/**
 * The MSE support test is copied into `hlsRuntime` so that it can answer **without** loading the
 * 510 kB of hls.js. A copy that drifts from the original is a silent regression: it would send a
 * capable browser to the MP4 fallback (or the reverse). These tests therefore confront the two
 * implementations on the same global scope, and if hls.js changes its criterion at the next version
 * bump, they fail.
 */

const g = globalThis as Record<string, unknown>;
const GLOBALS = [
  'MediaSource',
  'ManagedMediaSource',
  'WebKitMediaSource',
  'SourceBuffer',
  'WebKitSourceBuffer',
];

function install(entries: Record<string, unknown>): void {
  GLOBALS.forEach((k) => delete g[k]);
  Object.entries(entries).forEach(([k, v]) => (g[k] = v));
}

/** Fake `MediaSource`: accepts only the listed types. */
const mediaSourceAccepting = (accepted: string[]) => ({
  isTypeSupported: (type: string) => accepted.some((a) => type.includes(a)),
});

/** Full `SourceBuffer`, as exposed by a modern browser. */
const fullSourceBuffer = { prototype: { appendBuffer: () => {}, remove: () => {} } };

afterEach(() => {
  GLOBALS.forEach((k) => delete g[k]);
});

describe('hlsMseSupport — same verdict as Hls.isSupported()', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['aucune API MSE (Safari iOS : HLS natif, la bibliothèque n’a jamais servi)', {}],
    [
      'MediaSource + SourceBuffer complets, H.264 accepté',
      { MediaSource: mediaSourceAccepting(['avc1']), SourceBuffer: fullSourceBuffer },
    ],
    [
      'MediaSource qui refuse tous les codecs',
      { MediaSource: mediaSourceAccepting([]), SourceBuffer: fullSourceBuffer },
    ],
    ['MediaSource sans isTypeSupported', { MediaSource: {}, SourceBuffer: fullSourceBuffer }],
    [
      'ManagedMediaSource seul (iOS 17)',
      { ManagedMediaSource: mediaSourceAccepting(['avc1']), SourceBuffer: fullSourceBuffer },
    ],
    [
      'SourceBuffer amputé de remove()',
      {
        MediaSource: mediaSourceAccepting(['avc1']),
        SourceBuffer: { prototype: { appendBuffer: () => {} } },
      },
    ],
    [
      'SourceBuffer non exposé globalement (navigateur ancien) — pas un refus',
      { MediaSource: mediaSourceAccepting(['avc1']) },
    ],
    [
      'seul l’audio est accepté',
      { MediaSource: mediaSourceAccepting(['mp4a.40.2']), SourceBuffer: fullSourceBuffer },
    ],
    [
      'préfixe WebKit',
      { WebKitMediaSource: mediaSourceAccepting(['avc1']), WebKitSourceBuffer: fullSourceBuffer },
    ],
  ];

  it.each(cases)('%s', (_name, scope) => {
    install(scope);
    expect(hlsMseSupport(globalThis as HlsSupportScope)).toBe(Hls.isSupported());
  });
});

describe('isHlsPlaylistUrl — load a manifest reader only for a manifest', () => {
  it('recognizes the master served by the review API', () => {
    // Contract with the URL producer: if `hlsMasterUrl` changed shape, the adaptive player would
    // silently stop serving. The test locks it in.
    expect(isHlsPlaylistUrl(hlsMasterUrl(42, { hls: {}, trim: null, trimProxyReady: false }))).toBe(true);
  });

  it('accepts a signed playlist (the signature lives in the query)', () => {
    expect(isHlsPlaylistUrl('https://cdn.example/a/master.m3u8?X-Amz-Signature=abc')).toBe(true);
  });

  it('rejects the MP4 fallback, a missing source, and a path containing "m3u8" without being one', () => {
    expect(isHlsPlaylistUrl('/api/media/42/proxy.mp4')).toBe(false);
    expect(isHlsPlaylistUrl(null)).toBe(false);
    expect(isHlsPlaylistUrl(undefined)).toBe(false);
    expect(isHlsPlaylistUrl('/api/media/42/m3u8/cover.jpg')).toBe(false);
  });
});

describe('canUseHlsJs — synchronous decision, without the library', () => {
  it('stays false without MSE, even for a playlist', () => {
    install({});
    expect(canUseHlsJs('/api/media/1/hls/master.m3u8')).toBe(false);
  });
});
