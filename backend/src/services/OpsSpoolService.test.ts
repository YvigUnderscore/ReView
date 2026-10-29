// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({
  config: { queue: undefined as string | undefined, state: undefined as string | undefined, stale: 90 },
}));
vi.mock('../config/env', () => ({
  env: {
    get OPS_QUEUE_DIR() {
      return config.queue;
    },
    get OPS_STATE_DIR() {
      return config.state;
    },
    get OPS_AGENT_STALE_SEC() {
      return config.stale;
    },
  },
}));
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildOrder } from '../lib/opsOrder';
import {
  activeRun,
  cancel,
  enqueue,
  isTerminal,
  listRuns,
  mechanism,
  readLog,
  readRun,
} from './OpsSpoolService';

const ID = '20260910-142233-a1b2c3';

/** A spool as the agent leaves it: queue on one side, state on the other. */
function spool(): { queue: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), 'review-ops-'));
  const queue = join(root, 'queue');
  const state = join(root, 'state');
  mkdirSync(queue);
  mkdirSync(join(state, 'runs'), { recursive: true });
  config.queue = queue;
  config.state = state;
  return { queue, state };
}

const agentFile = (state: string, extra: Record<string, unknown> = {}) =>
  writeFileSync(
    join(state, 'agent.json'),
    JSON.stringify({
      protocol: 1,
      version: '2.4.0',
      seenAt: new Date().toISOString(),
      rootOk: true,
      pollSec: 2,
      allow: { update: true, backup: true, verify: true },
      ...extra,
    }),
  );

const statusFile = (state: string, id: string, extra: Record<string, unknown> = {}) => {
  mkdirSync(join(state, 'runs', id), { recursive: true });
  writeFileSync(
    join(state, 'runs', id, 'status.json'),
    JSON.stringify({
      protocol: 1,
      id,
      kind: 'update',
      target: 'v2.4.0',
      state: 'running',
      phase: 'backup',
      heartbeatAt: new Date().toISOString(),
      ...extra,
    }),
  );
};

const order = buildOrder({
  id: ID,
  kind: 'update',
  now: new Date('2026-09-10T14:22:33Z'),
  ttlSec: 900,
  actor: { id: 3, displayName: 'ops@studio.tld' },
  version: 'v2.4.0',
});

beforeEach(() => {
  config.queue = undefined;
  config.state = undefined;
  config.stale = 90;
});

describe('mechanism', () => {
  it('says "absent" when execution is not wired up', async () => {
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent', reason: 'SPOOL_UNSET' });
  });

  it('says "absent" when the agent has never written its state', async () => {
    spool();
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent', reason: 'AGENT_NEVER_SEEN' });
  });

  it('says "ready" when the agent heartbeats and nothing is running', async () => {
    const { state } = spool();
    agentFile(state);
    await expect(mechanism()).resolves.toMatchObject({ state: 'ready', agentVersion: '2.4.0' });
  });

  it('says "silent" when the heartbeat is stale', async () => {
    const { state } = spool();
    agentFile(state, { seenAt: new Date(Date.now() - 600_000).toISOString() });
    await expect(mechanism()).resolves.toMatchObject({ state: 'stalled', reason: 'AGENT_STALE' });
  });

  it('blocks everything when the repository is not mounted on its host path', async () => {
    // `backup.sh` would then write its mirror into the void, without an error: we would only notice on the
    // day of the restore.
    const { state } = spool();
    agentFile(state, { rootOk: false });
    await expect(mechanism()).resolves.toMatchObject({ state: 'blocked', reason: 'ROOT_MISMATCH' });
  });

  it('blocks everything when the agent speaks a more recent protocol than ours', async () => {
    const { state } = spool();
    agentFile(state, { protocol: 99 });
    await expect(mechanism()).resolves.toMatchObject({ state: 'blocked', reason: 'PROTOCOL_UNSUPPORTED' });
  });

  it('says "busy" as long as an operation is running', async () => {
    const { state } = spool();
    agentFile(state);
    statusFile(state, ID);
    await expect(mechanism()).resolves.toMatchObject({ state: 'busy' });
  });

  it('stays up in front of an unreadable state', async () => {
    const { state } = spool();
    writeFileSync(join(state, 'agent.json'), '{ ceci n’est pas du JSON');
    await expect(mechanism()).resolves.toMatchObject({ state: 'absent' });
  });
});

