// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { mkdtemp, rm, readdir, mkdir, writeFile } from 'node:fs/promises';
import { type MediaJobData } from '../../lib/queues';
import { prisma } from '../../lib/prisma';
import { storage, StorageService } from '../../lib/storage';
import { MediaStatus, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger';
import { getTranscodeConfig, selectRenditions, type TranscodeConfig } from '../../lib/transcodeConfig';
import { buildMasterPlaylist, hlsContentType, renditionName, type HlsRendition } from '../../lib/hls';
import { planTimelineSprite } from '../../lib/timelineSprite';
import { planWaveformBins, waveformFromPcmFile } from '../../lib/audioWaveform';
import { sceneFrames } from '../../lib/sceneDetect';
import { publishWorkerEvent } from '../../lib/workerEvents';
import { resolveProjectIdForVersion } from '../../lib/pipeline';
import { buildSlateLines, resolveBurninConfig, type BurninContext, type SlateInfo } from '../../lib/burnin';
import { SETTING_KEYS } from '../../lib/settings';
import { qualityEncoderArgs } from '../../lib/videoEncoder';
import { sha256File } from '../../lib/checksum';
import { isClamavEnabled, scanFile } from '../../lib/clamav';
import { logAudit } from '../../services/AuditService';
import { sourceFormatLabel } from '../../lib/modelConvert';
import { convertToGlb, DEFAULT_USD_REQUEST, type UsdRequest } from '../../services/ModelConvertService';
import { ffmpegTimeoutMs } from '../../lib/ffmpegTimeout';
import { NO_TRAITS, sourceTraits, type SourceTraits } from '../../lib/masterTraits';
import {
  imageDecodeInputOptions,
  needsWebProxy,
  webProxyKey,
  WEB_PROXY_CONTENT_TYPE,
} from '../../lib/imageProxy';
import {
  localFrameName,
  localFramePattern,
  parseFrameName,
  sequenceInputOptions,
  sequenceMasterOutputOptions,
  SEQUENCE_MASTER_CRF,
  SEQUENCE_MASTER_FILENAME,
  SEQUENCE_MASTER_SCALE,
} from '../../lib/imageSequence';
import { mediaJobProgress, type MediaJobProgress, type MediaJobStep } from '../../lib/mediaProgress';
import { ignoreFailure } from '../../lib/ignoreFailure';
import {
  probe,
  runFfmpeg,
  makeThumbnail,
  makeWebProxy,
  extractAudioPcm,
  makeTimelineSprite,
  type BurninJob,
  withEncoderFallback,
  transcodeProxy,
  transcodeHlsRendition,
  detectScenes,
  makeSlateImage,
  buildClientDerivative,
  SLATE_SEC,
} from './commands';

/**
 * Publishes the progress on the BullMQ job.
 *
 * Without it, administration sees only an "active" job: a six-hour encoding and an ffmpeg blocked for six hours look exactly alike. We therefore publish the current step
 * (probe, proxy, rendition n/N, sprite, thumbnail...) and its advancement. The write only goes out if the percentage has moved: at most a hundred per job.
 */
export type ProgressReporter = (
  step: MediaJobStep,
  opts?: { index?: number; total?: number; fraction?: number },
) => void;

export function progressReporter(job: Job<MediaJobData>): ProgressReporter {
  let last = -1;
  return (step, opts) => {
    const progress: MediaJobProgress = mediaJobProgress(job.data.kind, step, opts);
    if (progress.percent === last) return;
    last = progress.percent;
    // Best effort: a lost progress write must never make the transcoding it describes fail.
    void job.updateProgress(progress).catch((err: unknown) => {
      logger.debug({ err }, '[ffmpeg.worker] progress not published');
    });
  };
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
        logger.warn({ err }, `[ffmpeg.worker] burn-in logo unavailable media=${mediaId}`);
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

/** The media row a job works on, with its image sequence (wave 5) when it has one. */
type MediaRecord = Prisma.MediaObjectGetPayload<{ include: { imageSequence: true } }>;

/** What every step of a media job shares: the media, its local source file and the metadata being built. */
interface JobContext {
  mediaId: number;
  media: MediaRecord;
  /** Temporary working directory, purged at the end of the job. */
  dir: string;
  /** Local source file (downloaded original, MP4 proxy when the source was deleted, or sequence master). */
  src: string;
  /** Original extension (assimp/ffmpeg detect the format by extension). */
  ext: string;
  sequence: MediaRecord['imageSequence'];
  /** Source video deleted after a previous transcoding: the proxy stands in for it. */
  sourceGone: boolean;
  /** Metadata being built, written back at the end of the step that completes the media. */
  metadata: Record<string, unknown>;
  report: ProgressReporter;
}

/**
 * Processes one media job: fetches the source, scans it, then runs the kind's pipeline (3D conversion,
 * video transcoding, image thumbnail, or antivirus alone).
 */
export async function handle(
  mediaId: number,
  kind: MediaJobData['kind'],
  report: ProgressReporter,
): Promise<void> {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    include: { imageSequence: true },
  });
  if (!media) throw new Error(`MediaObject ${mediaId} not found`);

  const dir = await mkdtemp(join(tmpdir(), 'review-'));
  try {
    report('download');
    const ctx = await fetchSource(mediaId, media, dir, report);
    const scan = await scanSource(ctx);
    if (scan.quarantined) return;

    if (kind === 'scan') await finishScanJob(ctx, scan.scannedAt);
    else if (kind === 'convert3d') await convertModel(ctx);
    else if (kind === 'transcode') await transcodeVideo(ctx);
    else if (kind === 'thumbnail') await processImage(ctx);
    else throw new Error(`Unknown job kind: ${kind}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Brings the source next to the worker and checks its integrity. */
async function fetchSource(
  mediaId: number,
  media: MediaRecord,
  dir: string,
  report: ProgressReporter,
): Promise<JobContext> {
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
        `Invalid checksum media=${mediaId} (expected ${String(metadata.contentHash).slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
      );
    }
  }
  return { mediaId, media, dir, src, ext, sequence, sourceGone, metadata, report };
}

/**
 * Opt-in antivirus scan (37.E): infected file → object moved to quarantine, media FAILED. clamd unreachable = error (BullMQ retry) — we do not publish without a scan.
 * A sequence has already been scanned frame by frame during its assembly: the master we hold here is our own output, the scanner would prove nothing.
 *
 * Returns the date of the verdict when there has been one: it serves to mark the media, and its absence to NOT mark it.
 */
async function scanSource(ctx: JobContext): Promise<{ quarantined: boolean; scannedAt?: string }> {
  const { mediaId, media, metadata } = ctx;
  if (!isClamavEnabled() || ctx.sourceGone || ctx.sequence) return { quarantined: false };
  const scan = await scanFile(ctx.src);
  // An unscanned media must not pass itself off as a scanned and clean one: the mark is carried by the media itself, not by the existence of a job.
  if (scan.clean) {
    const scannedAt = new Date().toISOString();
    metadata.scannedAt = scannedAt;
    return { quarantined: false, scannedAt };
  }
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
  logger.warn(`[ffmpeg.worker] media ${mediaId} quarantined (${scan.virus})`);
  return { quarantined: true };
}

/** Antivirus alone (37.E): the preamble has already scanned/quarantined. */
async function finishScanJob(ctx: JobContext, scannedAt: string | undefined): Promise<void> {
  ctx.report('scan', { fraction: 1 });
  // This media is READY and downloadable SINCE finalization: this is the only path where the scan conditions nothing. Without a written trace, a GLB or a splat never
  // scanned (clamd restarted during the upload window) is indistinguishable from a scanned and clean media — for the operator as for the SQL query. We therefore write the
  // verdict, and clear the failure of a previous attempt that this one has just caught up with. Nothing to write if the antivirus was switched off between enqueuing and
  // processing: this media is not scanned, and claiming otherwise would be worse than silence.
  if (scannedAt) await recordScanOutcome(ctx.mediaId, { scannedAt });
}

/** Conversion → GLB for the Three.js viewer (fixes the DataView error on raw FBX/OBJ). */
async function convertModel(ctx: JobContext): Promise<void> {
  const { mediaId, media, dir, src, ext, metadata } = ctx;
  ctx.report('convert');
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
}

/** A video job once probed: the bounds and choices every ffmpeg pass of the job shares. */
interface VideoJob extends JobContext {
  durationSec: number | undefined;
  timeoutMs: number;
  traits: SourceTraits;
  burnin: BurninJob | null;
}

const numberOr = <T>(value: unknown, fallback: T): number | T =>
  typeof value === 'number' ? value : fallback;

/**
 * Video: probe, proxy and thumbnail, then the HLS ladder and the best-effort derivatives (client slate,
 * scene markers, timeline sprite, waveform), and finally the release of the source.
 */
async function transcodeVideo(ctx: JobContext): Promise<void> {
  const job = await probeVideo(ctx);
  const { proxyPath, thumbKey } = await produceProxyAndThumbnail(job);
  const tcfg = await getTranscodeConfig();
  await produceHlsLadder(job, tcfg, thumbKey);
  if (job.burnin?.slateInfo) await produceClientDerivative(job, job.burnin.slateInfo, proxyPath);
  if (tcfg.sceneDetection) await produceSceneMarkers(job);
  await produceTimelineSprite(job);
  await produceWaveform(job);
  await completeTranscode(job, thumbKey);
}

/**
 * Probe of the video and the job-wide bounds.
 *
 * The probe records **two** forms of the frame rate: `fps`, rounded to the hundredth (historical value, still read by
 * everything that already exists), and `fpsNum`/`fpsDen`, the exact fraction of the container. 23.98 drifts by a whole
 * frame after four minutes; 24000/1001 never drifts. Media already in the database keep their only `fps`: the player can
 * recover the broadcast rate from it (see `frameRate.ts`).
 */
async function probeVideo(ctx: JobContext): Promise<VideoJob> {
  const { mediaId, media, dir, src, sequence, metadata } = ctx;
  ctx.report('probe');
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
  const durationSec = numberOr(metadata.duration, undefined);
  const timeoutMs = ffmpegTimeoutMs(durationSec);
  // Post-production masters (MXF, AVI, ProRes in MOV): deinterlacing and downmix decided here, once, and applied identically to the proxy and to the HLS ladder.
  const traits = sourceTraits(metadata);

  // Configurable burn-ins (35.A): the project's effective configuration + shot/version context.
  // Best effort — a resolution failure does not condemn the transcoding.
  const burnin = await loadBurninSetup(mediaId, media.versionId, media.originalName, dir).catch((err) => {
    logger.warn({ err }, `[ffmpeg.worker] burn-ins not resolved media=${mediaId}`);
    return null;
  });
  if (burnin) burnin.ctx.fps = numberOr(metadata.fps, null);
  return { ...ctx, durationSec, timeoutMs, traits, burnin };
}

/** Web MP4 proxy (with burn-ins) and the thumbnail taken at the middle of the video. */
async function produceProxyAndThumbnail(job: VideoJob): Promise<{ proxyPath: string; thumbKey: string }> {
  const { mediaId, dir, src, metadata, timeoutMs, durationSec, report } = job;
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
        burnin: job.burnin,
        srcHeight: numberOr(metadata.height, undefined),
        encoder,
        traits: job.traits,
      },
    ),
  );
  const proxyKey = `derived/${mediaId}/proxy.mp4`;
  await storage.uploadFile(proxyKey, proxyPath, 'video/mp4');
  metadata.proxyKey = proxyKey;

  const thumbPath = join(dir, 'thumb.jpg');
  // Frame at the middle of the video (duration/2) — falls back to 1 s if the duration is unknown.
  const midSec = typeof metadata.duration === 'number' && metadata.duration > 0 ? metadata.duration / 2 : 1;
  report('thumbnail');
  await makeThumbnail(src, thumbPath, { label: 'thumbnail', timeoutMs }, midSec);
  const thumbKey = StorageService.thumbnailKey(mediaId, 'jpg');
  await storage.uploadFile(thumbKey, thumbPath, 'image/jpeg');
  return { proxyPath, thumbKey };
}

