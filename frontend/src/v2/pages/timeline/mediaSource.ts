// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Hls from 'hls.js';
import { api } from '@/lib/apiClient';

/**
 * Source of a montage media — the same as the review's: the HLS master served by the authenticated
 * proxy when renditions exist, the web file otherwise.
 *
 * Aligning the two is not cosmetic: the montage must read what the review reads, otherwise a shot
 * visible in review would stay black in the film without anyone knowing why.
 *
 * Shared between video playback (`useContinuousPlayback`) and still shots (`useStillSource`): the
 * latter only take `file`, which they set in an `<img>`.
 */
export async function playbackSource(
  mediaId: number,
): Promise<{ url: string; hls: boolean; file: string | null } | null> {
  const data = await api.get<{ url: string; proxyUrl: string | null; hls?: unknown }>(
    `/api/media/${mediaId}`,
  );
  const file = data.proxyUrl ?? data.url ?? null;
  if (data.hls && Hls.isSupported()) return { url: `/api/media/${mediaId}/hls/master.m3u8`, hls: true, file };
  return file ? { url: file, hls: false, file } : null;
}
