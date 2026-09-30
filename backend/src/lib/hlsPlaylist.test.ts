// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  HLS_URL_WINDOW_SEC,
  isSafeHlsName,
  playlistUris,
  rewritePlaylistUris,
  signingWindowStart,
  withPlaybackToken,
  withPresignedSegments,
} from './hlsPlaylist';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360',
  '360p.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720',
  '720p.m3u8',
  '',
].join('\n');

const RENDITION = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:2',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:2.000000,',
  '720p_000.ts',
  '#EXTINF:1.960000,',
  '720p_001.ts',
  '#EXT-X-ENDLIST',
  '',
].join('\n');

describe('hlsPlaylist — lecture des URI', () => {
  it('relève les URI nus et ceux des balises, sans doublon', () => {
    expect(playlistUris(MASTER)).toEqual(['360p.m3u8', '720p.m3u8']);
    expect(playlistUris(RENDITION)).toEqual(['720p_000.ts', '720p_001.ts']);
    expect(playlistUris('#EXT-X-MAP:URI="init.mp4"\ninit.mp4\nseg.m4s')).toEqual(['init.mp4', 'seg.m4s']);
  });

  it('laisse balises, commentaires et lignes vides intacts', () => {
    expect(rewritePlaylistUris(RENDITION, () => 'X')).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(rewritePlaylistUris(RENDITION, () => 'X')).toContain('#EXT-X-ENDLIST');
    expect(rewritePlaylistUris('#EXTM3U\n\n', () => 'X')).toBe('#EXTM3U\n\n');
  });

  it('supporte les fins de ligne Windows sans les recopier dans les URI', () => {
    expect(playlistUris('#EXTM3U\r\n720p_000.ts\r\n')).toEqual(['720p_000.ts']);
  });
});

describe('hlsPlaylist — maître porteur du jeton', () => {
  const withToken = withPlaybackToken(MASTER, 'jeton.abc');

  it('accroche le jeton à chaque rendition, en gardant l’URI relatif', () => {
    expect(withToken).toContain('360p.m3u8?pt=jeton.abc');
    expect(withToken).toContain('720p.m3u8?pt=jeton.abc');
  });

  it("n'altère ni les balises ni l'ordre des renditions", () => {
    expect(withToken.split('\n').slice(0, 3)).toEqual(MASTER.split('\n').slice(0, 3));
    expect(playlistUris(withToken)).toHaveLength(2);
  });

  it('échappe le jeton et enchaîne sur une query déjà présente', () => {
    expect(withPlaybackToken('a.m3u8?v=2', 'a b')).toBe('a.m3u8?v=2&pt=a%20b');
  });
});

describe('hlsPlaylist — sous-playlist présignée', () => {
  it('remplace chaque segment par son URL absolue', () => {
    const urls = new Map([
      ['720p_000.ts', 'https://cdn/review/derived/9/hls/720p_000.ts?X-Amz-Signature=aa'],
      ['720p_001.ts', 'https://cdn/review/derived/9/hls/720p_001.ts?X-Amz-Signature=bb'],
    ]);
    const out = withPresignedSegments(RENDITION, urls);
    expect(out).toContain('https://cdn/review/derived/9/hls/720p_000.ts?X-Amz-Signature=aa');
    expect(out).not.toMatch(/^720p_000\.ts$/m);
    // La structure de la playlist survit : autant de #EXTINF que de segments.
    expect(out.match(/#EXTINF/g)).toHaveLength(2);
  });

  it('laisse relatif (donc servi par le proxy) un URI absent de la table', () => {
    expect(withPresignedSegments(RENDITION, new Map())).toBe(RENDITION);
  });
});

describe('hlsPlaylist — fenêtre de signature', () => {
  it('renvoie le même début de fenêtre pour deux instants voisins', () => {
    const t = Date.UTC(2026, 7, 21, 10, 3, 12);
    expect(signingWindowStart(t)).toBe(Date.UTC(2026, 7, 21, 10, 0, 0));
    expect(signingWindowStart(t + 60_000)).toBe(signingWindowStart(t));
  });

  it('change de fenêtre au pas annoncé', () => {
    const t = Date.UTC(2026, 7, 21, 10, 3, 12);
    expect(signingWindowStart(t + HLS_URL_WINDOW_SEC * 1000)).toBe(
      signingWindowStart(t) + HLS_URL_WINDOW_SEC * 1000,
    );
  });
});

describe('hlsPlaylist — noms de fichiers', () => {
  it('accepte ce que produit le worker', () => {
    expect(isSafeHlsName('720p_003.ts')).toBe(true);
    expect(isSafeHlsName('master.m3u8')).toBe(true);
  });

  it('refuse tout ce qui composerait une autre clé de stockage', () => {
    for (const bad of ['../secret', 'a/b.ts', '.env', '', 'a.ts?x=1', 'a b.ts', '..'])
      expect(isSafeHlsName(bad), bad).toBe(false);
  });
});
