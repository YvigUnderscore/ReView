// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import {
  agentSchema,
  CANCELLABLE_PHASES,
  OPS_PROTOCOL,
  RUN_ID,
  queuedOrderSchema,
  statusSchema,
  type OpsOrder,
  type RunState,
} from '../lib/opsOrder';
import { redactSecrets } from '../lib/opsRedact';

/**
 * The only module of the application that touches the operations agent's spool.
 *
 * It **writes** to the order queue and **reads** the state — never the reverse. The two paths are mounted
 * separately (`ops/queue` for writing, `ops/state` read-only) and this
 * asymmetry is the real barrier: the backend is reachable from the internet and runs as root; if it could
 * write into the state, it could place a symbolic link there that the
 * agent — which holds the docker socket — would then follow for writing.
 *
 * None of this lives in the database: the state of an operation must survive the container that requested it
 * (that is the one we destroy), and be read back later from a backend
 * of ANOTHER version. Nor may a database restore rewind the trace of the operation that caused it.
 */

/** What the screen needs in order to talk about a run. */
export interface RunSummary {
  id: string;
  kind: string;
  target: string | null;
  state: RunState;
  phase: string | null;
  reason: string | null;
  requestedBy: { id: number; displayName: string } | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  backupId: string | null;
  agentVersion: string | null;
  /**
   * The restore command matching this run's backup, when there is one. Composed here and not on screen: a
   * shell line belongs to the module that knows the scripts, and text assembled in a component would escape
   * the frontend's hard-coded string check.
   */
  restoreCommand: string | null;
  /** Does cancelling still make sense? False as soon as the switch-over has begun. */
  cancellable: boolean;
}

export type MechanismState = 'absent' | 'ready' | 'busy' | 'stalled' | 'blocked';

export interface Mechanism {
  state: MechanismState;
  /** SPOOL_UNSET · AGENT_NEVER_SEEN · AGENT_STALE · ROOT_MISMATCH · PROTOCOL_UNSUPPORTED */
  reason: string | null;
  protocol: number | null;
  agentVersion: string | null;
  seenAt: string | null;
  allow: { update: boolean; backup: boolean; verify: boolean };
}

/** A terminal state will no longer move: the screen stops polling. */
const TERMINAL: ReadonlySet<RunState> = new Set<RunState>([
  'succeeded',
  'rolled-back',
  'failed',
  'cancelled',
  'expired',
  'rejected',
  'unknown',
]);

export const isTerminal = (state: RunState): boolean => TERMINAL.has(state);

/** What is served from a log at once: beyond that, one paginates by byte offset. */
const LOG_CHUNK_BYTES = 256 * 1024;
/** Runs listed: the screen shows ten, the folded history twenty. */
const MAX_RUNS = 20;

const NO_ALLOW = { update: false, backup: false, verify: false };

/** The two paths, or `null` if the run is not wired up on this instance. */
function dirs(): { queue: string; state: string } | null {
  if (!env.OPS_QUEUE_DIR || !env.OPS_STATE_DIR) return null;
  return { queue: env.OPS_QUEUE_DIR, state: env.OPS_STATE_DIR };
}

export const isEnabled = (): boolean => dirs() !== null;

/** Seconds elapsed since an ISO timestamp; `Infinity` if it is unreadable or absent. */
function secondsSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : (Date.now() - at) / 1000;
}

/** Reads a JSON written by the agent. Unreadable or malformed: `null`, never an exception. */
async function readJson<T>(
  path: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
) {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const result = schema.safeParse(parsed);
    return result.success ? (result.data as T) : null;
  } catch {
    return null;
  }
}

/** Turns a `status.json` into a summary, settling the cases the agent does not settle itself. */
function summarize(status: NonNullable<Awaited<ReturnType<typeof readStatus>>>): RunSummary {
  let state = status.state as RunState;
  // A "running" run whose agent no longer heartbeats is not running: it is without news.
  // Without this rule, the screen would show endless progress for a dead agent.
  if (
    (state === 'running' || state === 'queued') &&
    secondsSince(status.heartbeatAt) > env.OPS_AGENT_STALE_SEC
  ) {
    state = 'unknown';
  }
  return {
    id: status.id,
    kind: status.kind,
    target: status.target ?? null,
    state,
    phase: status.phase ?? null,
    reason: status.reason ?? null,
    requestedBy: status.actor ?? null,
    startedAt: status.startedAt ?? null,
    endedAt: status.endedAt ?? null,
    exitCode: status.exitCode ?? null,
    backupId: status.backupId ?? null,
    agentVersion: status.agentVersion ?? null,
    restoreCommand: status.backupId ? `bash scripts/restore.sh db backups/${status.backupId}` : null,
    cancellable: state === 'running' && CANCELLABLE_PHASES.has(status.phase ?? 'queued'),
  };
}

const readStatus = (dir: string, id: string) => readJson(join(dir, 'runs', id, 'status.json'), statusSchema);

