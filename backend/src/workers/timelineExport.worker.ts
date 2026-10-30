// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { redisConnectionOptions } from '../lib/redis';
import { QUEUE_NAMES, type TimelineExportJobData } from '../lib/queues';
import { storage } from '../lib/storage';
import { logger } from '../lib/logger';
import {
  concatList,
  masterKey,
  normalizeArgs,
  placeholderFilter,
  placeholderInputs,
  type ExportProfile,
} from '../lib/timelineExport';
import { exportPlan, type ExportSegment } from '../services/TimelineService';
import { FfmpegTimeoutError, ffmpegTimeoutMs } from '../lib/ffmpegTimeout';
import { registerWorkerShutdown } from './shutdown';
import { ignoreFailure } from '../lib/ignoreFailure';

/**
 * Export of an automatic edit into a single file (Phase 45).
 *
 * Each shot is first brought to the project's common profile (resolution, frame rate, stereo
 * 48 kHz audio), then the whole is concatenated without re-encoding. Missing shots
 * become black cards carrying their code: the master lasts exactly as long as the
 * edit on screen, gaps included. A file shorter than the timeline would be a
 * lie about the state of production.
 */

/** Text carried by a card in the master (the export has no language context). */
const PLACEHOLDER_LABEL = 'no media';

/**
 * Encodes a segment to the common profile, from a local file.
 *
 * The timeout is proportional to the shot's duration: without it, a shot with an exotic container
 * that makes ffmpeg loop would **permanently** freeze the export queue, which runs at
 * concurrency 1, so no edit exports until the worker restarts.
 */
function encodeSource(
  input: string,
  output: string,
  profile: ExportProfile,
  label: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cmd = ffmpeg(input).outputOptions(normalizeArgs(profile)).output(output);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        cmd.kill('SIGKILL');
      } catch {
        // Process already dead: nothing to do.
      }
      reject(new FfmpegTimeoutError(label, timeoutMs));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
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
 * Launches the ffmpeg binary directly.
 *
 * `fluent-ffmpeg` validates input formats against its own list and rejects `lavfi`
 * ("Input formats lavfi are not available"). Yet title cards have no source file;
 * they are fully synthesized by that device. So we keep the library
 * for real files, and talk to the binary for that case.
 */
function runFfmpeg(args: string[], label: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', args, { windowsHide: true });
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new FfmpegTimeoutError(label, timeoutMs)));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    // ffmpeg's error output is verbose: only its tail is useful for diagnosis.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) =>
      finish(() =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg (code ${String(code)}) : ${stderr.slice(-600)}`)),
      ),
    );
  });
}

/**
 * Builds a black card of the requested duration, marked with the shot's code.
 *
 * Burning in the text depends on `drawtext`, hence on a font configuration
 * present on the machine (the worker image installs DejaVu). Where it is missing, ffmpeg
 * fails: we then rebuild the card without text rather than losing the whole export. A
 * master with silent gaps stays usable; a missing master does not.
 */
async function encodePlaceholder(
  output: string,
  profile: ExportProfile,
  shotCode: string,
  duration: number,
): Promise<void> {
  try {
    await encodePlaceholderWith(output, profile, shotCode, duration, true);
  } catch (err) {
    logger.warn({ err }, `[timelineExport.worker] card without text for ${shotCode}`);
    await encodePlaceholderWith(output, profile, shotCode, duration, false);
  }
}

function encodePlaceholderWith(
  output: string,
  profile: ExportProfile,
  shotCode: string,
  duration: number,
  withText: boolean,
): Promise<void> {
  const { video, audio } = placeholderInputs(profile, duration);
  return runFfmpeg(
    [
      '-f',
      'lavfi',
      '-i',
      video,
      '-f',
      'lavfi',
      '-i',
      audio,
      ...(withText ? ['-vf', placeholderFilter(profile, shotCode, PLACEHOLDER_LABEL)] : []),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-shortest',
      '-y',
      output,
    ],
    `placeholder ${shotCode}`,
    ffmpegTimeoutMs(duration),
  );
}

/** Joins the normalized segments end to end, without re-encoding (`concat` demuxer). */
function concatSegments(listFile: string, output: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cmd = ffmpeg()
      .input(listFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
      .output(output);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        cmd.kill('SIGKILL');
      } catch {
        // Process already dead: nothing to do.
      }
      reject(new FfmpegTimeoutError('concat', timeoutMs));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
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

/** Prepares a segment (encoded source or card) and returns its local path. */
async function buildSegment(
  segment: ExportSegment,
  index: number,
  dir: string,
  profile: ExportProfile,
): Promise<string> {
  const output = join(dir, `seg${String(index).padStart(4, '0')}.mp4`);
  if (segment.storageKey === null) {
    await encodePlaceholder(output, profile, segment.shotCode, segment.duration);
    return output;
  }
  const source = join(dir, `src${String(index).padStart(4, '0')}`);
  await storage.downloadToFile(segment.storageKey, source);
  await encodeSource(
    source,
    output,
    profile,
    `segment ${segment.shotCode}`,
    ffmpegTimeoutMs(segment.duration),
  );
  await rm(source, { force: true });
  return output;
}

async function handle(timelineId: number, onProgress: (percent: number) => void): Promise<void> {
  const plan = await exportPlan(timelineId);
  if (plan.segments.length === 0) throw new Error(`Timeline ${timelineId} has no shot to export`);

  const dir = await mkdtemp(join(tmpdir(), 'review-timeline-'));
  try {
    const paths: string[] = [];
    for (const [index, segment] of plan.segments.entries()) {
      // Per-shot progress: preparing the segments takes most of the work,
      // the final concatenation is a copy without re-encoding.
      onProgress(Math.round((index / plan.segments.length) * 90));
      paths.push(await buildSegment(segment, index, dir, plan.profile));
    }
    const listFile = join(dir, 'concat.txt');
    await writeFile(listFile, concatList(paths), 'utf8');
    const master = join(dir, 'master.mp4');
    onProgress(90);
    const total = plan.segments.reduce((sum, s) => sum + s.duration, 0);
    await concatSegments(listFile, master, ffmpegTimeoutMs(total));
    await storage.uploadFile(masterKey(timelineId), master, 'video/mp4');
    onProgress(100);
    logger.info(`[timelineExport.worker] ✓ montage=${timelineId} (${plan.segments.length} plans)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const timelineExportWorker = new Worker<TimelineExportJobData>(
  QUEUE_NAMES.TIMELINE_EXPORT,
  (job) =>
    handle(job.data.timelineId, (percent) => {
      // Best effort: a lost progress update does not doom the export.
      void job
        .updateProgress(percent)
        .catch(ignoreFailure('[timeline-export] progress update failed', { jobId: job.id }));
    }),
  // Only one export at a time: each job encodes a whole film; parallelizing them
  // would saturate the machine that also serves the ongoing transcodes.
  { connection: redisConnectionOptions, autorun: false, concurrency: 1 },
);

timelineExportWorker.on('failed', (job, err) =>
  logger.error({ err }, `[timelineExport.worker] ✗ montage=${job?.data.timelineId}`),
);

/** Started by the main worker process (cf. ffmpeg.worker). */
export function startTimelineExportWorker(): void {
  // The worker loop lives as long as the process: nothing to wait for here.
  void timelineExportWorker.run();
  registerWorkerShutdown('timelineExport.worker', timelineExportWorker);
  logger.info('[timelineExport.worker] started.');
}