/**
 * Adaptive HLS (Phase 23): multi-rendition ladder + master, if enabled and the height is known.
 * Progressive (34.F): the media becomes READY as soon as the FIRST rendition is out (playback possible
 * while the higher qualities transcode); each rendition updates metadata.hls (`building` flag) and publishes an event relayed over the socket to the review.
 */
async function produceHlsLadder(job: VideoJob, tcfg: TranscodeConfig, thumbKey: string): Promise<void> {
  const { mediaId, media, dir, src, metadata, timeoutMs, durationSec, report } = job;
  const srcHeight = numberOr(metadata.height, 0);
  const srcWidth = numberOr(metadata.width, 0);
  if (!tcfg.enabled || srcHeight <= 0) return;
  const srcFps = numberOr(metadata.fps, undefined);
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
    job.burnin,
    job.traits,
  );
  metadata.hls = { renditions };
}

/**
 * Slate + client derivative (35.A, best effort): identification slate concatenated at the head of the proxy →
 * `derived/{id}/client.mp4`, served only through shares.
 */
async function produceClientDerivative(
  job: VideoJob,
  slateInfo: SlateInfo,
  proxyPath: string,
): Promise<void> {
  const { mediaId, dir, metadata, timeoutMs, durationSec, report } = job;
  report('client');
  try {
    const p = await probe(proxyPath);
    const pw = p.width ?? 0;
    const ph = p.height ?? 0;
    if (pw > 0 && ph > 0) {
      const slatePng = join(dir, 'slate.png');
      await makeSlateImage(slatePng, pw, ph, buildSlateLines(slateInfo), {
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
    logger.warn({ err }, `[ffmpeg.worker] slate/client derivative failed media=${mediaId}`);
  }
}

/**
 * Scene detection (34.H, admin opt-in): automatic "Shot n" markers at the cuts — best effort, after playback has been
 * opened (READY already set by the first rendition).
 */
async function produceSceneMarkers(job: VideoJob): Promise<void> {
  const { mediaId, src, metadata, timeoutMs, durationSec, report } = job;
  report('scenes');
  try {
    const fps = numberOr(metadata.fps, 24);
    const scenes = await detectScenes(src, {
      label: 'scene detection',
      timeoutMs,
      durationSec,
      onFraction: (fraction) => report('scenes', { fraction }),
    });
    await writeSceneMarkers(mediaId, sceneFrames(scenes, fps));
  } catch (err) {
    logger.warn({ err }, `[ffmpeg.worker] scene detection failed media=${mediaId}`);
  }
}

/**
 * Timeline sprite (a thumbnail about every 3 s, a single JPEG) — best effort: a sprite failure does not condemn the
 * transcoding.
 */
async function produceTimelineSprite(job: VideoJob): Promise<void> {
  const { mediaId, dir, src, metadata, timeoutMs, durationSec, report } = job;
  const plan = planTimelineSprite(
    numberOr(metadata.duration, undefined),
    numberOr(metadata.width, 0),
    numberOr(metadata.height, 0),
  );
  if (!plan) return;
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
    logger.warn({ err }, `[ffmpeg.worker] timeline sprite failed media=${mediaId}`);
  }
}

/**
 * Audio waveform: one peak per bar (~8/s), stored in the metadata. Not an image — a few hundred bytes, neither a
 * derivative to store nor a URL to presign. Best effort: a silent media or an unreadable track does not condemn the
 * transcoding; the player then simply displays nothing under the timeline.
 */
async function produceWaveform(job: VideoJob): Promise<void> {
  const { mediaId, dir, src, metadata, timeoutMs, durationSec } = job;
  const waveformBins = metadata.hasAudio === true ? planWaveformBins(durationSec) : null;
  if (!waveformBins) return;
  try {
    const pcmPath = join(dir, 'audio.pcm');
    await extractAudioPcm(src, pcmPath, { label: 'audio waveform', timeoutMs, durationSec });
    const waveform = await waveformFromPcmFile(pcmPath, waveformBins);
    if (waveform) metadata.waveform = waveform;
    // PCM weighs two bytes per sample: released to disk without waiting for the temporary directory's purge (an hour of sound = 57 MB).
    await rm(pcmPath, { force: true });
  } catch (err) {
    logger.warn({ err }, `[ffmpeg.worker] audio waveform failed media=${mediaId}`);
  }
}

/**
 * All the derivatives are produced: the original source is no longer used — deleted to free up space (the flag is set
 * BEFORE the delete: if the delete fails, only the space is not recovered, the URLs already point to the proxy).
 *
 * Image sequence: the flag says "the source key is no longer what we serve" — `mediaSourceKey` therefore returns the
 * proxy, and the review, the client share and A/B receive a video. But NOTHING is deleted: the manifest and the original
 * frames stay under their prefix, the only reference deliverables, served by `GET /api/media/sequence/:id/frames`.
 */
async function completeTranscode(job: VideoJob, thumbKey: string): Promise<void> {
  const { mediaId, media, metadata } = job;
  metadata.sourceDeleted = true;
  await prisma.mediaObject.update({
    where: { id: mediaId },
    data: {
      status: MediaStatus.READY,
      thumbnailKey: thumbKey,
      metadata: metadata as Prisma.InputJsonObject,
    },
  });
  if (!job.sourceGone && !job.sequence)
    await storage
      .deleteObject(media.storageKey)
      .catch((err) => logger.warn({ err }, `[ffmpeg.worker] source deletion failed media=${mediaId}`));
}

/** Image: probes dimensions + thumbnail (+ web proxy if the browser cannot read it). */
async function processImage(ctx: JobContext): Promise<void> {
  const { mediaId, dir, src, ext, metadata, report } = ctx;
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
      { width: numberOr(metadata.width, 0), height: numberOr(metadata.height, 0) },
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
export async function recordScanOutcome(
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
    logger.warn({ err, mediaId }, '[ffmpeg.worker] scan verdict not recorded');
  }
}
