// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Export worker for an edit: the decisions, not the bytes.
 *
 * The 297 lines of this worker had no test: neither Redis, ffmpeg nor MinIO are
 * available in a unit suite, and nothing pure is exported from it. We therefore capture the
 * processor that the worker hands to BullMQ and call it directly, with ffmpeg and storage
 * doubled. What is checked is what the file promises: a master lasting exactly
 * as long as the timeline (missing shots become title cards, they do not vanish),
 * a card without text rather than a lost export when `drawtext` is missing, and the
 * temporary directory removed even on failure.
 */

type Processor = (job: {
  data: { timelineId: number };
  updateProgress: (p: number) => Promise<void>;
}) => Promise<void>;

// `vi.hoisted`: the factories of `vi.mock` are hoisted above the declarations.
const captured = vi.hoisted((): { processor?: Processor } => ({}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      readonly name: string,
      processor: Processor,
      readonly opts: unknown,
    ) {
      captured.processor = processor;
    }
    on() {
      return this;
    }
    run() {
      return Promise.resolve();
    }
  },
  // `JobService` builds its queues at import time: without this double, it would open Redis.
  Queue: class {
    constructor(readonly name: string) {}
    add() {
      return Promise.resolve({});
    }
  },
}));

/** Each ffmpeg call succeeds unless `ffmpegFails` carries an error for that step. */
const ffmpegCalls: { inputs: string[]; output: string }[] = [];
let ffmpegError: Error | null = null;

vi.mock('fluent-ffmpeg', () => {
  const factory = (input?: string) => {
    const call: { inputs: string[]; output: string } = { inputs: input ? [input] : [], output: '' };
    const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const api = {
      input: (i: string) => {
        call.inputs.push(i);
        return api;
      },
      inputOptions: () => api,
      outputOptions: () => api,
      output: (o: string) => {
        call.output = o;
        return api;
      },
      kill: () => undefined,
      on: (event: string, handler: (...args: unknown[]) => void) => {
        emitter.on(event, handler);
        return api;
      },
      run: () => {
        ffmpegCalls.push(call);
        setImmediate(() => {
          if (ffmpegError) emitter.emit('error', ffmpegError);
          else emitter.emit('end');
        });
        return api;
      },
    };
    return api;
  };
  return { default: factory };
});

/**
 * Title cards: the worker talks to the binary directly (lavfi is rejected by fluent-ffmpeg).
 * `spawnExitCodes` is consumed call by call, enough to make only the first one fail.
 */
const spawnCalls: string[][] = [];
const spawnExitCodes: number[] = [];

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[]) => {
    spawnCalls.push(args);
    const code = spawnExitCodes.shift() ?? 0;
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => child.emit('close', code));
    return child;
  },
}));

const removed: string[] = [];
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn((target: string) => {
      removed.push(target);
      return Promise.resolve();
    }),
  };
});

vi.mock('../lib/redis', () => ({ redisConnectionOptions: {} }));
vi.mock('../services/StorageService', () => ({
  storage: {
    downloadToFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../services/TimelineService', () => ({ exportPlan: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./shutdown', () => ({ registerWorkerShutdown: vi.fn() }));

import './timelineExport.worker';
import { storage } from '../services/StorageService';
import { exportPlan } from '../services/TimelineService';
import { logger } from '../lib/logger';
import { masterKey } from '../lib/timelineExport';

const PROFILE = { width: 1920, height: 1080, fps: 24 };

const plan = (segments: { shotCode: string; duration: number; storageKey: string | null }[]) => ({
  timelineId: 7,
  projectId: 1,
  profile: PROFILE,
  segments,
});

/** Runs the worker's processor and returns the sequence of reported progress values. */
async function runJob(timelineId = 7): Promise<number[]> {
  const progress: number[] = [];
  await captured.processor!({
    data: { timelineId },
    updateProgress: (p: number) => {
      progress.push(p);
      return Promise.resolve();
    },
  });
  return progress;
}

beforeEach(() => {
  ffmpegCalls.length = 0;
  spawnCalls.length = 0;
  removed.length = 0;
  spawnExitCodes.length = 0;
  ffmpegError = null;
  vi.mocked(storage.uploadFile).mockClear();
  vi.mocked(storage.downloadToFile).mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe('timelineExport.worker — exporting an edit', () => {
  it('encodes each shot, then drops the master under the key of the edit', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([
        { shotCode: 'SH010', duration: 4, storageKey: 'media/1.mov' },
        { shotCode: 'SH020', duration: 6, storageKey: 'media/2.mov' },
      ]),
    );

    const progress = await runJob();

    expect(vi.mocked(storage.downloadToFile)).toHaveBeenCalledTimes(2);
    // Two segment encodes + one concatenation.
    expect(ffmpegCalls).toHaveLength(3);
    expect(vi.mocked(storage.uploadFile)).toHaveBeenCalledWith(
      masterKey(7),
      expect.stringContaining('master.mp4'),
      'video/mp4',
    );
    // Progress ends at 100: a finished export does not stay stuck at 90%.
    expect(progress.at(-1)).toBe(100);
  });

  it('replaces a shot without media by a card: the master lasts as long as the timeline', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([
        { shotCode: 'SH010', duration: 4, storageKey: 'media/1.mov' },
        { shotCode: 'SH020', duration: 6, storageKey: null },
      ]),
    );

    await runJob();

    // The missing shot is not skipped: it goes through the lavfi device, with its code.
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toContain('lavfi');
    expect(spawnCalls[0]?.join(' ')).toContain('SH020');
    expect(vi.mocked(storage.downloadToFile)).toHaveBeenCalledTimes(1);
  });

  it('redoes the card without text when drawtext fails, rather than losing the export', async () => {
    vi.mocked(exportPlan).mockResolvedValue(plan([{ shotCode: 'SH030', duration: 2, storageKey: null }]));
    // First attempt refused (font missing), second accepted.
    spawnExitCodes.push(1, 0);

    await runJob();

    expect(spawnCalls).toHaveLength(2);
    // The second call no longer embeds any text.
    expect(spawnCalls[0]).toContain('-vf');
    expect(spawnCalls[1]).not.toContain('-vf');
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    expect(vi.mocked(storage.uploadFile)).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty edit instead of dropping a zero-second file', async () => {
    vi.mocked(exportPlan).mockResolvedValue(plan([]));
    await expect(runJob()).rejects.toThrow(/no shot to export/);
    expect(vi.mocked(storage.uploadFile)).not.toHaveBeenCalled();
  });

  it('removes its temporary directory even when ffmpeg fails', async () => {
    vi.mocked(exportPlan).mockResolvedValue(
      plan([{ shotCode: 'SH040', duration: 3, storageKey: 'media/3.mov' }]),
    );
    ffmpegError = new Error('ffmpeg exploded');

    await expect(runJob()).rejects.toThrow(/ffmpeg exploded/);
    // The worker's `finally`: without it, every failure would leave a whole edit on disk.
    expect(removed.some((p) => p.includes('review-timeline-'))).toBe(true);
  });
});
