// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ffmpeg command builders, against a fake fluent-ffmpeg: each command records the options it receives
 * and finishes the way the scenario says (`end`, `error`, or never — for the timeout). What is checked is the
 * command line handed to ffmpeg and the framing of its run, not ffmpeg itself.
 */
const h = vi.hoisted(() => {
  type Outcome = { kind: 'end' } | { kind: 'error'; err: Error } | { kind: 'hang' };
  const commands: FakeCommand[] = [];
  const outcomes: Outcome[] = [];
  class FakeCommand {
    inputs: string[] = [];
    inputOpts: string[] = [];
    outputOpts: string[] = [];
    outputs: string[] = [];
    complex: string[] = [];
    formats: string[] = [];
    seek?: number;
    killed?: string;
    handlers: Record<string, (...args: unknown[]) => void> = {};
    constructor(input?: string) {
      if (input) this.inputs.push(input);
      commands.push(this);
    }
    input(i: string) {
      this.inputs.push(i);
      return this;
    }
    inputOptions(o: string[]) {
      this.inputOpts.push(...o);
      return this;
    }
    inputFormat(f: string) {
      this.formats.push(f);
      return this;
    }
    seekInput(s: number) {
      this.seek = s;
      return this;
    }
    outputOptions(o: string[]) {
      this.outputOpts.push(...o);
      return this;
    }
    output(o: string) {
      this.outputs.push(o);
      return this;
    }
    complexFilter(f: string) {
      this.complex.push(f);
      return this;
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers[event] = fn;
      return this;
    }
    kill(signal: string) {
      this.killed = signal;
    }
    run() {
      const outcome = outcomes.shift() ?? { kind: 'end' };
      queueMicrotask(() => {
        this.handlers.stderr?.('[Parsed_showinfo_1] n:0 pts:48 pts_time:2.0');
        this.handlers.progress?.({ percent: 50 });
        if (outcome.kind === 'end') this.handlers.end?.();
        else if (outcome.kind === 'error') this.handlers.error?.(outcome.err);
      });
    }
  }
  const env = { VIDEO_ENCODER: 'libx264' as string };
  return { commands, outcomes, FakeCommand, env };
});

