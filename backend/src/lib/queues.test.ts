// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeAll, describe, expect, it, vi } from 'vitest';

// No Redis connection in a unit test: only the declaration of the queues interests us (their name, their
// metric label and their completeness).
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(public readonly name: string) {}
  },
}));

// Deferred import (and not a top-level `await`, forbidden by the project's TS target): the bullmq mock must
// be in place before the module declares its queues.
let mod: typeof import('./JobService');
beforeAll(async () => {
  mod = await import('./JobService');
});

describe('queue declarations', () => {
  it('the seven queues are labelled, none escapes the metrics', () => {
    expect(Object.keys(mod.QUEUE_LABELS).sort()).toEqual([
      'maintenance',
      'media',
      'shotgrid',
      'spatial-thumb',
      'storage-cleanup',
      'timeline-export',
      'webhooks',
    ]);
    expect(mod.ALL_QUEUES).toHaveLength(7);
  });

  it('every queue declared in QUEUE_NAMES is labelled', () => {
    const declared = Object.values(mod.QUEUE_NAMES);
    const labelled = mod.ALL_QUEUES.map(([, q]) => (q as unknown as { name: string }).name);
    for (const name of declared) expect(labelled).toContain(name);
  });

  it('the historical label "media" is preserved (Grafana dashboard and operations documentation)', () => {
    // The queue name is `media-processing`, but Prometheus has always exposed queue="media": renaming it
    // would break the existing queries and alerts.
    expect(mod.QUEUE_NAMES.MEDIA).toBe('media-processing');
    const media = mod.ALL_QUEUES.find(([label]) => label === 'media');
    expect((media?.[1] as unknown as { name: string }).name).toBe('media-processing');
  });

  it('the edit export identifier remains deterministic (double click has no effect)', () => {
    expect(mod.timelineExportJobId(42)).toBe('timeline-42');
  });

  it('the spatial thumbnail identifier is deterministic (a single render in flight per media)', () => {
    expect(mod.spatialThumbJobId(7)).toBe('spatial-thumb-7');
  });
});
