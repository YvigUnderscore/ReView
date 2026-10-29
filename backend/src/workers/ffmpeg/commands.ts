// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import ffmpeg from 'fluent-ffmpeg';
import { join } from 'node:path';
import { logger } from '../../lib/logger';
import { type TranscodeConfig } from '../../lib/transcodeConfig';
import { hlsGopSize, HLS_SEGMENT_SEC } from '../../lib/hls';
import { type TimelineSpritePlan } from '../../lib/timelineSprite';
import { WAVEFORM_SAMPLE_RATE } from '../../lib/audioWaveform';
import { parseSceneTimes, SCENE_THRESHOLD } from '../../lib/sceneDetect';
import {
  buildBurninFilters,
  buildSlateFilters,
  type BurninConfig,
  type BurninContext,
  type SlateInfo,
} from '../../lib/burnin';
import { env } from '../../config/env';
import { qualityEncoderArgs, bitrateEncoderArgs, type VideoEncoder } from '../../lib/videoEncoder';
import { FFPROBE_TIMEOUT_MS, FfmpegTimeoutError, isFfmpegTimeout } from '../../lib/ffmpegTimeout';
import { probeFile } from '../../lib/ffprobe';
import { audioOptionsFor, NO_TRAITS, preFiltersFor, type SourceTraits } from '../../lib/masterTraits';
import { imageDecodeInputOptions, webProxyOutputOptions, webProxyScaleFilter } from '../../lib/imageProxy';
import { ffmpegFraction } from '../../lib/mediaProgress';

/** Probes a media file and returns duration / dimensions / fps (bounded delay, see lib/ffprobe). */
export const probe = (path: string) => probeFile(path, FFPROBE_TIMEOUT_MS);

/**
 * Framing of an ffmpeg invocation: maximum delay, killing of the process, and progress reporting.
 *
 * Without a delay, a pathological file (exotic container, corrupt stream, filter that no longer advances) would **permanently** tie up one of the queue's two slots:
 * two such files would stop all the studio's transcoding, and nothing would signal it.
 */
export interface FfmpegRun {
  /** Step label, carried over as is into the failure message. */
  label: string;
  timeoutMs: number;
  /** Media duration, to interpolate when ffmpeg reports no percentage. */
  durationSec?: number;
  /** Progress 0→1 within the step. */
  onFraction?: (fraction: number) => void;
}

export function runFfmpeg(cmd: ffmpeg.FfmpegCommand, run: FfmpegRun): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // `kill` passes the signal to the child process: that is what frees the slot.
      try {
        cmd.kill('SIGKILL');
      } catch {
        // The process may already be dead: the failure of the signal changes nothing.
      }
      reject(new FfmpegTimeoutError(run.label, run.timeoutMs));
    }, run.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    if (run.onFraction)
      cmd.on('progress', (p: { percent?: number; timemark?: string }) => {
        const f = ffmpegFraction(p, run.durationSec);
        if (f !== null) run.onFraction?.(f);
      });

    cmd
      .on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      })
      .on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      })
      .run();
  });
}

/**
 * Generates a JPEG thumbnail. For video, the frame is captured at the **middle** (`seekSec`, typically duration/2 — more representative than a starting frame, often black);
 * for an image, no seek (direct resizing).
 *
 * `inputOptions` carries the decoding settings specific to the source format — the transfer curve of an EXR, in particular: without it, the thumbnail of a linear render is black.
 */
export function makeThumbnail(
  input: string,
  output: string,
  run: FfmpegRun,
  seekSec?: number,
  inputOptions: string[] = [],
): Promise<void> {
  const cmd = ffmpeg(input);
  if (inputOptions.length > 0) cmd.inputOptions(inputOptions);
  if (seekSec !== undefined && seekSec > 0) cmd.seekInput(seekSec);
  cmd.outputOptions(['-vframes 1', '-vf scale=640:-2']).output(output);
  return runFfmpeg(cmd, run);
}

/**
 * Full-resolution web proxy of an image the browser cannot decode (EXR, DPX, TIFF, TGA). It is this derivative — and not the original — that the review displays:
 * without it, the review page of an EXR is an empty frame (see `lib/imageProxy`).
 */
export function makeWebProxy(
  input: string,
  output: string,
  ext: string,
  size: { width: number; height: number },
  run: FfmpegRun,
): Promise<void> {
  const cmd = ffmpeg(input);
  const inputOptions = imageDecodeInputOptions(ext);
  if (inputOptions.length > 0) cmd.inputOptions(inputOptions);
  const scale = webProxyScaleFilter(size.width, size.height);
  if (scale) cmd.outputOptions(['-vf', scale]);
  cmd.outputOptions(webProxyOutputOptions()).output(output);
  return runFfmpeg(cmd, run);
}

/**
 * Extracts the first audio track as 8 kHz mono PCM — the raw material of the waveform.
 * The file does not leave the temporary directory: only the peaks are kept.
 */
