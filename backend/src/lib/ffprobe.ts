// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn } from 'node:child_process';
import { FFPROBE_TIMEOUT_MS, ffmpegTimeoutMessage } from './ffmpegTimeout';

/**
 * ffprobe probe.
 *
 * We talk to the binary rather than to `fluent-ffmpeg.ffprobe`, for a specific reason: the library does not
 * hand control back over the child process, so a probe blocked on a corrupted stream cannot be killed — it
 * blocks the queue slot until the worker restarts. Here the probe has a delay, and the process is killed.
 * A secondary benefit: parsing the output becomes a pure function, hence testable.
 */

export interface ProbeResult {
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  /** Numerator of the exact frame rate ("24000" for 24000/1001). */
  fpsNum?: number;
  /** Denominator of the exact frame rate ("1001" for 24000/1001). */
  fpsDen?: number;
  hasAudio?: boolean;
  /**
   * Field order declared by the container (`progressive`, `tt`, `bb`, `tb`, `bt`).
   * Broadcast MXF/AVI masters are often interlaced: without this field, the proxy comes out combed and the
   * supervisor judges a picture nobody delivered.
   */
  fieldOrder?: string;
  /** Channel count of the retained audio track (6 for a 5.1). */
  audioChannels?: number;
  /** Codec of the retained video track (`prores`, `dnxhd`, `h264`...) — provenance trace. */
  videoCodec?: string;
}

/** Exact frame rate, as the container declares it — never rounded. */
export interface FrameRateFraction {
  num: number;
  den: number;
}

interface RawStream {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  r_frame_rate?: unknown;
  field_order?: unknown;
  channels?: unknown;
  disposition?: { attached_pic?: unknown };
}

const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Frame rate from `r_frame_rate` ("24000/1001"), rounded to the hundredth — this is the historical value of
 * the `metadata.fps` field, on which all the frame counters rely.
 *
 * Kept as-is: media already in the database only carry this number, and everything that displays it
 * ("23.98 fps") or rereads it keeps working. The **exact** rate comes in addition, in `fpsNum`/`fpsDen` — see
 * `parseFrameRateFraction`.
 */
export function parseFrameRate(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw.includes('/')) return undefined;
  const [n, d] = raw.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d)) return undefined;
  return Math.round((n / d) * 100) / 100;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * **Exact** frame rate as an irreducible fraction: 24000/1001, not 23.98.
 *
 * Rounding to the hundredth drifts by 0.003976 frame per second at 23.976 fps — a whole frame of gap after four
 * minutes. The frame number a supervisor cites in a note then no longer designates the same image as the one
 * open in the DCC. Both terms of the fraction are therefore kept: the only form no counter drifts from.
 */
export function parseFrameRateFraction(raw: unknown): FrameRateFraction | undefined {
  if (typeof raw !== 'string' || !raw.includes('/')) return undefined;
  const [n, d] = raw.split('/').map(Number);
  if (!n || !d || !Number.isFinite(n) || !Number.isFinite(d) || n < 0 || d < 0) return undefined;
  // Reduction only on integers: `30000/1001` reduces, `29.97/1` has nothing to reduce.
  if (!Number.isInteger(n) || !Number.isInteger(d)) return { num: n, den: d };
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

/**
 * The **useful** video track of a container.
 *
 * `streams.find(codec_type === 'video')` took whichever came first. Yet a ProRes master in MOV, a broadcast
 * MXF or an MP4 exported from an NLE regularly embeds a cover (`disposition.attached_pic`) or a 120 px
 * thumbnail: once probed, it became the definition of the media — proxy transcoded at 120 px high, whole HLS
 * ladder computed from it, wrong review frame. Attached pictures are therefore set aside and, failing a safer
 * criterion, the track with the largest area is kept.
 */
function pickVideoStream(streams: RawStream[]): RawStream | undefined {
  const candidates = streams.filter((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const pool = candidates.length > 0 ? candidates : streams.filter((s) => s.codec_type === 'video');
  const area = (s: RawStream): number => (asNumber(s.width) ?? 0) * (asNumber(s.height) ?? 0);
  return pool.reduce<RawStream | undefined>(
    (best, s) => (best === undefined || area(s) > area(best) ? s : best),
    undefined,
  );
}

/**
 * Is the media interlaced? `unknown` and `progressive` mean "no": we never deinterlace on doubt — the pass
 * costs a frame of sharpness.
 */
export function isInterlaced(fieldOrder: string | undefined): boolean {
  return fieldOrder !== undefined && ['tt', 'bb', 'tb', 'bt'].includes(fieldOrder);
}

/** Parses the JSON output of ffprobe. Unreadable output yields an empty result. */
export function parseProbeOutput(raw: string): ProbeResult {
  let data: { format?: { duration?: unknown }; streams?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return {};
  }
  const streams: RawStream[] = Array.isArray(data.streams) ? (data.streams as RawStream[]) : [];
  const video = pickVideoStream(streams);
  // Richest audio track: a broadcast MXF often carries several tracks, including a stereo downmix and mono
  // stems. The channel count decides the downmix.
  const audio = streams
    .filter((s) => s.codec_type === 'audio')
    .reduce<RawStream | undefined>(
      (best, s) =>
        best === undefined || (asNumber(s.channels) ?? 0) > (asNumber(best.channels) ?? 0) ? s : best,
      undefined,
    );
  const duration = asNumber(data.format?.duration);
  const rate = parseFrameRateFraction(video?.r_frame_rate);
  return {
    duration: duration !== undefined ? Math.round(duration * 100) / 100 : undefined,
    width: asNumber(video?.width),
    height: asNumber(video?.height),
    fps: parseFrameRate(video?.r_frame_rate),
    fpsNum: rate?.num,
    fpsDen: rate?.den,
    hasAudio: audio !== undefined,
    fieldOrder: typeof video?.field_order === 'string' ? video.field_order : undefined,
    audioChannels: asNumber(audio?.channels),
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : undefined,
  };
}

/** Probe arguments (extracted so they can be checked without launching a process). */
export function probeArgs(path: string): string[] {
  return ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-i', path];
}

/** Probes a local file. On timeout the process is killed and an explicit error is raised. */
export function probeFile(path: string, timeoutMs: number = FFPROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', probeArgs(path), {
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(ffmpegTimeoutMessage('probe', timeoutMs))));
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) =>
      finish(() =>
        code === 0
          ? resolve(parseProbeOutput(stdout))
          : reject(new Error(`ffprobe failed (exit code ${String(code)}) on ${path}`)),
      ),
    );
  });
}
