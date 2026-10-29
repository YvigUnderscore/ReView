// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file: the double must be too.
const { emitToProject, isWorkerProcess, publishWorkerEvent } = vi.hoisted(() => ({
  emitToProject: vi.fn(),
    // By default we sit in the web process: that is the path these cases describe.
  isWorkerProcess: vi.fn(() => false),
  publishWorkerEvent: vi.fn(),
}));
vi.mock('../SocketService', () => ({
  emitToProject: (...a: unknown[]) => emitToProject(...a),
  isWorkerProcess: () => isWorkerProcess(),
}));
vi.mock('../../lib/workerEvents', () => ({
  publishWorkerEvent: (...a: unknown[]) => publishWorkerEvent(...a),
}));

import { DETAIL_LIMIT, flushTouched, TouchedEntities } from './ShotgridTouched';

beforeEach(() => vi.clearAllMocks());

/**
 * A full pass used to emit one socket event per entity — up to twelve thousand, which the client then multiplied by five invalidations. The collector decides at the
 * end of the pass: detail while the pass stays small, summary beyond.
 */
describe('TouchedEntities', () => {
  it('replays the detail of a targeted pass', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('task', 7, { shotId: 12, assetId: null });

    expect(touched.detailed).toBe(true);
    expect(touched.detail()).toEqual([
      { kind: 'shot', id: 12 },
      { kind: 'task', id: 7, extra: { shotId: 12, assetId: null } },
    ]);
    expect(touched.summary()).toEqual({ counts: { shot: 1, task: 1 }, total: 2, detailed: true });
  });

  it('counts an entity touched twice only once', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('shot', 12, { ignored: true });

    expect(touched.total).toBe(1);
    expect(touched.detail()).toHaveLength(1);
  });

  it('tells apart two families carrying the same identifier', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 5);
    touched.add('task', 5);
    expect(touched.summary().counts).toEqual({ shot: 1, task: 1 });
  });

  it('drops the detail beyond the threshold and keeps only the count', () => {
    const touched = new TouchedEntities();
    for (let i = 0; i <= DETAIL_LIMIT; i += 1) touched.add('shot', i);

    expect(touched.total).toBe(DETAIL_LIMIT + 1);
    expect(touched.detailed).toBe(false);
        // Nothing to replay: this is precisely the burst we are removing.
    expect(touched.detail()).toEqual([]);
    expect(touched.summary().counts).toEqual({ shot: DETAIL_LIMIT + 1 });
  });

  it('counts notes and playlists without inventing a fine-grained event for them', () => {
        // The client listens to nothing for these two families: they only travel as a count, and it is that count which tells it to reload comments and sessions.
    const touched = new TouchedEntities();
    touched.add('comment', 3);
    touched.add('playlist', 4);

    expect(touched.detail()).toEqual([]);
    expect(touched.summary()).toEqual({
      counts: { comment: 1, playlist: 1 },
      total: 2,
      detailed: true,
    });
  });

  it('returns an empty summary when the pass touched nothing', () => {
    const touched = new TouchedEntities();
    expect(touched.summary()).toEqual({ counts: {}, total: 0, detailed: true });
  });
});

/**
 * Emission contract, on which the client's socket bridge relies: `detailed` says whether the fine-grained events have already been sent, hence whether the client must reload broadly.
 */
describe('flushTouched', () => {
  it('replays the detail then announces a "detailed" summary', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('task', 7, { shotId: 12, assetId: null });
    touched.add('comment', 3);

    flushTouched(42, 900, 'ok', touched);

    expect(emitToProject).toHaveBeenNthCalledWith(1, 42, 'shot:update', { projectId: 42, id: 12 });
    expect(emitToProject).toHaveBeenNthCalledWith(2, 42, 'task:update', {
      projectId: 42,
      id: 7,
      shotId: 12,
      assetId: null,
    });
    expect(emitToProject).toHaveBeenNthCalledWith(3, 42, 'shotgrid:sync', {
      projectId: 42,
      runId: 900,
      status: 'ok',
      counts: { shot: 1, task: 1, comment: 1 },
      total: 3,
      detailed: true,
    });
  });

  it('emits only a summary when the pass overflowed', () => {
        // This is the fix: a full pass no longer sends twelve thousand events.
    const touched = new TouchedEntities();
    for (let i = 0; i <= DETAIL_LIMIT; i += 1) touched.add('shot', i);

    flushTouched(42, 900, 'ok', touched);

    expect(emitToProject).toHaveBeenCalledTimes(1);
    expect(emitToProject).toHaveBeenCalledWith(42, 'shotgrid:sync', {
      projectId: 42,
      runId: 900,
      status: 'ok',
      counts: { shot: DETAIL_LIMIT + 1 },
      total: DETAIL_LIMIT + 1,
      detailed: false,
    });
  });

  it('announces even a pass that touched nothing: the client follows the run state', () => {
    flushTouched(42, 901, 'error', new TouchedEntities());

    expect(emitToProject).toHaveBeenCalledTimes(1);
    expect(emitToProject).toHaveBeenCalledWith(42, 'shotgrid:sync', {
      projectId: 42,
      runId: 901,
      status: 'error',
      counts: {},
      total: 0,
      detailed: true,
    });
  });
});

/**
 * The ShotGrid synchronization runs in the worker process, where `io` does not exist: `emitToProject` was a silent no-op there and no screen refreshed after a pass.
 * The worker must go through the Redis channel, which the server relays.
 */
describe('flushTouched: depending on the process', () => {
  it('emits directly from the web process', () => {
    isWorkerProcess.mockReturnValue(false);
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    flushTouched(461, 1, 'ok', touched);
    expect(emitToProject).toHaveBeenCalled();
    expect(publishWorkerEvent).not.toHaveBeenCalled();
  });

  it('publishes on the Redis channel from the worker', () => {
    isWorkerProcess.mockReturnValue(true);
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    flushTouched(461, 1, 'ok', touched);
    expect(emitToProject).not.toHaveBeenCalled();
    expect(publishWorkerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project', projectId: 461, event: 'shotgrid:sync' }),
    );
  });
});
