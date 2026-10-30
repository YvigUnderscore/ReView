// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * HLS master playlist generation (Phase 23) and related types. Pure/testable: the ffmpeg part lives in the
 * worker, only the text construction is here.
 */

export interface HlsRendition {
  height: number;
  width: number;
  videoBitrateK: number;
  audioBitrateK: number;
  /** Name of the sub-playlist (relative to the master), e.g. `720p.m3u8`. */
  playlist: string;
}

/** Standard rendition name from a height (e.g. 720 → `720p`). */
export const renditionName = (height: number) => `${height}p`;

/**
 * Target duration of an HLS segment (s). Short for responsive quality switches: without a fixed GOP,
 * libx264 places keyframes up to ~10 s apart → huge segments, very slow rendition switching and a frozen
 * picture (the audio still decodes) while downloading.
 */
export const HLS_SEGMENT_SEC = 2;

/** GOP size (frames): one keyframe per segment, set on the source fps (fallback 25). */
export function hlsGopSize(fps?: number): number {
  const f = fps && Number.isFinite(fps) && fps > 0 ? fps : 25;
  return Math.max(1, Math.round(f * HLS_SEGMENT_SEC));
}

/**
 * Master playlist referencing each rendition (bandwidth + resolution). The URIs are **relative**: served
 * behind the `/api/media/:id/hls/:file` proxy, they resolve correctly (the player resolves against the master's URL).
 */
export function buildMasterPlaylist(renditions: HlsRendition[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const r of renditions) {
    const bandwidth = Math.round((r.videoBitrateK + r.audioBitrateK) * 1000);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height}`);
    lines.push(r.playlist);
  }
  return lines.join('\n') + '\n';
}

/** HTTP content type of an HLS file (playlist or segment). */
export function hlsContentType(file: string): string {
  return file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
}
