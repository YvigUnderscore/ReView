// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import Hls from 'hls.js';
import { api } from '../../../lib/apiClient';

/**
 * Source d'un média du montage — la même que celle de la review : le master HLS servi par le
 * proxy authentifié quand des renditions existent, le fichier web sinon.
 *
 * Aligner les deux n'est pas cosmétique : le montage doit lire ce que la review lit, faute de
 * quoi un plan visible en review resterait noir dans le film sans qu'on sache pourquoi.
 *
 * Partagé entre la lecture vidéo (`useContinuousPlayback`) et les plans-image
 * (`useStillSource`) : ces derniers ne prennent que `file`, qu'ils posent dans une `<img>`.
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
