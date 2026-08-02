// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Encodeur vidéo du worker (37.D) : libx264 (défaut, CPU) ou h264_nvenc (GPU NVIDIA,
 * opt-in via env VIDEO_ENCODER). Helpers PURS (testés) — le worker retombe sur libx264
 * si l'encodage NVENC échoue (pas de GPU exposé au conteneur).
 */

export type VideoEncoder = 'libx264' | 'h264_nvenc';

/** Presets x264 → presets NVENC (p1 rapide … p7 qualité). */
const NVENC_PRESET: Record<string, string> = {
  ultrafast: 'p1',
  superfast: 'p2',
  veryfast: 'p3',
  faster: 'p4',
  fast: 'p4',
  medium: 'p5',
  slow: 'p6',
};

/** Options codec en mode qualité constante (proxy MP4, dérivé client). */
export function qualityEncoderArgs(encoder: VideoEncoder, crf: number, x264Preset: string): string[] {
  if (encoder === 'h264_nvenc') {
    return ['-c:v h264_nvenc', `-preset ${NVENC_PRESET[x264Preset] ?? 'p4'}`, `-cq ${crf}`];
  }
  return ['-c:v libx264', `-preset ${x264Preset}`, `-crf ${crf}`];
}

/**
 * Options codec en mode débit contraint (renditions HLS). Le GOP fixe reste géré par
 * l'appelant (-g/-keyint_min) ; le scene-cut est désactivé selon l'encodeur.
 */
export function bitrateEncoderArgs(encoder: VideoEncoder, x264Preset: string): string[] {
  if (encoder === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESET[x264Preset] ?? 'p4', '-no-scenecut', '1'];
  }
  return ['-c:v', 'libx264', '-preset', x264Preset, '-sc_threshold', '0'];
}
