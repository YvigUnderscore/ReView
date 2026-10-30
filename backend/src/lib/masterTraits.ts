// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Peculiarities of a post-production master that change the way it is encoded.
 *
 * A studio deliverable does not look like the MP4 the chain was written for: a broadcast MXF is often interlaced, and
 * a ProRes master often carries more than two audio channels. Encoded carelessly, the first comes out combed and the
 * second in 5.1 — two defects discovered only at review, after the encoding has been paid for.
 *
 * The decisions live here, separated from their execution, so they can be verified without launching FFmpeg. They are
 * taken **once** after the probe and applied identically to the proxy and to the whole HLS ladder: otherwise a
 * de-interlaced rendition would sit beside a combed one, and the change of quality would show in the picture.
 */

import { isInterlaced } from './ffprobe';

export interface SourceTraits {
  deinterlace: boolean;
  downmixStereo: boolean;
}

export const NO_TRAITS: SourceTraits = { deinterlace: false, downmixStereo: false };

/**
 * Derives the master's traits from what the probe found.
 *
 * Takes the metadata block as the worker assembles it (values of uncertain type): a silent probe — ffprobe that could
 * read nothing — must trigger nothing.
 */
export function sourceTraits(meta: Record<string, unknown>): SourceTraits {
  const fieldOrder = typeof meta.fieldOrder === 'string' ? meta.fieldOrder : undefined;
  const channels = typeof meta.audioChannels === 'number' ? meta.audioChannels : 0;
  return { deinterlace: isInterlaced(fieldOrder), downmixStereo: channels > 2 };
}

/**
 * Filters to insert **at the head** of the video chain.
 *
 * `yadif` costs one field in two, but the picture stops combing. It precedes the resize: placed after it, it would
 * de-interlace fields already mixed by the resampling, which cannot be recovered.
 */
export const preFiltersFor = (traits: SourceTraits): string[] => (traits.deinterlace ? ['yadif'] : []);

/** Stereo downmix of multichannel masters (5.1 and beyond). Never an upmix. */
export const audioOptionsFor = (traits: SourceTraits): string[] => (traits.downmixStereo ? ['-ac', '2'] : []);
