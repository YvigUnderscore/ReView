// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * The protocol between the application and the operations agent: the shape of an order, that of a status, and the
 * filters that neither of them crosses.
 *
 * **Pure** module: no disk access, no dependency on the environment. What it contains is tested without mounting anything,
 * and that is deliberate — this is where the difference between "a version tag" and "a command line" is decided.
 *
 * ── Evolution rule ──
 * The protocol evolves only **additively**: a new field, never a renamed or removed one. An agent and a backend are not
 * updated at the same instant — during a switchover, it is even precisely the reverse — and the backend of version N+1
 * must reread the status of a run launched by the agent of version N.
 */

/** Protocol version understood by this backend. */
export const OPS_PROTOCOL = 1;

/** Publishable version tag, the same form as the one that triggers `release.yml`. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
/** Name of a backup folder, as `backup.sh` composes it. */
export const BACKUP_STAMP = /^\d{8}-\d{6}$/;
/** Run identifier: timestamp + six hexadecimal digits. It is a FOLDER NAME. */
export const RUN_ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** The three commandable operations. There is no fourth one, and certainly no free one. */
export const OPS_KINDS = ['update', 'backup', 'verify'] as const;
export type OpsKind = (typeof OPS_KINDS)[number];

/** Possible states of a run, from the deposit of the order to the verdict. */
export const RUN_STATES = [
  'queued',
  'running',
  'succeeded',
  'rolled-back',
  'failed',
  'cancelled',
  'expired',
  'rejected',
  'unknown',
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Milestones emitted by `scripts/update.sh` (`OPS_PHASE=`). */
export const RUN_PHASES = ['queued', 'precheck', 'backup', 'switch', 'health', 'rollback', 'done'] as const;

/**
 * Beyond this milestone, the switchover is committed: cancelling undoes nothing and would leave the stack in a state
 * nobody can describe. The agent also refuses on its side.
 */
export const CANCELLABLE_PHASES = new Set<string>(['queued', 'precheck', 'backup']);

/** An order, as written in `ops/queue/<id>.json`. */
export interface OpsOrder {
  protocol: number;
  id: string;
  kind: OpsKind;
  createdAt: string;
  expiresAt: string;
  actor: { id: number; displayName: string };
  params: {
    version: string | null;
    backupId: string | null;
    skipBackup: boolean;
    readyTimeoutSec: number;
    maxRuntimeSec: number;
  };
}

/** Run identifier — the timestamp makes it sortable, the six hex digits make it non-guessable. */
export function newRunId(now: Date, entropy: () => string = () => randomBytes(3).toString('hex')): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0');
  const stamp =
    `${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${entropy()}`;
}

/**
 * Brings a duration back within tenable bounds. This is not a courtesy: the value ends up in
 * `$(( SECONDS + READY_TIMEOUT ))` on the script side, where bash **re-evaluates the content** of the variable — "x[$(command)]"
 * would execute there. It is therefore bounded here, re-filtered by `update.sh`, and re-filtered again by the agent.
 * Three passes, no trust.
 */
export function clampSeconds(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Builds the order to deposit. All values are already validated at this point. */
export function buildOrder(input: {
  id: string;
  kind: OpsKind;
  now: Date;
  ttlSec: number;
  actor: { id: number; displayName: string };
  version?: string | null;
  backupId?: string | null;
  skipBackup?: boolean;
  readyTimeoutSec?: number;
  maxRuntimeSec?: number;
}): OpsOrder {
  return {
    protocol: OPS_PROTOCOL,
    id: input.id,
    kind: input.kind,
    createdAt: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + clampSeconds(input.ttlSec, 60, 86_400) * 1000).toISOString(),
    actor: input.actor,
    params: {
      version: input.version ?? null,
      backupId: input.backupId ?? null,
      skipBackup: input.skipBackup === true,
      readyTimeoutSec: clampSeconds(input.readyTimeoutSec ?? 600, 60, 3_600),
      maxRuntimeSec: clampSeconds(input.maxRuntimeSec ?? 3_600, 60, 21_600),
    },
  };
}

/**
 * The status written by the agent. It is reread by a backend that is not necessarily the one that deposited the order —
 * hence the schema: everything is optional except what without which there is nothing to show, and an unknown field is
 * ignored rather than failing the read.
 */
export const statusSchema = z.object({
  protocol: z.number().int().optional(),
  id: z.string(),
  kind: z.string(),
  target: z.string().nullish(),
  state: z.string(),
  phase: z.string().nullish(),
  reason: z.string().nullish(),
  startedAt: z.string().nullish(),
  heartbeatAt: z.string().nullish(),
  endedAt: z.string().nullish(),
  exitCode: z.number().nullish(),
  backupId: z.string().nullish(),
  actor: z.object({ id: z.number(), displayName: z.string() }).nullish(),
  agentVersion: z.string().nullish(),
});

/**
 * An order reread from the queue. The backend wrote it itself, but rereads it to say WHAT it is about while the agent has
 * not picked it up — otherwise the screen would announce an "unknown" operation during the seconds following the click,
 * which is false and alarming. Tolerant schema, like the status: an order deposited by an earlier version must remain readable.
 */
export const queuedOrderSchema = z.object({
  id: z.string(),
  kind: z.string(),
  createdAt: z.string().nullish(),
  expiresAt: z.string().nullish(),
  actor: z.object({ id: z.number(), displayName: z.string() }).nullish(),
  params: z.object({ version: z.string().nullish(), backupId: z.string().nullish() }).partial().nullish(),
});

/** The agent's state (`ops/state/agent.json`), written at each heartbeat. */
export const agentSchema = z.object({
  protocol: z.number().int(),
  version: z.string().nullish(),
  seenAt: z.string(),
  rootOk: z.boolean().nullish(),
  pollSec: z.number().nullish(),
  allow: z.object({ update: z.boolean(), backup: z.boolean(), verify: z.boolean() }).partial().nullish(),
});
