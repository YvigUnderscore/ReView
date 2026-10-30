// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Playback frame rate of the player: the value from which **all** frame numbers derive.
 *
 * The probe rounded the rate to the hundredth for a long time: 24000/1001 was stored as
 * `23.98`. The gap looks nil and is not: 0.003976 frame per second, so a whole frame after four
 * minutes, two after eight. A supervisor's "F1247" then stops designating the image the artist
 * opens in their DCC.
 *
 * The probe now keeps the exact fraction (`fpsNum`/`fpsDen`), but media already transcoded
 * carry only the rounded value, so it must be readable back. This is possible without ambiguity,
 * because fractional rates form a closed set: those of NTSC television, all over 1001. No camera
 * runs at exactly 23.98; a media announced at 23.98 is a 24000/1001 media, and nothing else.
 */

export interface FrameRateFraction {
  num: number;
  den: number;
}

/** Fractional rates of the NTSC world: the only case where rounding misleads. */
export const NTSC_FRAME_RATES: readonly FrameRateFraction[] = [
  { num: 24000, den: 1001 },
  { num: 30000, den: 1001 },
  { num: 48000, den: 1001 },
  { num: 60000, den: 1001 },
  { num: 120000, den: 1001 },
];

/**
 * Recognition tolerance. Rounding to the hundredth moves the rate by 0.005 at most; the
 * neighbouring integer rate, however, is 0.024 away (24 against 23.976) or more. A threshold of
 * 0.02 therefore separates the two without ever confusing 24 with 23.976.
 */
const MATCH_TOLERANCE = 0.02;

/**
 * Decimals kept. 23.976 instead of 23.976023976…: the residual error is 0.000024 frame per
 * second, i.e. one frame after nearly six hours of media, beyond the reach of any shot. The value
 * stays readable wherever it is displayed (fps field of the transport bar, technical sheet).
 * It is, moreover, the form written by editing tools.
 */
const DECIMALS = 3;

const round = (n: number): number => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

/**
 * Exact fraction of a rate: the one the probe read if it is known, otherwise the one that the
 * rounding points to. `null` when the rate is an integer (nothing to correct) or unusable.
 */
export function frameRateFraction(
  fps: number | null | undefined,
  probed?: Partial<FrameRateFraction> | null,
): FrameRateFraction | null {
  if (probed && probed.num && probed.den) return { num: probed.num, den: probed.den };
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) return null;
  return NTSC_FRAME_RATES.find((r) => Math.abs(fps - r.num / r.den) < MATCH_TOLERANCE) ?? null;
}

/**
 * Rate to use to convert a time into a frame number. Returns the input value unchanged when there
 * is nothing to correct: 25, 24 and 30 are already exact.
 */
export function exactFrameRate(
  fps: number | null | undefined,
  probed?: Partial<FrameRateFraction> | null,
): number {
  const fraction = frameRateFraction(fps, probed);
  if (fraction) return round(fraction.num / fraction.den);
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : 24;
}

/**
 * Frame number of an instant: the player's single conversion.
 *
 * Rounding, not flooring: the rate returned here stays approximate to a few millionths, and a
 * floor would turn that millionth into one frame less as soon as the product lands just below the
 * integer. Rounding only goes wrong beyond half a frame of accumulated gap, i.e. several hours of
 * media.
 */
export function frameAtTime(timeSec: number, fps: number): number {
  if (!Number.isFinite(timeSec) || timeSec <= 0 || !Number.isFinite(fps) || fps <= 0) return 0;
  return Math.round(timeSec * fps);
}
