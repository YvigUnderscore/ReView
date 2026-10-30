// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted to the top of the file: the doubles must be too.
const { emitToProject } = vi.hoisted(() => ({ emitToProject: vi.fn() }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({
  mapSgToLocal: vi.fn(),
  removeLink: vi.fn(),
  findByLocal: vi.fn(),
  findBySg: vi.fn(),
  upsertLink: vi.fn(),
}));
vi.mock('../SocketService', () => ({ emitToProject: (...a: unknown[]) => emitToProject(...a) }));

import { touch, type PullContext } from './ShotgridPullService';
import { TouchedEntities } from './ShotgridTouched';

function context(touched?: TouchedEntities): PullContext {
  return { connection: { id: 1, projectId: 7 }, touched } as unknown as PullContext;
}

beforeEach(() => vi.clearAllMocks());

/**
 * The collector is optional: an orchestrated pass supplies it and empties the accumulator at the end of the run; an isolated caller (manual import of versions)
 * has nobody to do it — so it must go on emitting right away.
 */
describe('touch', () => {
  it('accumulates instead of emitting when the pass is orchestrated', () => {
    const touched = new TouchedEntities();
    touch(context(touched), 'shot', 12);

    expect(emitToProject).not.toHaveBeenCalled();
    expect(touched.detail()).toEqual([{ kind: 'shot', id: 12 }]);
  });

  it('emits right away without a collector', () => {
    touch(context(), 'task', 5, { shotId: 12, assetId: null });

    expect(emitToProject).toHaveBeenCalledWith(7, 'task:update', {
      projectId: 7,
      id: 5,
      shotId: 12,
      assetId: null,
    });
  });

  it('does not invent an event for the families the client does not listen to', () => {
    touch(context(), 'comment', 555);
    touch(context(), 'playlist', 60);
    expect(emitToProject).not.toHaveBeenCalled();
  });
});
