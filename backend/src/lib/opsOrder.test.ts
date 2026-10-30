// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  BACKUP_STAMP,
  CANCELLABLE_PHASES,
  RUN_ID,
  VERSION_TAG,
  buildOrder,
  clampSeconds,
  newRunId,
  statusSchema,
} from './opsOrder';

describe('protocol filters', () => {
  it('accepts a version tag, and nothing resembling one', () => {
    for (const good of ['v2.4.0', 'v2.10.3', 'v3.0.0-rc.1', 'v2.4.0-beta.2']) {
      expect(VERSION_TAG.test(good), good).toBe(true);
    }
    // Each of these values would end up as an argument of `git checkout` or `docker compose`.
    for (const bad of [
      'v2.4.0; rm -rf /',
      'v2.4.0 && curl evil',
      '../../etc/passwd',
      '-v2.4.0',
      'latest',
      'v2.4',
      'v2.4.0\nv1.0.0',
      '$(id)',
      '`id`',
      'v2.4.0 ',
    ]) {
      expect(VERSION_TAG.test(bad), bad).toBe(false);
    }
  });

  it('accepts a backup identifier, which is a folder name', () => {
    expect(BACKUP_STAMP.test('20260910-030000')).toBe(true);
    for (const bad of ['20260910', '../backups', '20260910-030000/..', '2026091-030000']) {
      expect(BACKUP_STAMP.test(bad), bad).toBe(false);
    }
  });

  it('accepts a run identifier, which is also a folder name', () => {
    expect(RUN_ID.test('20260910-142233-a1b2c3')).toBe(true);
    for (const bad of ['20260910-142233', '20260910-142233-A1B2C3', '20260910-142233-a1b2c3/..', '..']) {
      expect(RUN_ID.test(bad), bad).toBe(false);
    }
  });
});

describe('newRunId', () => {
  it('timestamps — hence sorts — and yields two distinct orders for the same instant', () => {
    const at = new Date(2026, 8, 10, 14, 22, 33);
    expect(newRunId(at, () => 'a1b2c3')).toBe('20260910-142233-a1b2c3');
    expect(RUN_ID.test(newRunId(at))).toBe(true);
    expect(newRunId(at)).not.toBe(newRunId(at));
  });

  it('sorts the identifiers in time order', () => {
    const early = newRunId(new Date(2026, 8, 10, 9, 5, 0), () => 'ffffff');
    const late = newRunId(new Date(2026, 8, 10, 14, 22, 33), () => '000000');
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe('clampSeconds', () => {
  it('bounds, truncates, and refuses what is not a number', () => {
    expect(clampSeconds(600, 60, 3600)).toBe(600);
    expect(clampSeconds(5, 60, 3600)).toBe(60);
    expect(clampSeconds(99_999, 60, 3600)).toBe(3600);
    expect(clampSeconds(60.9, 60, 3600)).toBe(60);
    expect(clampSeconds(Number.NaN, 60, 3600)).toBe(60);
    expect(clampSeconds(Number.POSITIVE_INFINITY, 60, 3600)).toBe(60);
  });
});

describe('buildOrder', () => {
  const now = new Date('2026-09-10T14:22:33.000Z');
  const actor = { id: 3, displayName: 'ops@studio.tld' };

  it('returns a complete, bounded and dated order', () => {
    const order = buildOrder({
      id: '20260910-142233-a1b2c3',
      kind: 'update',
      now,
      ttlSec: 900,
      actor,
      version: 'v2.4.0',
    });
    expect(order).toMatchObject({
      protocol: 1,
      kind: 'update',
      createdAt: '2026-09-10T14:22:33.000Z',
      expiresAt: '2026-09-10T14:37:33.000Z',
      actor,
    });
    expect(order.params).toEqual({
      version: 'v2.4.0',
      backupId: null,
      skipBackup: false,
      readyTimeoutSec: 600,
      maxRuntimeSec: 3600,
    });
  });

  it('bounds the durations whatever is passed to it', () => {
    // `readyTimeoutSec` lands in "$(( SECONDS + READY_TIMEOUT ))", where bash re-evaluates the content of the variable.
    // This is the first of the three filtering passes.
    const order = buildOrder({
      id: '20260910-142233-a1b2c3',
      kind: 'backup',
      now,
      ttlSec: 10,
      actor,
      readyTimeoutSec: 10_000_000,
      maxRuntimeSec: -5,
    });
    expect(order.params.readyTimeoutSec).toBe(3600);
    expect(order.params.maxRuntimeSec).toBe(60);
    // A TTL is bounded too: an order valid for ten seconds would never reach the agent.
    expect(order.expiresAt).toBe('2026-09-10T14:23:33.000Z');
  });
});

describe('CANCELLABLE_PHASES', () => {
  it('only lets cancellation happen as long as nothing has been switched over', () => {
    // Killing the script after the switchover would leave the stack half recreated, and the automatic rollback — the
    // only safety promise of the command — would not have taken place.
    for (const phase of ['queued', 'precheck', 'backup'])
      expect(CANCELLABLE_PHASES.has(phase), phase).toBe(true);
    for (const phase of ['switch', 'health', 'rollback', 'done']) {
      expect(CANCELLABLE_PHASES.has(phase), phase).toBe(false);
    }
  });
});

describe('statusSchema', () => {
  it('reads a minimal status — an older agent does not have every field', () => {
    const parsed = statusSchema.safeParse({ id: 'x', kind: 'update', state: 'running' });
    expect(parsed.success).toBe(true);
  });

  it('ignores what it does not know — the protocol only evolves additively', () => {
    const parsed = statusSchema.safeParse({ id: 'x', kind: 'update', state: 'running', futurChamp: 42 });
    expect(parsed.success).toBe(true);
  });

  it('refuses a status without an identity', () => {
    expect(statusSchema.safeParse({ kind: 'update', state: 'running' }).success).toBe(false);
  });
});
