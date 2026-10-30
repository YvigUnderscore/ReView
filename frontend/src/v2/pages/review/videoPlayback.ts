// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Media } from '../../types/api';

/** Playback rate of the media while a sequence is being assembled. */
export const ASSEMBLING_POLL_MS = 5000;

/**
 * What the video viewer can show of a media: play it, or say why it cannot yet.
 *
 * The player receives `proxyUrl ?? url`. For a video delivered as a file, `url` is still readable during
 * processing; for an image sequence, it is the `sequence.json` manifest — the player tried to read JSON
 * and stayed silent. And a failed processing showed neither its reason nor how to retry it, although
 * the worker's message contains both.
 */
export type VideoPlayback = 'play' | 'assembling' | 'failed';

/** A sequence carries its FFmpeg pattern as its name (`plan.%04d.exr`), never a file name. */
export const isSequenceName = (name: string): boolean => /%0\d+d\.[A-Za-z0-9]+$/.test(name);

export function videoPlayback(
  media: Pick<Media, 'status' | 'originalName'>,
  proxyUrl: string | null,
): VideoPlayback {
  // An already-produced proxy stays readable, even if a later retry failed.
  if (proxyUrl) return 'play';
  if (media.status === 'FAILED') return 'failed';
  if (media.status !== 'READY' && isSequenceName(media.originalName)) return 'assembling';
  return 'play';
}

/**
 * The only exception to "never refetch" on the review page (presigned URLs): a sequence being
 * assembled has nothing to read, so there is no reading to interrupt — and the player opens by itself
 * as soon as it is ready.
 */
export function assemblingPollMs(
  data: { media: Pick<Media, 'kind' | 'status' | 'originalName'>; proxyUrl: string | null } | undefined,
): number | false {
  return data?.media.kind === 'VIDEO' && videoPlayback(data.media, data.proxyUrl) === 'assembling'
    ? ASSEMBLING_POLL_MS
    : false;
}
