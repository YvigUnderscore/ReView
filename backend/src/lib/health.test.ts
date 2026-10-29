// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createReadinessCache, failureReason, runChecks, timedCheck, type ReadinessReport } from './health';
describe('timedCheck', () => {
  it('reports a success with its duration', async () => {
    let clock = 1_000;
    const result = await timedCheck(
      () => Promise.resolve('ok'),
      50,
      () => (clock += 5),
    );
    expect(result.ok).toBe(true);
    expect(result.ms).toBe(5);
  });

  it('fails cleanly instead of hanging when the dependency never answers', async () => {
    const result = await timedCheck(() => new Promise(() => undefined), 10);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('bounds the failure reason (a raw message may carry a connection URL)', () => {
    expect(failureReason(new Error('x'.repeat(500)))).toHaveLength(120);
    expect(failureReason('pas une erreur')).toBe('unavailable');
  });
});

describe('runChecks', () => {
  it('declares the whole unavailable as soon as one check fails', async () => {
    const report = await runChecks(
      {
        up: () => Promise.resolve(1),
        down: () => Promise.reject(new Error('connection refused')),
      },
      50,
    );
    expect(report.ok).toBe(false);
    expect(report.checks.up?.ok).toBe(true);
    expect(report.checks.down?.error).toBe('connection refused');
  });
});

describe('createReadinessCache', () => {
  const ok: ReadinessReport = { ok: true, checks: {} };

  it('groups concurrent calls into a single execution', async () => {
    const run = vi.fn().mockResolvedValue(ok);
    const cached = createReadinessCache(run, 1_000);
    await Promise.all([cached(), cached(), cached()]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('queries again once the validity period has elapsed', async () => {
    let clock = 0;
    const run = vi.fn().mockResolvedValue(ok);
    const cached = createReadinessCache(run, 100, () => clock);
    await cached();
    clock = 50;
    const second = await cached();
    expect(second.cached).toBe(true);
    clock = 200;
    const third = await cached();
    expect(third.cached).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