describe('enqueue', () => {
  it('writes the order into the queue, and only there', async () => {
    const { queue, state } = spool();
    await enqueue(order);
    expect(readdirSync(queue)).toEqual([`${ID}.json`]);
    // The state belongs to the agent: this asymmetry is what prevents a compromised backend from placing a
    // symbolic link there that the agent would then follow for writing.
    expect(readdirSync(join(state, 'runs'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(queue, `${ID}.json`), 'utf8'))).toMatchObject({
      id: ID,
      kind: 'update',
    });
  });

  it('leaves no temporary file behind', async () => {
    const { queue } = spool();
    await enqueue(order);
    expect(readdirSync(queue).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refuses to write when execution is not wired up', async () => {
    await expect(enqueue(order)).rejects.toThrow();
  });
});

describe('listRuns and activeRun', () => {
  it('gathers the pending orders and the known runs, most recent first', async () => {
    const { state } = spool();
    await enqueue(order);
    statusFile(state, '20260909-100000-000001', { state: 'succeeded', phase: 'done', endedAt: 'x' });
    const runs = await listRuns();
    expect(runs.map((r) => r.id)).toEqual([ID, '20260909-100000-000001']);
    // The order is re-read: between the click and the agent's pickup, the screen must say WHAT it is — not
    // "unknown operation" to the person who just launched it.
    expect(runs[0]).toMatchObject({
      state: 'queued',
      kind: 'update',
      target: 'v2.4.0',
      requestedBy: { id: 3, displayName: 'ops@studio.tld' },
    });
  });

  it('considers a run whose agent no longer heartbeats as "no news"', async () => {
    // Without this rule, the screen would show endless progress for a dead agent.
    const { state } = spool();
    statusFile(state, ID, { heartbeatAt: new Date(Date.now() - 600_000).toISOString() });
    await expect(readRun(ID)).resolves.toMatchObject({ state: 'unknown' });
    await expect(activeRun()).resolves.toBeNull();
  });

  it('only lets one cancel as long as nothing has been switched', async () => {
    const { state } = spool();
    statusFile(state, ID, { phase: 'backup' });
    expect((await readRun(ID))?.cancellable).toBe(true);
    statusFile(state, ID, { phase: 'switch' });
    expect((await readRun(ID))?.cancellable).toBe(false);
  });

  it('refuses an identifier that is not one', async () => {
    spool();
    await expect(readRun('../../etc')).resolves.toBeNull();
    await expect(cancel('../../etc')).rejects.toThrow();
  });

  it('drops the cancellation sentinel into the queue, never into the state', async () => {
    const { queue, state } = spool();
    await cancel(ID);
    expect(readdirSync(queue)).toEqual([`${ID}.cancel`]);
    expect(readdirSync(join(state, 'runs'))).toEqual([]);
  });
});

describe('readLog', () => {
  it('serves the log by byte offset — this is what survives a restart', async () => {
    const { state } = spool();
    mkdirSync(join(state, 'runs', ID), { recursive: true });
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'première ligne\n');

    const first = await readLog(ID, 0);
    expect(first.text).toBe('première ligne\n');
    expect(first.truncated).toBe(false);

    // The file is only ever appended to: resuming at the cursor gives exactly the continuation.
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'première ligne\nseconde ligne\n');
    const second = await readLog(ID, first.next);
    expect(second.text).toBe('seconde ligne\n');
    expect(second.from).toBe(first.next);
  });

  it('redacts secrets before serving', async () => {
    const { state } = spool();
    mkdirSync(join(state, 'runs', ID), { recursive: true });
    writeFileSync(join(state, 'runs', ID, 'output.log'), 'url=postgresql://review:hunter2222@db:5432/x\n');
    expect((await readLog(ID, 0)).text).not.toContain('hunter2222');
  });

  it('returns an empty log rather than an error when there is none', async () => {
    spool();
    await expect(readLog(ID, 0)).resolves.toMatchObject({ text: '', next: 0 });
  });
});

describe('isTerminal', () => {
  it('distinguishes what will still move from what has been played', () => {
    for (const state of ['queued', 'running'] as const) expect(isTerminal(state), state).toBe(false);
    for (const state of [
      'succeeded',
      'rolled-back',
      'failed',
      'cancelled',
      'expired',
      'rejected',
      'unknown',
    ] as const) {
      expect(isTerminal(state), state).toBe(true);
    }
  });
});
