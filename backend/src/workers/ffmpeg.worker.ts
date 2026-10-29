// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker, type Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';

import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type MediaJobData } from '../services/JobService';
import { prisma } from '../lib/prisma';
import { storage, StorageService } from '../services/StorageService';
import { MediaStatus, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { getTranscodeConfig, selectRenditions, type TranscodeConfig } from '../lib/transcodeConfig';
import {
  buildMasterPlaylist,
  hlsContentType,
  hlsGopSize,
  HLS_SEGMENT_SEC,
  renditionName,
  type HlsRendition,
} from '../lib/hls';
import { planTimelineSprite, type TimelineSpritePlan } from '../lib/timelineSprite';
import { planWaveformBins, waveformFromPcmFile, WAVEFORM_SAMPLE_RATE } from '../lib/audioWaveform';
import { parseSceneTimes, sceneFrames, SCENE_THRESHOLD } from '../lib/sceneDetect';
import { publishWorkerEvent } from '../lib/workerEvents';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import {
  buildBurninFilters,
  buildSlateFilters,
  buildSlateLines,
  resolveBurninConfig,
  type BurninConfig,
  type BurninContext,
  type SlateInfo,
} from '../lib/burnin';
import { SETTING_KEYS } from '../lib/settings';
import { env } from '../config/env';
import { qualityEncoderArgs, bitrateEncoderArgs, type VideoEncoder } from '../lib/videoEncoder';
import { sha256File } from '../lib/checksum';
import { isClamavEnabled, scanFile } from '../lib/clamav';
import { logAudit } from '../services/AuditService';
import { sourceFormatLabel } from '../lib/modelConvert';
import { convertToGlb, DEFAULT_USD_REQUEST, type UsdRequest } from '../services/ModelConvertService';
import { startStorageCleanupWorker } from './storageCleanup.worker';
import { startWebhookWorker } from './webhook.worker';
import { startShotgridWorker } from './shotgrid.worker';
import { startTimelineExportWorker } from './timelineExport.worker';
import { startMaintenanceWorker } from './maintenance.worker';
import { startSpatialThumbWorker } from './spatialThumb.worker';
import { startOcioBakeWorker } from './ocio/bake.worker';
import { registerWorkerShutdown } from './shutdown';
import {
  FFPROBE_TIMEOUT_MS,
  FfmpegTimeoutError,
  ffmpegTimeoutMs,
  isFfmpegTimeout,
} from '../lib/ffmpegTimeout';
import { probeFile } from '../lib/ffprobe';
import {
  audioOptionsFor,
  NO_TRAITS,
  preFiltersFor,
  sourceTraits,
  type SourceTraits,
} from '../lib/masterTraits';
import {
  imageDecodeInputOptions,
  needsWebProxy,
  webProxyKey,
  webProxyOutputOptions,
  webProxyScaleFilter,
  WEB_PROXY_CONTENT_TYPE,
} from '../lib/imageProxy';
import {
  localFrameName,
  localFramePattern,
  parseFrameName,
  sequenceInputOptions,
  sequenceMasterOutputOptions,
  SEQUENCE_MASTER_CRF,
  SEQUENCE_MASTER_FILENAME,
  SEQUENCE_MASTER_SCALE,
} from '../lib/imageSequence';
import {
  ffmpegFraction,
  mediaJobProgress,
  type MediaJobProgress,
  type MediaJobStep,
} from '../lib/mediaProgress';
import { installShutdownHandlers, registerShutdownTask, SHUTDOWN_PHASE } from '../lib/gracefulShutdown';
import { closeWorkerEvents } from '../lib/workerEvents';
import { startWorkerMetricsServer, attachWorkerMetrics } from './metricsServer';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Media processing worker (FFmpeg) — BullMQ.
 *
 * Flow: downloads the object from MinIO to a temporary directory, processes it with FFmpeg, pushes the derivatives back to MinIO, updates MediaObject (status, thumbnailKey,
 * metadata), then cleans up the temporary directory. No file persists on the app server.
 *
 *  - thumbnail: JPEG thumbnail (resizing for images; video captures the middle frame)
 *  - transcode: probe (ffprobe) + MP4 proxy (h264/aac, faststart) + thumbnail
 *  - convert3d: conversion of FBX/OBJ/USD... to GLB (see services/ModelConvertService, 9.A1 then 45.C)
 *
 * Run as a separate process: `node dist/workers/ffmpeg.worker.js` (the `worker` service of the compose file).
 */

/** Probes a media file and returns duration / dimensions / fps (bounded delay, see lib/ffprobe). */
const probe = (path: string) => probeFile(path, FFPROBE_TIMEOUT_MS);

/**
 * Framing of an ffmpeg invocation: maximum delay, killing of the process, and progress reporting.
 *
 * Without a delay, a pathological file (exotic container, corrupt stream, filter that no longer advances) would **permanently** tie up one of the queue's two slots:
 * two such files would stop all the studio's transcoding, and nothing would signal it.
 */
interface FfmpegRun {
  /** Step label, carried over as is into the failure message. */
  label: string;
  timeoutMs: number;
  /** Media duration, to interpolate when ffmpeg reports no percentage. */
  durationSec?: number;
  /** Progress 0→1 within the step. */
  onFraction?: (fraction: number) => void;
}

function runFfmpeg(cmd: ffmpeg.FfmpegCommand, run: FfmpegRun): Promise<void> {
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
function makeThumbnail(
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
function makeWebProxy(
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
function extractAudioPcm(input: string, output: string, run: FfmpegRun): Promise<void> {
  const cmd = ffmpeg(input)
    .outputOptions(['-vn', '-map', '0:a:0', '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-f', 's16le'])
    .output(output);
  return runFfmpeg(cmd, run);
}

/** Tiles the timeline thumbnails (1 frame per interval) into a single light JPEG. */
function makeTimelineSprite(
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

/**
 * Publishes the progress on the BullMQ job.
 *
 * Without it, administration sees only an "active" job: a six-hour encoding and an ffmpeg blocked for six hours look exactly alike. We therefore publish the current step
 * (probe, proxy, rendition n/N, sprite, thumbnail...) and its advancement. The write only goes out if the percentage has moved: at most a hundred per job.
 */
type ProgressReporter = (
  step: MediaJobStep,
  opts?: { index?: number; total?: number; fraction?: number },
) => void;

function progressReporter(job: Job<MediaJobData>): ProgressReporter {
  let last = -1;
  return (step, opts) => {
    const progress: MediaJobProgress = mediaJobProgress(job.data.kind, step, opts);
    if (progress.percent === last) return;
    last = progress.percent;
    // Best effort: a lost progress write must never make the transcoding it describes fail.
    void job.updateProgress(progress).catch((err: unknown) => {
      logger.debug({ err }, '[ffmpeg.worker] progression non publiée');
    });
  };
}

/** Burn-ins resolved for a media: effective configuration + context + possible local logo. */
interface BurninJob {
  cfg: BurninConfig;
  ctx: BurninContext;
  logoPath: string | null;
  slateInfo: SlateInfo | null;
}

/**
 * Applies the video chain (scale + any burn-ins) to a fluent-ffmpeg command.
 * Without a logo: a simple `-vf`. With a logo: a two-input `filter_complex` (the logo is added as an input and burnt in at the bottom right), output mapped to `[vout]` plus optional audio.
 */
function applyVideoChain(
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
async function withEncoderFallback(run: (encoder: VideoEncoder) => Promise<void>): Promise<void> {
  try {
    await run(env.VIDEO_ENCODER);
  } catch (err) {
    // A timeout is not an absent encoder: replaying in libx264 would consume the delay a second time to fail in the same way.
    if (env.VIDEO_ENCODER === 'libx264' || isFfmpegTimeout(err)) throw err;
    logger.warn({ err }, `[ffmpeg.worker] ${env.VIDEO_ENCODER} indisponible — repli libx264`);
    await run('libx264');
  }
}

/**
 * Proxy settings. An **object** rather than a series of positional arguments: the cut window occupied the fourth rank and the usual caller passed `undefined` there.
 * Removing it would have shifted four neighbouring arguments of compatible types — a shift that the typecheck would not have seen.
 */
interface ProxyOptions {
  burnin?: BurninJob | null;
  /** Source height: the proxy never exceeds 1080 p, nor the source itself. */
  srcHeight?: number;
  encoder?: VideoEncoder;
  traits?: SourceTraits;
}

/** Transcodes a video into a web MP4 proxy (h264 + aac, faststart). */
function transcodeProxy(
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
function transcodeHlsRendition(
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
async function detectScenes(input: string, run: FfmpegRun): Promise<number[]> {
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

/** Places the "Shot n" markers (replaces the previous automatic markers of the media). */
async function writeSceneMarkers(mediaId: number, frames: number[]): Promise<void> {
  await prisma.timelineMarker.deleteMany({
    where: { mediaObjectId: mediaId, authorId: null, name: { startsWith: 'Plan ' } },
  });
  if (frames.length === 0) return;
  await prisma.timelineMarker.createMany({
    // Cut i opens shot i+2 (shot 1 starts at frame 0, with no marker).
    data: frames.map((frame, i) => ({
      mediaObjectId: mediaId,
      frame,
      name: `Plan ${i + 2}`,
      color: '#64748b',
      authorId: null,
    })),
  });
  await publishWorkerEvent({ type: 'markers', mediaId });
}

/** Duration of the identification slate at the head of the client derivative (35.A). */
const SLATE_SEC = 3;

/**
 * Resolves the effective burn-in configuration of the media's project + the overlay context (shot/version) and downloads the studio logo if needed.
 * `null` if everything is inactive.
 */
async function loadBurninSetup(
  mediaId: number,
  versionId: number,
  originalName: string,
  dir: string,
): Promise<BurninJob | null> {
  const projSel = { select: { name: true, settings: true } };
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: {
      name: true,
      author: { select: { name: true } },
      task: {
        select: {
          shot: {
            select: { code: true, sequence: { select: { code: true } }, project: projSel },
          },
          asset: { select: { name: true, project: projSel } },
        },
      },
      asset: { select: { name: true, project: projSel } },
    },
  });
  if (!version) return null;
  const shot = version.task?.shot ?? null;
  const asset = version.task?.asset ?? version.asset ?? null;
  const project = shot?.project ?? asset?.project ?? null;
  const cfg = await resolveBurninConfig(project?.settings ?? null);
  if (!cfg.enabled && !cfg.slate) return null;

  const shotLabel = shot
    ? shot.sequence
      ? `${shot.sequence.code} · ${shot.code}`
      : shot.code
    : (asset?.name ?? null);
  const ctx: BurninContext = { shotLabel, versionLabel: version.name, fps: null };

  let logoPath: string | null = null;
  if (cfg.enabled && cfg.showLogo) {
    const logo = await prisma.setting.findUnique({ where: { key: SETTING_KEYS.STUDIO_LOGO } });
    if (logo?.value) {
      try {
        logoPath = join(dir, `logo${extname(logo.value) || '.png'}`);
        await storage.downloadToFile(logo.value, logoPath);
      } catch (err) {
        logger.warn({ err }, `[ffmpeg.worker] logo burn-in indisponible media=${mediaId}`);
        logoPath = null;
      }
    }
  }

  let slateInfo: SlateInfo | null = null;
  if (cfg.slate) {
    const studio = await prisma.studio.findFirst({ select: { name: true } });
    slateInfo = {
      studioName: studio?.name ?? 'ReView',
      projectName: project?.name ?? null,
      shotLabel,
      versionLabel: version.name,
      authorName: version.author?.name ?? null,
      fileName: originalName,
      date: new Date().toISOString().slice(0, 10),
    };
  }
  return { cfg, ctx, logoPath, slateInfo };
}

/** Renders the slate image (dark background + centred lines) at the proxy's dimensions. */
function makeSlateImage(
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
function buildClientDerivative(
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

type HlsRenditionMeta = { height: number; width: number; videoBitrateK: number };

/**
 * Produces the adaptive HLS ladder (renditions + master.m3u8) and pushes it into MinIO under `derived/{id}/hls/`. **Progressive (34.F)**: `selectRenditions` returns the
 * lowest first — each rendition is uploaded as soon as it is ready, the master is regenerated each time, and `onRendition` lets the caller open playback at the first one.
 * Returns the renditions produced (metadata) or `[]` if disabled.
 */
async function buildHls(
  input: string,
  dir: string,
  mediaId: number,
  cfg: TranscodeConfig,
  srcWidth: number,
  srcHeight: number,
  progress: { timeoutMs: number; durationSec?: number; report: ProgressReporter },
  srcFps?: number,
  onRendition?: (renditions: HlsRenditionMeta[], building: boolean) => Promise<void>,
  burnin?: BurninJob | null,
  traits: SourceTraits = NO_TRAITS,
): Promise<HlsRenditionMeta[]> {
  const hlsDir = join(dir, 'hls');
  await mkdir(hlsDir, { recursive: true });
  const built: HlsRendition[] = [];
  const metas = () =>
    built.map((b) => ({ height: b.height, width: b.width, videoBitrateK: b.videoBitrateK }));
  const todo = selectRenditions(cfg, srcHeight);
  for (const [i, r] of todo.entries()) {
    const name = renditionName(r.height);
    progress.report('renditions', { index: i, total: todo.length });
    await withEncoderFallback((encoder) =>
      transcodeHlsRendition(
        input,
        hlsDir,
        name,
        r.height,
        r.videoBitrateK,
        cfg,
        {
          label: `hls ${name}`,
          timeoutMs: progress.timeoutMs,
          durationSec: progress.durationSec,
          onFraction: (fraction) => progress.report('renditions', { index: i, total: todo.length, fraction }),
        },
        srcFps,
        burnin,
        encoder,
        traits,
      ),
    );
    const width =
      srcWidth > 0 && srcHeight > 0
        ? Math.round(((srcWidth / srcHeight) * r.height) / 2) * 2
        : Math.round(((16 / 9) * r.height) / 2) * 2;
    built.push({
      height: r.height,
      width,
      videoBitrateK: r.videoBitrateK,
      audioBitrateK: cfg.audioBitrateK,
      playlist: `${name}.m3u8`,
    });
    // Upload of the rendition (segments + sub-playlist), then the master regenerated: the online master never references a missing rendition.
    await writeFile(join(hlsDir, 'master.m3u8'), buildMasterPlaylist(built));
    for (const f of (await readdir(hlsDir)).filter((f) => f === `${name}.m3u8` || f.startsWith(`${name}_`))) {
      await storage.uploadFile(`derived/${mediaId}/hls/${f}`, join(hlsDir, f), hlsContentType(f));
    }
    await storage.uploadFile(
      `derived/${mediaId}/hls/master.m3u8`,
      join(hlsDir, 'master.m3u8'),
      hlsContentType('master.m3u8'),
    );
    await onRendition?.(metas(), i < todo.length - 1);
  }
  return metas();
}

/* ── Image sequences: N frames → one master, then the ordinary video chain ────── */

/** Frames fetched in parallel. Beyond this, MinIO and the worker's disk get in each other's way. */
const FRAME_DOWNLOAD_CONCURRENCY = 4;

/** Applies `task` with at most `limit` simultaneous tasks, index preserved. */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const lane = async (): Promise<void> => {
    for (let i = cursor++; i < items.length; i = cursor++) await task(items[i]!, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * Antivirus scan of a sequence: **all** the frames, one by one.
 *
 * The check is opt-in (`CLAMAV_HOST`): a studio that enables it asks that nothing enter unscanned, and sampling only three frames out of a thousand would be theatre.
 * A detection fails the job with the name of the threat, and the frames stay under their prefix — the decision to destroy them belongs to administration.
 */
async function scanSequenceFrames(framesDir: string, count: number, extension: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    const scan = await scanFile(join(framesDir, localFrameName(i, extension)));
    if (!scan.clean) throw new Error(`Infected frame in the image sequence (${scan.virus ?? 'unknown'})`);
  }
}

/**
 * Assembles the sequence into a single master, the input of everything downstream.
 *
 * Two decisions underpin this code. The first: **renumber the frames locally** as 0, 1, 2... FFmpeg's `image2` demuxer stops at the first missing frame; a delivery with
 * holes — a render relaunched on a few frames, a daily occurrence — would output a truncated shot without a word. The original numbering is kept in the manifest and in
 * `metadata.startFrame`, which is what the player displays.
 *
 * The second: produce a master rather than attacking the sequence on every pass. The proxy, each HLS rendition, the sprite and the thumbnail all re-read the source;
 * decoding two thousand 4K EXRs five times would cost hours of CPU per shot. The master is decoded once, at CRF 12 — well above what the derivatives will draw from it.
 */
async function buildSequenceMaster(
  mediaId: number,
  sequence: { storagePrefix: string; extension: string; framerate: number },
  dir: string,
  output: string,
  report: ProgressReporter,
): Promise<void> {
  const framesDir = join(dir, 'frames');
  await mkdir(framesDir, { recursive: true });

  const frames: { name: string; frame: number }[] = [];
  for await (const object of storage.iterateObjects(sequence.storagePrefix)) {
    if (object.size === 0) continue;
    const name = object.key.slice(sequence.storagePrefix.length);
    const parsed = parseFrameName(name);
    if (parsed) frames.push({ name, frame: parsed.number });
  }
  if (frames.length === 0)
    throw new Error(`No frame found under ${sequence.storagePrefix} (media=${String(mediaId)})`);
  frames.sort((a, b) => a.frame - b.frame);

  // Fetching occupies the first half of the "download" step, the assembly the second: `lib/mediaProgress` has no step of its own for the sequence, and inventing one
  // would shift the scale of all the other jobs.
  let downloaded = 0;
  await withConcurrency(frames, FRAME_DOWNLOAD_CONCURRENCY, async (entry, index) => {
    await storage.downloadToFile(
      `${sequence.storagePrefix}${entry.name}`,
      join(framesDir, localFrameName(index, sequence.extension)),
    );
    downloaded += 1;
    report('download', { fraction: (downloaded / frames.length) * 0.5 });
  });

  if (isClamavEnabled()) await scanSequenceFrames(framesDir, frames.length, sequence.extension);

  const durationSec = frames.length / Math.max(sequence.framerate, 1);
  await withEncoderFallback((encoder) => {
    const cmd = ffmpeg(join(framesDir, localFramePattern(sequence.extension)))
      .inputOptions(sequenceInputOptions(sequence.framerate, sequence.extension))
      .outputOptions(['-vf', SEQUENCE_MASTER_SCALE])
      .outputOptions(qualityEncoderArgs(encoder, SEQUENCE_MASTER_CRF, 'veryfast'))
      .outputOptions(sequenceMasterOutputOptions())
      .output(output);
    return runFfmpeg(cmd, {
      label: 'sequence master',
      // Decoding EXR is far from real time: the usual factor (×20) would cut a perfectly healthy assembly on a slightly long shot.
      timeoutMs: ffmpegTimeoutMs(durationSec, { factor: 60 }),
      durationSec,
      onFraction: (fraction) => report('download', { fraction: 0.5 + fraction * 0.5 }),
    });
  });
}

async function handle(mediaId: number, kind: MediaJobData['kind'], report: ProgressReporter): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    include: { imageSequence: true },
  });
  if (!media) throw new Error(`MediaObject ${mediaId} not found`);

  const dir = await mkdtemp(join(tmpdir(), 'review-'));
  try {
    report('download');
    const metadata: Record<string, unknown> = { ...(media.metadata as object) };
    // Image sequence (wave 5): the "source" is not an object but N frames under a prefix. They are fetched, scanned, then assembled into a master — all downstream
    // works then on an ordinary video, without knowing where it came from. A `reprocess` always starts again from the frames, never from the proxy: unlike a video, the
    // original deliverable is always there.
    const sequence = media.imageSequence;
    // Source video deleted after transcoding (space saving): a `reprocess` starts again from the MP4 proxy — the only "source" file remaining.
    const sourceGone = !sequence && metadata.sourceDeleted === true && typeof metadata.proxyKey === 'string';
    // Keep the original extension (assimp/ffmpeg detect the format by extension)
    const ext = sourceGone ? '.mp4' : extname(media.originalName) || '.bin';
    const src = sequence ? join(dir, SEQUENCE_MASTER_FILENAME) : join(dir, `src${ext}`);
    if (sequence) await buildSequenceMaster(mediaId, sequence, dir, src, report);
    else await storage.downloadToFile(sourceGone ? (metadata.proxyKey as string) : media.storageKey, src);

    // End-to-end checksum (37.B): the sha256 announced by the client must match the downloaded file (network/storage corruption → FAILED, never false derivatives).
    if (!sequence && !sourceGone && typeof metadata.contentHash === 'string') {
      const actual = await sha256File(src);
      if (actual !== metadata.contentHash) {
        throw new Error(
          `Checksum invalide media=${mediaId} (attendu ${String(metadata.contentHash).slice(0, 12)}…, reçu ${actual.slice(0, 12)}…)`,
        );
      }
    }

    // The date of the antivirus verdict, when there has been one: it serves further down to mark the media, and its absence to NOT mark it.
    let scannedAt: string | undefined;
    // Opt-in antivirus scan (37.E): infected file → object moved to quarantine, media FAILED. clamd unreachable = error (BullMQ retry) — we do not publish without a scan.
    // A sequence has already been scanned frame by frame during its assembly: the master we hold here is our own output, the scanner would prove nothing.
    if (isClamavEnabled() && !sourceGone && !sequence) {
      const scan = await scanFile(src);
      // An unscanned media must not pass itself off as a scanned and clean one: the mark is carried by the media itself, not by the existence of a job.
      if (scan.clean) {
        scannedAt = new Date().toISOString();
        metadata.scannedAt = scannedAt;
      }
      if (!scan.clean) {
        const quarantineKey = `quarantine/${mediaId}/${media.originalName}`;
        await storage
          .copyObject(media.storageKey, quarantineKey)
          .catch(ignoreFailure('[ffmpeg] quarantine copy failed', { mediaId }));
        await storage
          .deleteObject(media.storageKey)
          .catch(ignoreFailure('[ffmpeg] infected original delete failed', { mediaId }));
        await prisma.mediaObject.update({
          where: { id: mediaId },
          data: {
            status: MediaStatus.FAILED,
            metadata: { ...metadata, quarantined: scan.virus, quarantineKey },
          },
        });
        logAudit({
          action: 'MEDIA_QUARANTINED',
          entityType: 'MediaObject',
          entityId: mediaId,
          metadata: { virus: scan.virus, uploaderId: media.uploaderId },
        });
        logger.warn(`[ffmpeg.worker] média ${mediaId} en quarantaine (${scan.virus})`);
        return;
      }
    }

    if (kind === 'scan') {
      // Antivirus alone (37.E): the preamble above has already scanned/quarantined.
      report('scan', { fraction: 1 });
      // This media is READY and downloadable SINCE finalization: this is the only path where the scan conditions nothing. Without a written trace, a GLB or a splat never
      // scanned (clamd restarted during the upload window) is indistinguishable from a scanned and clean media — for the operator as for the SQL query. We therefore write the
      // verdict, and clear the failure of a previous attempt that this one has just caught up with. Nothing to write if the antivirus was switched off between enqueuing and
      // processing: this media is not scanned, and claiming otherwise would be worse than silence.
      if (scannedAt) await recordScanOutcome(mediaId, { scannedAt });
      return;
    }

    if (kind === 'convert3d') {
      report('convert');
      // Conversion → GLB for the Three.js viewer (fixes the DataView error on raw FBX/OBJ)
      const glbPath = join(dir, 'model.glb');
      // USD recomposition requested by the user (45.E): it lives in the metadata, so it survives BullMQ retries and later `reprocess` runs.
      const request = (metadata.usdRequest as UsdRequest | undefined) ?? DEFAULT_USD_REQUEST;
      const result = await convertToGlb(src, glbPath, ext, {
        archiveName: media.originalName,
        request,
      });
      const glbKey = `derived/${mediaId}/model.glb`;
      await storage.uploadFile(glbKey, glbPath, 'model/gltf-binary');
      metadata.glbKey = glbKey;
      // Conversion provenance (39.A, extended 45.C): source format, converter and, for
      // USD, the scene description (root layer, variants, missing assets).
      metadata.model = {
        sourceFormat: sourceFormatLabel(ext),
        converter: result.converter,
        native: result.converter === 'usd' || result.converter === 'blender',
        ...(result.usd ? { usd: result.usd } : {}),
        ...(result.blender ? { blender: result.blender } : {}),
      };
      delete metadata.processingError;
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { status: MediaStatus.READY, metadata: metadata as Prisma.InputJsonObject },
      });
    } else if (kind === 'transcode') {
      // Probe + proxy + thumbnail for the video.
      //
      // The probe now records **two** forms of the frame rate: `fps`, rounded to the hundredth
      // (historical value, still read by everything that already exists), and `fpsNum`/`fpsDen`, the
      // exact fraction of the container. 23.98 drifts by a whole frame after four
      // minutes; 24000/1001 never drifts. Media already in the database keep their only
      // `fps`: the player can recover the broadcast rate from it (see `frameRate.ts`).
      report('probe');
      Object.assign(metadata, await probe(src));
      if (sequence) {
        // The original numbering (1001 → 1200) is what the artist and the supervisor
        // cite in a review: the player must find it again, not the project's frame base.
        // `metadata.sequence` describes the delivery — pattern, bounds, gaps — so that
        // the review can say where the image it displays comes from.
        metadata.startFrame = sequence.startFrame;
        metadata.sequence = {
          pattern: sequence.pattern,
          extension: sequence.extension,
          startFrame: sequence.startFrame,
          endFrame: sequence.endFrame,
          frameCount: sequence.frameCount,
          missingFrames: sequence.endFrame - sequence.startFrame + 1 - sequence.frameCount,
          framerate: sequence.framerate,
        };
      }
      // Every command of this job is bounded by the probed duration of the media: a pass that greatly exceeds it no longer progresses, it loops.
      const durationSec = typeof metadata.duration === 'number' ? metadata.duration : undefined;
      const timeoutMs = ffmpegTimeoutMs(durationSec);
      // Post-production masters (MXF, AVI, ProRes in MOV): deinterlacing and downmix decided here, once, and applied identically to the proxy and to the HLS ladder.
      const traits = sourceTraits(metadata);

      // Configurable burn-ins (35.A): the project's effective configuration + shot/version context.
      // Best effort — a resolution failure does not condemn the transcoding.
      const burnin = await loadBurninSetup(mediaId, media.versionId, media.originalName, dir).catch((err) => {
        logger.warn({ err }, `[ffmpeg.worker] burn-ins non résolus media=${mediaId}`);
        return null;
      });
      if (burnin) burnin.ctx.fps = typeof metadata.fps === 'number' ? metadata.fps : null;

      const proxyPath = join(dir, 'proxy.mp4');
      report('proxy');
      await withEncoderFallback((encoder) =>
        transcodeProxy(
          src,
          proxyPath,
          {
            label: 'proxy',
            timeoutMs,
            durationSec,
            onFraction: (fraction) => report('proxy', { fraction }),
          },
          {
            burnin,
            srcHeight: typeof metadata.height === 'number' ? metadata.height : undefined,
            encoder,
            traits,
          },
        ),
      );
      const proxyKey = `derived/${mediaId}/proxy.mp4`;
      await storage.uploadFile(proxyKey, proxyPath, 'video/mp4');
      metadata.proxyKey = proxyKey;

      const thumbPath = join(dir, 'thumb.jpg');
      // Frame at the middle of the video (duration/2) — falls back to 1 s if the duration is unknown.
      const midSec =
        typeof metadata.duration === 'number' && metadata.duration > 0 ? metadata.duration / 2 : 1;
      report('thumbnail');
      await makeThumbnail(src, thumbPath, { label: 'thumbnail', timeoutMs }, midSec);
      const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
      await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');

      // Adaptive HLS (Phase 23): multi-rendition ladder + master, if enabled and the height is known.
      // Progressive (34.F): the media becomes READY as soon as the FIRST rendition is out (playback possible
      // while the higher qualities transcode); each rendition updates metadata.hls (`building` flag) and publishes an event relayed over the socket to the review.
      const tcfg = await getTranscodeConfig();
      const srcHeight = typeof metadata.height === 'number' ? metadata.height : 0;
      const srcWidth = typeof metadata.width === 'number' ? metadata.width : 0;
      if (tcfg.enabled && srcHeight > 0) {
        const srcFps = typeof metadata.fps === 'number' ? metadata.fps : undefined;
        const projectId = await resolveProjectIdForVersion(media.versionId);
        let readyPosted = false;
        const renditions = await buildHls(
          src,
          dir,
          mediaId,
          tcfg,
          srcWidth,
          srcHeight,
          { timeoutMs, durationSec, report },
          srcFps,
          async (soFar, building) => {
            metadata.hls = building ? { renditions: soFar, building: true } : { renditions: soFar };
            await prisma.mediaObject.update({
              where: { id: mediaId },
              data: readyPosted
                ? { metadata: metadata as Prisma.InputJsonObject }
                : {
                    status: MediaStatus.READY,
                    thumbnailKey: thumbKey,
                    metadata: metadata as Prisma.InputJsonObject,
                  },
            });
            readyPosted = true;
            await publishWorkerEvent({
              type: 'hls',
              mediaId,
              versionId: media.versionId,
              projectId,
              renditions: soFar.length,
              building,
            });
          },
          burnin,
          traits,
        );
        metadata.hls = { renditions };
      }

      // Slate + client derivative (35.A, best effort): identification slate concatenated at the head of the proxy → `derived/{id}/client.mp4`, served only through shares.
      if (burnin?.slateInfo) {
        report('client');
        try {
          const p = await probe(proxyPath);
          const pw = p.width ?? 0;
          const ph = p.height ?? 0;
          if (pw > 0 && ph > 0) {
            const slatePng = join(dir, 'slate.png');
            await makeSlateImage(slatePng, pw, ph, buildSlateLines(burnin.slateInfo), {
              label: 'slate',
              timeoutMs,
            });
            const clientPath = join(dir, 'client.mp4');
            await withEncoderFallback((encoder) =>
              buildClientDerivative(
                slatePng,
                proxyPath,
                clientPath,
                {
                  width: pw,
                  height: ph,
                  fps: Math.min(Math.max(Math.round(p.fps ?? 24), 1), 240),
                  hasAudio: p.hasAudio === true,
                },
                {
                  label: 'client derivative',
                  timeoutMs,
                  durationSec,
                  onFraction: (fraction) => report('client', { fraction }),
                },
                encoder,
              ),
            );
            const clientKey = `derived/${mediaId}/client.mp4`;
            await storage.uploadFile(clientKey, clientPath, 'video/mp4');
            metadata.clientProxyKey = clientKey;
            metadata.slateSec = SLATE_SEC;
          }
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] slate/dérivé client échoué media=${mediaId}`);
        }
      }

      // Scene detection (34.H, admin opt-in): automatic "Shot n" markers at the cuts —
      // best effort, after playback has been opened (READY already set by the first rendition).
      if (tcfg.sceneDetection) {
        report('scenes');
        try {
          const fps = typeof metadata.fps === 'number' ? metadata.fps : 24;
          const scenes = await detectScenes(src, {
            label: 'scene detection',
            timeoutMs,
            durationSec,
            onFraction: (fraction) => report('scenes', { fraction }),
          });
          await writeSceneMarkers(mediaId, sceneFrames(scenes, fps));
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] scene detection échouée media=${mediaId}`);
        }
      }

      // Timeline sprite (a thumbnail about every 3 s, a single JPEG) — best effort:
      // a sprite failure does not condemn the transcoding.
      const plan = planTimelineSprite(
        typeof metadata.duration === 'number' ? metadata.duration : undefined,
        srcWidth,
        srcHeight,
      );
      if (plan) {
        report('sprite');
        try {
          const spritePath = join(dir, 'timeline-sprite.jpg');
          await makeTimelineSprite(src, spritePath, plan, {
            label: 'timeline sprite',
            timeoutMs,
            durationSec,
            onFraction: (fraction) => report('sprite', { fraction }),
          });
          const spriteKey = `derived/${mediaId}/timeline-sprite.jpg`;
          await storage.uploadFile(spriteKey, spritePath, 'image/jpeg');
          metadata.timelineSprite = { ...plan, key: spriteKey };
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] sprite timeline échoué media=${mediaId}`);
        }
      }

      // Audio waveform: one peak per bar (~8/s), stored in the metadata. Not an image — a few hundred bytes, neither a derivative to store nor a URL to presign. Best effort:
      // a silent media or an unreadable track does not condemn the transcoding; the player then simply displays nothing under the timeline.
      const waveformBins = metadata.hasAudio === true ? planWaveformBins(durationSec) : null;
      if (waveformBins) {
        try {
          const pcmPath = join(dir, 'audio.pcm');
          await extractAudioPcm(src, pcmPath, { label: 'audio waveform', timeoutMs, durationSec });
          const waveform = await waveformFromPcmFile(pcmPath, waveformBins);
          if (waveform) metadata.waveform = waveform;
          // PCM weighs two bytes per sample: released to disk without waiting for the temporary directory's purge (an hour of sound = 57 MB).
          await rm(pcmPath, { force: true });
        } catch (err) {
          logger.warn({ err }, `[ffmpeg.worker] forme d'onde audio échouée media=${mediaId}`);
        }
      }

      // All the derivatives are produced: the original source is no longer used — deleted to free up space (the flag is set BEFORE the delete: if the delete fails,
      // only the space is not recovered, the URLs already point to the proxy).
      //
      // Image sequence: the flag says "the source key is no longer what we serve" — `mediaSourceKey` therefore returns the proxy, and the review, the client share and A/B
      // receive a video. But NOTHING is deleted: the manifest and the original frames stay under their prefix, the only reference deliverables, served by
      // `GET /api/media/sequence/:id/frames`.
      metadata.sourceDeleted = true;
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: {
          status: MediaStatus.READY,
          thumbnailKey: thumbKey,
          metadata: metadata as Prisma.InputJsonObject,
        },
      });
      if (!sourceGone && !sequence)
        await storage
          .deleteObject(media.storageKey)
          .catch((err) =>
            logger.warn({ err }, `[ffmpeg.worker] suppression source échouée media=${mediaId}`),
          );
    } else if (kind === 'thumbnail') {
      // Image: probes dimensions + thumbnail (+ web proxy if the browser cannot read it).
      report('probe');
      Object.assign(metadata, await probe(src));
      // A still image has no duration: the flat rate of `ffmpegTimeoutMs` applies.
      const imageTimeoutMs = ffmpegTimeoutMs();
      const decodeOptions = imageDecodeInputOptions(ext);

      // Web proxy BEFORE the thumbnail: it is what makes the image viewable. Produced first, a thumbnail failure (rare) at least leaves the review functional.
      // (Progress stays on the "probe" step: the scale of the `thumbnail` job — lib/mediaProgress — has no `proxy` range, and inventing one here would make the
      // percentage go back to 0.)
      if (needsWebProxy(ext)) {
        const proxyPath = join(dir, 'proxy.jpg');
        await makeWebProxy(
          src,
          proxyPath,
          ext,
          {
            width: typeof metadata.width === 'number' ? metadata.width : 0,
            height: typeof metadata.height === 'number' ? metadata.height : 0,
          },
          { label: 'web proxy', timeoutMs: imageTimeoutMs },
        );
        const key = webProxyKey(mediaId);
        await storage.uploadFile(key, proxyPath, WEB_PROXY_CONTENT_TYPE);
        metadata.webProxyKey = key;
      }

      const thumbPath = join(dir, 'thumb.jpg');
      report('thumbnail');
      await makeThumbnail(
        src,
        thumbPath,
        { label: 'thumbnail', timeoutMs: imageTimeoutMs },
        undefined,
        decodeOptions,
      );
      const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
      await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: {
          status: MediaStatus.READY,
          thumbnailKey: thumbKey,
          metadata: metadata as Prisma.InputJsonObject,
        },
      });
    } else {
      throw new Error(`Unknown job kind: ${kind}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Writes to the media what the antivirus gave — verdict OR failure (37.E, A4-04).
 *
 * A `scan` job is the only one whose failure changes nothing for the media: it concerns a file already READY and already downloadable (GLB, splats — `jobKindFor` gives
 * them no processing job). Until now, a scan that died — clamd restarted for a viral database update, one to two minutes of unavailability — exhausted its three attempts in
 * some thirty seconds and vanished without leaving a line: no status, no metadata, no audit. The operator believed their instance covered, and nothing distinguished the
 * never-scanned file from the scanned and clean one.
 *
 * We therefore write both faces, and write them at EACH attempt rather than at the last: counting attempts presupposes knowing whether `attemptsMade` is already incremented
 * when the handler runs, which depends on the BullMQ version. A failure mark set too early is erased by the attempt that succeeds — the opposite (never writing anything) is the
 * defect we are correcting.
 *
 * The re-reading of the metadata is deliberate: the job may have started long before, and overwriting the current state here would make fields written in the meantime disappear.
 */
async function recordScanOutcome(
  mediaId: number,
  outcome: { scannedAt: string } | { failed: string },
): Promise<void> {
  try {
    const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
    if (!media) return;
    const metadata: Record<string, unknown> = { ...((media.metadata ?? {}) as object) };
    if ('scannedAt' in outcome) {
      metadata.scannedAt = outcome.scannedAt;
      delete metadata.scanFailed;
      delete metadata.scanFailedAt;
    } else {
      metadata.scanFailed = outcome.failed.trim().slice(0, 500);
      metadata.scanFailedAt = new Date().toISOString();
      delete metadata.scannedAt;
    }
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: { metadata: metadata as Prisma.InputJsonObject },
    });
  } catch (err) {
    // Marking must never mask the original error, which the caller re-throws.
    logger.warn({ err, mediaId }, '[ffmpeg.worker] verdict de scan non consigné');
  }
}

/**
 * Puts a media into failure **while keeping the reason** (45.C): without it, the review displays only a silent `FAILED` status — insufficient for USD, where the failure most often
 * comes from something the user can correct (missing asset in the zip, absent tooling).
 */
async function markFailed(mediaId: number, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).trim().slice(0, 500);
  try {
    const media = await prisma.mediaObject.findUnique({ where: { id: mediaId } });
    const metadata: Record<string, unknown> = { ...((media?.metadata ?? {}) as object) };
    metadata.processingError = message;
    await prisma.mediaObject.update({
      where: { id: mediaId },
      data: { status: MediaStatus.FAILED, metadata: metadata as Prisma.InputJsonObject },
    });
  } catch {
    // The status update must never mask the original error (re-thrown by the caller).
  }
}

export const ffmpegWorker = new Worker<MediaJobData>(
  QUEUE_NAMES.MEDIA,
  async (job) => {
    try {
      await handle(job.data.mediaObjectId, job.data.kind, progressReporter(job));
      await job
        .updateProgress(mediaJobProgress(job.data.kind, 'done'))
        .catch(ignoreFailure('[ffmpeg] progress update failed', { jobId: job.id }));
    } catch (err) {
      // A scan in error (clamd unreachable) does not condemn the media — BullMQ retries; only a detection sets FAILED. But it leaves a media served WITHOUT having been
      // scanned: it now says so on the media, failing which the absence of a scan was indistinguishable from a clean scan (see `recordScanOutcome`).
      if (job.data.kind === 'scan') {
        await recordScanOutcome(job.data.mediaObjectId, {
          failed: err instanceof Error ? err.message : String(err),
        });
      } else {
        await markFailed(job.data.mediaObjectId, err);
      }
      throw err;
    }
  },
  { connection: redisConnectionOptions, autorun: false, concurrency: 2 },
);

ffmpegWorker.on('completed', (job) =>
  logger.info(`[ffmpeg.worker] ✓ ${job.name} media=${job.data.mediaObjectId}`),
);
ffmpegWorker.on('failed', (job, err) =>
  logger.error({ err }, `[ffmpeg.worker] ✗ media=${job?.data.mediaObjectId}`),
);

if (require.main === module) {
  // The collection point BEFORE the consumers: it is the component whose holding up one most needs to know, and a worker that dies at startup must be detectable.
  // The module registers its own shutdown, and a port already taken does not bring it down.
  startWorkerMetricsServer();
  // Without this wiring, /metrics only renders the state of the process — never its work.
  // The media queue carries most of the cost (transcoding, HLS, thumbnails, 3D conversions); the six other consumers start through functions that do not return their worker,
  // wiring them in would require changing their signature (left to a dedicated batch).
  attachWorkerMetrics('media', ffmpegWorker);
  // The worker loop lives as long as the process: nothing to await here.
  void ffmpegWorker.run();
  registerWorkerShutdown('ffmpeg.worker', ffmpegWorker);
  logger.info('[ffmpeg.worker] démarré.');
  // Same worker process: also processes the storage cleanup queue (retry of orphans) and the delivery of webhooks (36.D — outgoing POSTs do not leave from the web server).
  startStorageCleanupWorker();
  startWebhookWorker();
  // Export of automatic timelines (45): same process, dedicated queue at concurrency 1.
  startTimelineExportWorker();
  // ShotGrid integration (48): events, periodic polling, reconciliation and outgoing writes — with catch-up at startup after an outage.
  startShotgridWorker();
  // Periodic maintenance (digest, weekly report, purges): scheduled by the API, executed here — it used to be three `setInterval`s of the web process.
  startMaintenanceWorker();
  // Spatial media thumbnails (3D, splat): `MediaService.requestSpatialThumb` enqueued, from three places, a queue that nobody consumed.
  startSpatialThumbWorker();
  // OCIO LUT baking: the admin route answered `202 { queued: true }` on a queue without a consumer, and the viewer fell back indefinitely on the internal LUT.
  startOcioBakeWorker();

  // Clean shutdown: the queue consumers first ("stop accepting" phase), then the Redis connections of the event channel and the database.
  registerShutdownTask({
    name: 'worker-events',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => closeWorkerEvents(),
  });
  registerShutdownTask({
    name: 'prisma',
    phase: SHUTDOWN_PHASE.DISCONNECT,
    run: () => prisma.$disconnect(),
  });
  installShutdownHandlers();
}
