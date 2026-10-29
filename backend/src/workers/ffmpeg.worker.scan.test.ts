// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Traceability of the antivirus scan (A4-04).
 *
 * A `kind: 'scan'` job concerns a media already READY and already downloadable: its failure changes nothing for the media, it is the only path where the antivirus conditions nothing. It must therefore
 * leave a trace in both directions — otherwise a file never scanned (clamd restarted during the upload window) is strictly indistinguishable from a scanned and clean file.
 */

/**
 * Processors handed to BullMQ when the module loads, per queue. The module registers several (storage cleanup, webhooks, ShotGrid...): we keep only the one of the
 * media queue, it is the one we exercise.
 */
const { processors } = vi.hoisted(() => ({
  processors: new Map<string, (job: unknown) => Promise<unknown>>(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      readonly name: string,
      proc: (job: unknown) => Promise<unknown>,
      readonly opts: unknown,
    ) {
      processors.set(name, proc);
    }
    on() {
      return this;
    }
    run() {
      return Promise.resolve();
    }
  },
  Queue: class {
    add() {
      return Promise.resolve({});
    }
  },
  QueueEvents: class {
    on() {
      return this;
    }
  },
}));

vi.mock('../lib/redis', () => ({
  redisConnectionOptions: {},
  redis: { on: vi.fn(), quit: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    mediaObject: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('../services/StorageService', () => ({
  storage: {
    downloadToFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    copyObject: vi.fn().mockResolvedValue(undefined),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  },
  StorageService: { thumbnailKey: (id: number, ext: string) => `derived/${id}/thumbnail.${ext}` },
}));

vi.mock('../lib/clamav', () => ({
  isClamavEnabled: vi.fn(() => true),
  scanFile: vi.fn(),
}));

vi.mock('../lib/workerEvents', () => ({
  publishWorkerEvent: vi.fn(),
  closeWorkerEvents: vi.fn(),
}));

// Partial mock: other modules loaded along the way read the retention constants.
vi.mock('../services/AuditService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logAudit: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import './ffmpeg.worker';
import { prisma } from '../lib/prisma';
import { scanFile } from '../lib/clamav';

const MEDIA_ID = 77;

/** Media without a processing job (GLB, splat): READY as soon as it is finalized. */
function media(metadata: Record<string, unknown> = {}) {
  return {
    id: MEDIA_ID,
    kind: 'MODEL_3D',
    originalName: 'hero.glb',
    storageKey: 'projects/p/v/77/hero.glb',
    status: 'READY',
    metadata,
    imageSequence: null,
  };
}

/** Metadata written by the last `update` on the media. */
function lastWrittenMetadata(): Record<string, unknown> {
  const calls = vi.mocked(prisma.mediaObject.update).mock.calls;
  return (calls.at(-1)![0] as { data: { metadata: Record<string, unknown> } }).data.metadata;
}

/** The processor of the media queue, registered when the module is imported. */
const runJob = (): Promise<unknown> =>
  processors.get('media-processing')!({
    data: { mediaObjectId: MEDIA_ID, kind: 'scan' },
        // The progress reporter chains a `.catch` on this return value.
    updateProgress: () => Promise.resolve(),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(media() as never);
  vi.mocked(prisma.mediaObject.update).mockResolvedValue({} as never);
});

describe('"scan" job: the verdict is written on the media', () => {
  it('records the scan date when clamd returns a clean verdict', async () => {
    vi.mocked(scanFile).mockResolvedValue({ clean: true, virus: null });
    await runJob();
    expect(typeof lastWrittenMetadata().scannedAt).toBe('string');
  });

  it('clears a failure mark that the successful attempt has just caught up with', async () => {
    vi.mocked(prisma.mediaObject.findUnique).mockResolvedValue(
      media({ scanFailed: 'clamd: connection closed', scanFailedAt: '2026-09-16T09:00:00.000Z' }) as never,
    );
    vi.mocked(scanFile).mockResolvedValue({ clean: true, virus: null });
    await runJob();
    const written = lastWrittenMetadata();
    expect(written.scanFailed).toBeUndefined();
    expect(written.scanFailedAt).toBeUndefined();
  });

  it('records the reason on the media when clamd is unreachable', async () => {
        // The case that left the media READY, downloadable and silent: the job exhausted its attempts in thirty-five seconds and vanished without writing a line.
    vi.mocked(scanFile).mockRejectedValue(new Error('connect ECONNREFUSED clamav:3310'));
    await expect(runJob()).rejects.toThrow('ECONNREFUSED');
    const written = lastWrittenMetadata();
    expect(written.scanFailed).toContain('ECONNREFUSED');
    expect(typeof written.scanFailedAt).toBe('string');
    expect(written.scannedAt).toBeUndefined();
  });

  it('never sets the media to FAILED on a scan in error', async () => {
        // The file is clean until proven otherwise: only a DETECTION sets FAILED.
    vi.mocked(scanFile).mockRejectedValue(new Error('clamd: scan timed out'));
    await expect(runJob()).rejects.toThrow();
    const calls = vi.mocked(prisma.mediaObject.update).mock.calls;
    for (const [args] of calls) {
      expect((args as { data: { status?: string } }).data.status).toBeUndefined();
    }
  });
});
