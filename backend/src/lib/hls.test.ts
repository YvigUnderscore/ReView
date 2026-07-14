import { describe, it, expect } from 'vitest';
import { buildMasterPlaylist, renditionName, hlsContentType, type HlsRendition } from './hls';

describe('hls (Phase 23)', () => {
  it('renditionName', () => {
    expect(renditionName(720)).toBe('720p');
  });

  it('hlsContentType distingue playlist et segment', () => {
    expect(hlsContentType('master.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(hlsContentType('720p_003.ts')).toBe('video/mp2t');
  });

  it('buildMasterPlaylist émet une entrée par rendition (bande passante + résolution)', () => {
    const renditions: HlsRendition[] = [
      { height: 360, width: 640, videoBitrateK: 800, audioBitrateK: 128, playlist: '360p.m3u8' },
      { height: 720, width: 1280, videoBitrateK: 2500, audioBitrateK: 128, playlist: '720p.m3u8' },
    ];
    const m = buildMasterPlaylist(renditions);
    expect(m.startsWith('#EXTM3U')).toBe(true);
    expect(m).toContain('#EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360');
    expect(m).toContain('360p.m3u8');
    expect(m).toContain('#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720');
    expect(m).toContain('720p.m3u8');
  });
});