/** The agent's state, and what it agrees to execute. */
export async function mechanism(): Promise<Mechanism> {
  const paths = dirs();
  if (!paths) {
    return {
      state: 'absent',
      reason: 'SPOOL_UNSET',
      protocol: null,
      agentVersion: null,
      seenAt: null,
      allow: NO_ALLOW,
    };
  }
  const agent = await readJson(join(paths.state, 'agent.json'), agentSchema);
  if (!agent) {
    return {
      state: 'absent',
      reason: 'AGENT_NEVER_SEEN',
      protocol: null,
      agentVersion: null,
      seenAt: null,
      allow: NO_ALLOW,
    };
  }

  const allow = { ...NO_ALLOW, ...(agent.allow ?? {}) };
  const base = { protocol: agent.protocol, agentVersion: agent.version ?? null, seenAt: agent.seenAt, allow };

  if (secondsSince(agent.seenAt) > env.OPS_AGENT_STALE_SEC) {
    return { ...base, state: 'stalled', reason: 'AGENT_STALE' };
  }
  // The repository is not mounted on its host path: `backup.sh` would write its mirror into the void, without
  // an error. A clean refusal is better than an imaginary backup.
  if (agent.rootOk === false) return { ...base, state: 'blocked', reason: 'ROOT_MISMATCH' };
  if (agent.protocol > OPS_PROTOCOL) return { ...base, state: 'blocked', reason: 'PROTOCOL_UNSUPPORTED' };
  if ((await activeRun()) !== null) return { ...base, state: 'busy', reason: null };
  return { ...base, state: 'ready', reason: null };
}

/** Drops an order. Temporary write then rename: the agent never reads half a JSON. */
export async function enqueue(order: OpsOrder): Promise<void> {
  const paths = dirs();
  if (!paths) throw new Error('OPS spool disabled');
  const target = join(paths.queue, `${order.id}.json`);
  const tmp = join(paths.queue, `.${order.id}.json.tmp`);
  await writeFile(tmp, JSON.stringify(order), { mode: 0o600 });
  await rename(tmp, target);
  logger.info({ runId: order.id, kind: order.kind }, '[Ops] ordre déposé');
}

/**
 * Requests cancellation. It is a SENTINEL, not an order: the agent reads it if it is still at a stage where
 * abandoning breaks nothing, and ignores it once the switch-over has begun.
 */
export async function cancel(runId: string): Promise<void> {
  const paths = dirs();
  if (!paths || !RUN_ID.test(runId)) throw new Error('OPS spool disabled');
  await writeFile(join(paths.queue, `${runId}.cancel`), '', { mode: 0o600 });
}

/** The deposited orders that the agent has not yet picked up. */
async function queuedRuns(paths: { queue: string; state: string }): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = (await readdir(paths.queue)).filter((n) => n.endsWith('.json') && RUN_ID.test(n.slice(0, -5)));
  } catch {
    return [];
  }
  // The order is re-read to say WHAT it is. Without this, the screen would announce an "unknown" operation
  // between the click and the agent's pickup — a few seconds during which the person who just
  // launched a backup reads that nobody knows what is running. The queue is the backend's only write surface:
  // it is re-read there.
  const orders = await Promise.all(names.map((name) => readJson(join(paths.queue, name), queuedOrderSchema)));

  return names.map((name, index) => {
    const order = orders[index];
    return {
      id: order?.id ?? name.slice(0, -5),
      kind: order?.kind ?? 'unknown',
      target: order?.params?.version ?? order?.params?.backupId ?? null,
      state: 'queued',
      phase: 'queued',
      reason: null,
      requestedBy: order?.actor ?? null,
      startedAt: order?.createdAt ?? null,
      endedAt: null,
      exitCode: null,
      backupId: null,
      agentVersion: null,
      restoreCommand: null,
      cancellable: true,
    };
  });
}

/** Known runs, most recent first (the identifier is timestamped, hence sortable). */
export async function listRuns(limit = MAX_RUNS): Promise<RunSummary[]> {
  const paths = dirs();
  if (!paths) return [];

  let ids: string[];
  try {
    ids = (await readdir(join(paths.state, 'runs'), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && RUN_ID.test(e.name))
      .map((e) => e.name);
  } catch {
    ids = [];
  }

  const done = (await Promise.all(ids.map((id) => readStatus(paths.state, id))))
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map(summarize);

  // An order still in the queue has no status: it comes from the other source. The two sets do not overlap —
  // the agent deletes the queue file when it picks it up.
  const known = new Set(done.map((r) => r.id));
  const pending = (await queuedRuns(paths)).filter((r) => !known.has(r.id));

  return [...done, ...pending].sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
}

/** The running operation, if there is one. It is that which locks the buttons. */
export async function activeRun(): Promise<RunSummary | null> {
  const runs = await listRuns(MAX_RUNS);
  return runs.find((r) => r.state === 'queued' || r.state === 'running') ?? null;
}

export async function readRun(id: string): Promise<RunSummary | null> {
  const paths = dirs();
  if (!paths || !RUN_ID.test(id)) return null;
  const status = await readStatus(paths.state, id);
  if (status) return summarize(status);
  return (await queuedRuns(paths)).find((r) => r.id === id) ?? null;
}

/**
 * A slice of the log, from a byte offset.
 *
 * The file is written in APPEND-only mode — this is what makes the offset reliable across a backend restart,
 * and therefore what lets the screen resume its reading where it was after an update interrupted it.
 */
export async function readLog(
  id: string,
  from = 0,
): Promise<{ from: number; next: number; text: string; truncated: boolean }> {
  const paths = dirs();
  const empty = { from: 0, next: 0, text: '', truncated: false };
  if (!paths || !RUN_ID.test(id)) return empty;

  const path = join(paths.state, 'runs', id, 'output.log');
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return empty;
  }

  const start = Math.min(Math.max(0, Math.trunc(from)), size);
  const length = Math.min(size - start, LOG_CHUNK_BYTES);
  if (length <= 0) return { from: start, next: size, text: '', truncated: false };

  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return {
      from: start,
      next: start + bytesRead,
      // Redacted HERE, as close to the output as possible: the script never has to know the list of secrets,
      // and a `sed` built on a password would break on the first special character.
      text: redactSecrets(buffer.subarray(0, bytesRead).toString('utf8')),
      truncated: start + bytesRead < size,
    };
  } finally {
    await handle.close();
  }
}
