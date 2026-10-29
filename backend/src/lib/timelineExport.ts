// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export of a timeline as a single file (Phase 45): PURE helpers, tested.
 *
 * Concatenating heterogeneous rushes first requires bringing them to a common format:
 * same resolution, same frame rate, same audio track. Without this normalization, `concat`
 * produces a file that desynchronizes or refuses to open as soon as two shots do not have
 * exactly the same profile, which is the normal case in production, where a Maya playblast
 * and a Nuke render never come out the same.
 */

/** Common export profile: what all segments must become before concatenation. */
export interface ExportProfile {
  width: number;
  height: number;
  fps: number;
}

/** Storage key of a timeline's master: deterministic, one timeline, one master. */
export function masterKey(timelineId: number): string {
  return `derived/timeline/${timelineId}/master.mp4`;
}

/**
 * Escapes a text for ffmpeg's `drawtext` filter. Shot codes contain characters that the
 * filter parser interprets (`:` separates options, `'` delimits), and a badly escaped code
 * makes the whole export fail.
 */
export function escapeDrawText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');
}

/**
 * A line of a `concat` list file. The path is quoted and apostrophes escaped according to
 * the syntax expected by the demuxer, which is not that of the shell.
 */
export function concatEntry(path: string): string {
  return `file '${path.replace(/'/g, "'\\''")}'`;
}

/** Complete list file for `ffmpeg -f concat`. */
export function concatList(paths: readonly string[]): string {
  return paths.map(concatEntry).join('\n') + '\n';
}

/** Normalization arguments of a segment towards the common profile. */
export function normalizeArgs(profile: ExportProfile): string[] {
  const { width, height, fps } = profile;
  return [
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},setsar=1`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    // Audio track enforced: a silent segment followed by a sound one breaks the
    // concatenation if the streams do not match one to one.
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
  ];
}

/** Synthetic sources of a placeholder: a black image and a silence of the same duration. */
export interface PlaceholderInputs {
  video: string;
  audio: string;
}

/** Inputs of a placeholder: silent black background, at the duration of the missing shot. */
export function placeholderInputs(profile: ExportProfile, duration: number): PlaceholderInputs {
  const safe = Math.max(0.5, Math.round(duration * 1000) / 1000);
  return {
    video: `color=c=black:s=${profile.width}x${profile.height}:r=${profile.fps}:d=${safe}`,
    audio: `anullsrc=channel_layout=stereo:sample_rate=48000:d=${safe}`,
  };
}

/** Text overlaid on a placeholder: the shot code, and why it is empty. */
export function placeholderFilter(profile: ExportProfile, shotCode: string, label: string): string {
  const size = Math.max(16, Math.round(profile.height / 18));
  const text = escapeDrawText(`${shotCode} — ${label}`);
  return `drawtext=text='${text}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=(h-text_h)/2`;
}