export function extractAudioPcm(input: string, output: string, run: FfmpegRun): Promise<void> {
  const cmd = ffmpeg(input)
    .outputOptions(['-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-f', 's16le'])
    .output(output);
  return runFfmpeg(cmd, run);
}

/** Tiles the timeline thumbnails (1 frame per interval) into a single light JPEG. */
export function makeTimelineSprite(
  input: string,
  output: string,
  plan: TimelineSpritePlan,
  run: FfmpegRun,
): Promise<void> {
  const cmd = ffmpeg(input)
    .outputOptions([
      '-vf',
      `fps=1/${plan.intervalSec},scale=${plan.tileW}:${plan.tileH},tile=${plan.cols}x${plan.rows}`,
      '-frames:v',
      '1',
      '-q:v',
      '7',
    ])
    .output(output);
  return runFfmpeg(cmd, run);
}

/** Burn-ins resolved for a media: effective configuration + context + possible local logo. */
export interface BurninJob {
  cfg: BurninConfig;
  ctx: BurninContext;
  logoPath: string | null;
  slateInfo: SlateInfo | null;
}

/**
 * Applies the video chain (scale + any burn-ins) to a fluent-ffmpeg command.
 * Without a logo: a simple `-vf`. With a logo: a two-input `filter_complex` (the logo is added as an input and burnt in at the bottom right), output mapped to `[vout]` plus optional audio.
 */
export function applyVideoChain(
  cmd: ffmpeg.FfmpegCommand,
  scale: string,
  burnin: BurninJob | null,
  outHeight: number,
  preFilters: string[] = [],
): string[] {
  const extra = burnin ? buildBurninFilters(burnin.cfg, burnin.ctx, outHeight) : [];
  const chain = [...preFilters, scale, ...extra].join(',');
  if (!burnin?.logoPath || !burnin.cfg.enabled || !burnin.cfg.showLogo) {
    return ['-vf', chain];
  }
  const m = Math.max(8, Math.round(outHeight / 60));
  const logoH = Math.max(24, Math.round(outHeight / 10));
  cmd.input(burnin.logoPath);
  cmd.complexFilter(
    `[0:v]${chain}[base];[1:v]scale=-1:${logoH}[lg];` +
      `[base][lg]overlay=main_w-overlay_w-${m}:main_h-overlay_h-${m}[vout]`,
  );
  return ['-map', '[vout]', '-map', '0:a?'];
}

/**
 * Runs an encoding with the configured encoder (37.D); if NVENC fails (no GPU, missing drivers), automatically falls back to libx264.
 */
export async function withEncoderFallback(run: (encoder: VideoEncoder) => Promise<void>): Promise<void> {
  try {
    await run(env.VIDEO_ENCODER);
  } catch (err) {
    // A timeout is not an absent encoder: replaying in libx264 would consume the delay a second time to fail in the same way.
    if (env.VIDEO_ENCODER === 'libx264' || isFfmpegTimeout(err)) throw err;
    logger.warn({ err }, `[ffmpeg.worker] ${env.VIDEO_ENCODER} unavailable — falling back to libx264`);
    await run('libx264');
  }
}

/**
 * Proxy settings. An **object** rather than a series of positional arguments: the cut window occupied the fourth rank and the usual caller passed `undefined` there.
 * Removing it would have shifted four neighbouring arguments of compatible types — a shift that the typecheck would not have seen.
 */
export interface ProxyOptions {
  burnin?: BurninJob | null;
  /** Source height: the proxy never exceeds 1080 p, nor the source itself. */
  srcHeight?: number;
  encoder?: VideoEncoder;
  traits?: SourceTraits;
}

/** Transcodes a video into a web MP4 proxy (h264 + aac, faststart). */
export function transcodeProxy(
  input: string,
  output: string,
  run: FfmpegRun,
  { burnin, srcHeight, encoder = 'libx264', traits = NO_TRAITS }: ProxyOptions = {},
): Promise<void> {
  const cmd = ffmpeg(input);
  const proxyHeight = Math.min(1080, srcHeight && srcHeight > 0 ? srcHeight : 1080);
  const mapping = applyVideoChain(
    cmd,
    'scale=-2:min(1080\\,ih)',
    burnin ?? null,
    proxyHeight,
    preFiltersFor(traits),
  );
  cmd
    .outputOptions([
      ...qualityEncoderArgs(encoder, 23, 'veryfast'),
      '-pix_fmt yuv420p',
      '-c:a aac',
      ...audioOptionsFor(traits),
      '-movflags +faststart',
    ])
    .outputOptions(mapping)
    .output(output);
  return runFfmpeg(cmd, run);
}

