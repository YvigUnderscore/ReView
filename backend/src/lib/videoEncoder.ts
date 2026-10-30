// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Video encoder of the worker (37.D): libx264 (default, CPU) or h264_nvenc (NVIDIA GPU, opt-in via
 * the VIDEO_ENCODER env variable). PURE helpers (tested): the worker falls back to libx264 if NVENC
 * encoding fails (no GPU exposed to the container).
 */

export type VideoEncoder = 'libx264' | 'h264_nvenc';

/** x264 presets → NVENC presets (p1 fast … p7 quality). */
const NVENC_PRESET: Record<string, string> = {
  ultrafast: 'p1',
  superfast: 'p2',
  veryfast: 'p3',
  faster: 'p4',
  fast: 'p4',
  medium: 'p5',
  slow: 'p6',
};

/** Codec options in constant-quality mode (MP4 proxy, client derivative). */
export function qualityEncoderArgs(encoder: VideoEncoder, crf: number, x264Preset: string): string[] {
  if (encoder === 'h264_nvenc') {
    return ['-c:v h264_nvenc', `-preset ${NVENC_PRESET[x264Preset] ?? 'p4'}`, `-cq ${crf}`];
  }
  return ['-c:v libx264', `-preset ${x264Preset}`, `-crf ${crf}`];
}

/**
 * Codec options in constrained-bitrate mode (HLS renditions). The fixed GOP remains handled by the
 * caller (-g/-keyint_min); scene-cut is disabled depending on the encoder.
 */
export function bitrateEncoderArgs(encoder: VideoEncoder, x264Preset: string): string[] {
  if (encoder === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[x264Preset] ?? 'p4', '-no-scenecut', '1'];
  }
  return ['-c:v', 'libx264', '-preset', x264Preset, '-sc_threshold', '0'];
}
