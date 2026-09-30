// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import Hls from 'hls.js';
import { canUseHlsJs, hlsMseSupport, isHlsPlaylistUrl, type HlsSupportScope } from './hlsRuntime';
import { hlsMasterUrl } from './videoSource';

/**
 * Le test de support MSE est recopié dans `hlsRuntime` pour répondre **sans** charger les
 * 510 ko de hls.js. Une copie qui dérive de l'original est une régression silencieuse :
 * elle enverrait un navigateur capable vers le repli MP4 (ou l'inverse). Ces tests
 * confrontent donc les deux implémentations sur la même portée globale — et si hls.js
 * change de critère à la prochaine montée de version, ils tombent.
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

/** Faux `MediaSource` : n'accepte que les types listés. */
const mediaSourceAccepting = (accepted: string[]) => ({
  isTypeSupported: (type: string) => accepted.some((a) => type.includes(a)),
});

/** `SourceBuffer` complet — celui qu'expose un navigateur moderne. */
const fullSourceBuffer = { prototype: { appendBuffer: () => {}, remove: () => {} } };

afterEach(() => {
  GLOBALS.forEach((k) => delete g[k]);
});

describe('hlsMseSupport — même verdict que Hls.isSupported()', () => {
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

describe('isHlsPlaylistUrl — ne charger un lecteur de manifestes que pour un manifeste', () => {
  it('reconnaît le master servi par l’API de review', () => {
    // Contrat avec le producteur d’URL : si `hlsMasterUrl` changeait de forme, le lecteur
    // adaptatif cesserait silencieusement de servir. Le test le verrouille.
    expect(isHlsPlaylistUrl(hlsMasterUrl(42, { hls: {}, trim: null, trimProxyReady: false }))).toBe(true);
  });

  it('accepte une playlist signée (la signature vit dans la query)', () => {
    expect(isHlsPlaylistUrl('https://cdn.example/a/master.m3u8?X-Amz-Signature=abc')).toBe(true);
  });

  it('refuse le repli MP4, l’absence de source et un chemin qui contient « m3u8 » sans l’être', () => {
    expect(isHlsPlaylistUrl('/api/media/42/proxy.mp4')).toBe(false);
    expect(isHlsPlaylistUrl(null)).toBe(false);
    expect(isHlsPlaylistUrl(undefined)).toBe(false);
    expect(isHlsPlaylistUrl('/api/media/42/m3u8/cover.jpg')).toBe(false);
  });
});

describe('canUseHlsJs — décision synchrone, sans la bibliothèque', () => {
  it('reste faux sans MSE, même sur une playlist', () => {
    install({});
    expect(canUseHlsJs('/api/media/1/hls/master.m3u8')).toBe(false);
  });
});