/**
 * Generates an HLS rendition (VOD, .ts segments + sub-playlist) in `hlsDir` (Phase 23).
 * A **fixed** GOP aligned on the fps (one keyframe per segment, scene-cut disabled): without it, libx264 spaces keyframes up to ~10 s apart → huge segments,
 * very slow quality switching, and a frozen image while the audio carries on.
 */
export function transcodeHlsRendition(
  input: string,
  hlsDir: string,
  name: string,
  height: number,
  videoBitrateK: number,
  cfg: Pick<TranscodeConfig, 'preset' | 'audioBitrateK'>,
  run: FfmpegRun,
  fps?: number,
  burnin?: BurninJob | null,
  encoder: VideoEncoder = 'libx264',
  traits: SourceTraits = NO_TRAITS,
): Promise<void> {
  const gop = hlsGopSize(fps);
  const cmd = ffmpeg(input);
  const mapping = applyVideoChain(cmd, `scale=-2:${height}`, burnin ?? null, height, preFiltersFor(traits));
  cmd
    .outputOptions(mapping)
    .outputOptions(bitrateEncoderArgs(encoder, cfg.preset))
    .outputOptions(audioOptionsFor(traits))
    .outputOptions([
      '-b:v',
      `${videoBitrateK}k`,
      '-maxrate',
      `${Math.round(videoBitrateK * 1.07)}k`,
      '-bufsize',
      `${Math.round(videoBitrateK * 1.5)}k`,
      '-g',
      String(gop),
      '-keyint_min',
      String(gop),
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      `${cfg.audioBitrateK}k`,
      '-hls_time',
      String(HLS_SEGMENT_SEC),
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(hlsDir, `${name}_%03d.ts`),
    ])
    .output(join(hlsDir, `${name}.m3u8`));
  return runFfmpeg(cmd, run);
}

/**
 * Scene detection pass (34.H, admin opt-in): frames retained by `select(scene)`, listed by showinfo on stderr. Best effort — a failure returns an empty list.
 */
export async function detectScenes(input: string, run: FfmpegRun): Promise<number[]> {
  let err = '';
  const cmd = ffmpeg(input)
    .outputOptions(['-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-an', '-f', 'null'])
    .output('/dev/null')
    .on('stderr', (line: string) => {
      err += line + '\n';
    });
  try {
    await runFfmpeg(cmd, run);
  } catch {
    // Best effort, delay included: a detection that fails or drags on costs only automatic markers; it does not condemn the transcoding.
    return [];
  }
  return parseSceneTimes(err);
}

/** Duration of the identification slate at the head of the client derivative (35.A). */
export const SLATE_SEC = 3;

/** Renders the slate image (dark background + centred lines) at the proxy's dimensions. */
export function makeSlateImage(
  output: string,
  width: number,
  height: number,
  lines: string[],
  run: FfmpegRun,
): Promise<void> {
  const cmd = ffmpeg()
    .input(`color=c=0x0b0f14:s=${width}x${height}`)
    .inputFormat('lavfi')
    .outputOptions(['-vf', buildSlateFilters(lines, height).join(','), '-frames:v', '1'])
    .output(output);
  return runFfmpeg(cmd, run);
}

/**
 * Client derivative (35.A): a slate of `SLATE_SEC` s concatenated at the head of the proxy — served only through client shares (the review proxy stays intact: a slate at
 * the head would shift every frame-by-frame annotation).
 */
export function buildClientDerivative(
  slatePng: string,
  proxyPath: string,
  output: string,
  opts: { width: number; height: number; fps: number; hasAudio: boolean },
  run: FfmpegRun,
  encoder: VideoEncoder = 'libx264',
): Promise<void> {
  const { width, height, fps, hasAudio } = opts;
  const slateV = `[0:v]fps=${fps},scale=${width}:${height},setsar=1,format=yuv420p[sv]`;
  const cmd = ffmpeg()
    .input(slatePng)
    .inputOptions(['-loop 1', `-t ${SLATE_SEC}`]);
  if (hasAudio) {
    cmd
      .input('anullsrc=r=48000:cl=stereo')
      .inputFormat('lavfi')
      .inputOptions([`-t ${SLATE_SEC}`])
      .input(proxyPath)
      .complexFilter(`${slateV};[2:v]setsar=1[pv];[sv][1:a][pv][2:a]concat=n=2:v=1:a=1[v][a]`)
      .outputOptions(['-map', '[v]', '-map', '[a]', '-c:a', 'aac']);
  } else {
    cmd
      .input(proxyPath)
      .complexFilter(`${slateV};[1:v]setsar=1[pv];[sv][pv]concat=n=2:v=1:a=0[v]`)
      .outputOptions(['-map', '[v]']);
  }
  cmd
    .outputOptions([
      ...qualityEncoderArgs(encoder, 23, 'veryfast'),
      '-pix_fmt yuv420p',
      '-movflags +faststart',
    ])
    .output(output);
  return runFfmpeg(cmd, run);
}