vi.mock('fluent-ffmpeg', () => ({ default: (input?: string) => new h.FakeCommand(input) }));
vi.mock('../../config/env', () => ({ env: h.env }));
vi.mock('../../lib/burnin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/burnin')>()),
  buildBurninFilters: () => ['drawtext=burn'],
}));
vi.mock('../../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { FfmpegTimeoutError } from '../../lib/ffmpegTimeout';
import {
  applyVideoChain,
  buildClientDerivative,
  detectScenes,
  extractAudioPcm,
  makeSlateImage,
  makeThumbnail,
  makeTimelineSprite,
  makeWebProxy,
  runFfmpeg,
  transcodeHlsRendition,
  transcodeProxy,
  withEncoderFallback,
  type BurninJob,
} from './commands';

const run = { label: 'step', timeoutMs: 1_000 };
const last = () => h.commands.at(-1)!;

beforeEach(() => {
  h.commands.length = 0;
  h.outcomes.length = 0;
  h.env.VIDEO_ENCODER = 'libx264';
});
afterEach(() => vi.useRealTimers());

describe('runFfmpeg', () => {
  it('resolves on end and reports progress fractions', async () => {
    const onFraction = vi.fn();
    await makeThumbnail('in.mov', 'out.jpg', { ...run, onFraction });
    expect(onFraction).toHaveBeenCalledWith(0.5);
  });

  it('rejects with the ffmpeg error', async () => {
    h.outcomes.push({ kind: 'error', err: new Error('codec') });
    await expect(makeThumbnail('in.mov', 'out.jpg', run)).rejects.toThrow('codec');
  });

  it('kills a pass that outlives its delay', async () => {
    vi.useFakeTimers();
    h.outcomes.push({ kind: 'hang' });
    const pending = makeThumbnail('in.mov', 'out.jpg', { label: 'thumbnail', timeoutMs: 50 });
    const caught = pending.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(60);
    expect(await caught).toBeInstanceOf(FfmpegTimeoutError);
    expect(last().killed).toBe('SIGKILL');
  });

  it('a late end after the timeout changes nothing', async () => {
    vi.useFakeTimers();
    h.outcomes.push({ kind: 'hang' });
    const cmd = new h.FakeCommand('x');
    const pending = runFfmpeg(cmd as never, { label: 'x', timeoutMs: 10 });
    const caught = pending.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(20);
    cmd.handlers.end?.();
    cmd.handlers.error?.(new Error('late'));
    expect(await caught).toBeInstanceOf(FfmpegTimeoutError);
  });
});

describe('still images and audio', () => {
  it('thumbnail: seeks to the middle for a video, decodes an EXR with its options', async () => {
    await makeThumbnail('in.mov', 'out.jpg', run, 12, ['-apply_trc', 'iec61966_2_1']);
    expect(last().seek).toBe(12);
    expect(last().inputOpts).toEqual(['-apply_trc', 'iec61966_2_1']);
    expect(last().outputOpts).toEqual(['-vframes 1', '-vf scale=640:-2']);
    await makeThumbnail('in.png', 'out.jpg', run, 0);
    expect(last().seek).toBeUndefined();
  });

  it('web proxy of an EXR: decoding options and the scale filter', async () => {
    await makeWebProxy('in.exr', 'out.jpg', '.exr', { width: 100_000, height: 4000 }, run);
    expect(last().inputOpts.length).toBeGreaterThan(0);
    expect(last().outputOpts).toContain('-vf');
    expect(last().outputs).toEqual(['out.jpg']);
  });

  it('audio PCM for the waveform: mono, first track, raw s16le', async () => {
    await extractAudioPcm('in.mov', 'out.pcm', run);
    expect(last().outputOpts).toEqual(expect.arrayContaining(['-vn', '-ac', '1', '-f', 's16le']));
  });

  it('timeline sprite: one tile per interval in a single frame', async () => {
    await makeTimelineSprite(
      'in.mov',
      'sprite.jpg',
      { intervalSec: 3, tileW: 160, tileH: 90, cols: 10, rows: 4 } as never,
      run,
    );
    expect(last().outputOpts[1]).toBe('fps=1/3,scale=160:90,tile=10x4');
  });
});

describe('video chain and encodes', () => {
  const burnin = (overrides: Partial<BurninJob> = {}): BurninJob =>
    ({
      cfg: { enabled: true, showLogo: true },
      ctx: {},
      logoPath: '/tmp/logo.png',
      slateInfo: null,
      ...overrides,
    }) as BurninJob;

  it('without a logo: a plain -vf with the pre-filters first', () => {
    const cmd = new h.FakeCommand('in');
    expect(applyVideoChain(cmd as never, 'scale=-2:720', null, 720, ['yadif'])).toEqual([
      '-vf',
      'yadif,scale=-2:720',
    ]);
  });

  it('with a logo: a second input and an overlay, output mapped to [vout]', () => {
    const cmd = new h.FakeCommand('in');
    const mapping = applyVideoChain(cmd as never, 'scale=-2:1080', burnin(), 1080);
    expect(mapping).toEqual(['-map', '[vout]', '-map', '0:a?']);
    expect(cmd.inputs).toContain('/tmp/logo.png');
    expect(cmd.complex[0]).toMatch(/overlay=main_w-overlay_w-18:main_h-overlay_h-18\[vout\]$/);
  });

  it('a disabled burn-in keeps the plain chain even with a logo', () => {
    const cmd = new h.FakeCommand('in');
    expect(
      applyVideoChain(
        cmd as never,
        's',
        burnin({ cfg: { enabled: false, showLogo: true } as never }),
        720,
      )[0],
    ).toBe('-vf');
  });

  it('proxy: capped at 1080p, faststart, web-safe pixel format', async () => {
    await transcodeProxy('in.mov', 'proxy.mp4', run, { srcHeight: 2160 });
    expect(last().outputOpts).toEqual(expect.arrayContaining(['-pix_fmt yuv420p', '-movflags +faststart']));
    await transcodeProxy('in.mov', 'proxy.mp4', run);
    expect(last().outputs).toEqual(['proxy.mp4']);
  });

  it('HLS rendition: fixed GOP, VOD playlist and segment naming', async () => {
    await transcodeHlsRendition(
      'in.mov',
      '/hls',
      '720p',
      720,
      3000,
      { preset: 'veryfast', audioBitrateK: 128 },
      run,
      25,
    );
    const o = last().outputOpts;
    expect(o).toEqual(expect.arrayContaining(['-b:v', '3000k', '-maxrate', '3210k', '-bufsize', '4500k']));
    expect(o).toEqual(
      expect.arrayContaining(['-hls_playlist_type', 'vod', '-hls_segment_filename', '/hls/720p_%03d.ts']),
    );
    expect(o[o.indexOf('-g') + 1]).toBe(o[o.indexOf('-keyint_min') + 1]);
    expect(last().outputs).toEqual(['/hls/720p.m3u8']);
  });

  it('falls back to libx264 when the configured encoder fails, not on a timeout', async () => {
    h.env.VIDEO_ENCODER = 'h264_nvenc';
    const attempt = vi.fn().mockRejectedValueOnce(new Error('no GPU')).mockResolvedValueOnce(undefined);
    await withEncoderFallback(attempt);
    expect(attempt.mock.calls.map((c) => c[0])).toEqual(['h264_nvenc', 'libx264']);

    const timeout = vi.fn().mockRejectedValue(new FfmpegTimeoutError('proxy', 10));
    await expect(withEncoderFallback(timeout)).rejects.toBeInstanceOf(FfmpegTimeoutError);
    expect(timeout).toHaveBeenCalledTimes(1);

    h.env.VIDEO_ENCODER = 'libx264';
    await expect(withEncoderFallback(vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow('x');
  });
});

describe('scenes and client derivative', () => {
  it('scene detection parses showinfo, and a failure is an empty list', async () => {
    expect(await detectScenes('in.mov', run)).toEqual([2]);
    h.outcomes.push({ kind: 'error', err: new Error('boom') });
    expect(await detectScenes('in.mov', run)).toEqual([]);
  });

  it('slate image from a lavfi colour source at the proxy size', async () => {
    await makeSlateImage('slate.png', 1920, 1080, ['SH010', 'v003'], run);
    expect(last().inputs[0]).toBe('color=c=0x0b0f14:s=1920x1080');
    expect(last().formats).toEqual(['lavfi']);
  });

  it('client derivative: slate concatenated with and without audio', async () => {
    await buildClientDerivative(
      'slate.png',
      'proxy.mp4',
      'client.mp4',
      { width: 1920, height: 1080, fps: 24, hasAudio: true },
      run,
    );
    expect(last().complex[0]).toContain('concat=n=2:v=1:a=1');
    expect(last().inputs).toContain('anullsrc=r=48000:cl=stereo');
    await buildClientDerivative(
      'slate.png',
      'proxy.mp4',
      'client.mp4',
      { width: 1920, height: 1080, fps: 24, hasAudio: false },
      run,
    );
    expect(last().complex[0]).toContain('concat=n=2:v=1:a=0');
  });
});
