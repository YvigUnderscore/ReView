// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey, Tr } from '../../i18n';
import type { InstanceVersion } from './aboutInstance';

/**
 * The "Updates & backups" screen, data side: the shape of `GET /api/admin/ops`
 * and the display rules that go with it.
 *
 * Pure functions in their own module (like `aboutInstance`, `adminShared`...): they
 * are tested without mounting React, and the component exports only itself.
 *
 * ⚠ No label table as a module constant: it would freeze the language at
 * bundle load. All take `t` as a parameter, without exception.
 */

/** Whether this instance is changing version: decides whether the screen offers a button. */
export type UpdateMode = 'registry' | 'build';

export interface ReleaseInfo {
  tag: string;
  name: string;
  publishedAt: string | null;
  /** Release notes, in markdown. REMOTE content: rendered escaped (`renderDocHtml`). */
  notesMd: string;
  htmlUrl: string;
  prerelease: boolean;
}

export type ReleaseError = 'DISABLED' | 'UNREACHABLE' | 'RATE_LIMITED';

export interface BackupEntry {
  id: string;
  date: string | null;
  mode: string | null;
  bucket: string | null;
  fromRelease: string | null;
  dbBytes: number | null;
  envIncluded: boolean;
  /** Restore command composed by the server: never built here. */
  restoreCommand: string;
}

export interface BackupCatalog {
  available: boolean;
  dir: string | null;
  entries: BackupEntry[];
}

export type MechanismState = 'absent' | 'ready' | 'busy' | 'stalled' | 'blocked';

export interface Mechanism {
  state: MechanismState;
  reason: string | null;
  protocol: number | null;
  agentVersion: string | null;
  seenAt: string | null;
  allow: { update: boolean; backup: boolean; verify: boolean };
}

export type RunState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'rolled-back'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'rejected'
  | 'unknown';

export type OpsKind = 'update' | 'backup' | 'verify';

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
  restoreCommand: string | null;
  cancellable: boolean;
}

export interface OpsOverview {
  current: InstanceVersion;
  mode: UpdateMode;
  latest: ReleaseInfo | null;
  /** Everything released since the version in service: the answer to "what changes". */
  newer: ReleaseInfo[];
  release: { checkedAt: string | null; error: ReleaseError | null };
  updateAvailable: boolean;
  backups: BackupCatalog;
  mechanism: Mechanism;
  activeRun: RunSummary | null;
  recentRuns: RunSummary[];
  commands: { update: string | null; backup: string; enableAgent: string };
}

/** Response of `GET /api/admin/ops/runs/:id`: the state, and a slice of the log. */
export interface RunDetail {
  run: RunSummary;
  log: { from: number; next: number; text: string; truncated: boolean };
}

/** A terminal state will not move again: the screen stops polling, and the log is complete. */
export function isTerminalState(state: RunState): boolean {
  return state !== 'queued' && state !== 'running';
}

/**
 * Label of a state. The state key is in kebab-case (`rolled-back`, as the agent
 * writes it), the message key in camelCase: the mapping table lives here, once.
 */
export function runStateLabel(t: Tr, state: RunState): string {
  const key = state === 'rolled-back' ? 'rolledBack' : state;
  return t(`ops.run.state.${key}` as MessageKey);
}

/** Colour of the state dot: the vocabulary of `Badge`. */
export function runStateVariant(state: RunState): 'success' | 'warning' | 'destructive' | 'info' | 'muted' {
  if (state === 'succeeded') return 'success';
  if (state === 'running' || state === 'queued') return 'info';
  // A rollback is not a failure: the instance is up, in its previous version.
  if (state === 'rolled-back' || state === 'unknown') return 'warning';
  if (state === 'failed') return 'destructive';
  return 'muted';
}

/** Known milestones of `scripts/update.sh`; any other word comes from a newer version. */
const KNOWN_PHASES = ['queued', 'precheck', 'backup', 'switch', 'health', 'rollback', 'done'];

/**
 * Label of a milestone. An unknown milestone (an agent newer than this screen) is rendered
 * as is rather than hidden: an English word is better than an empty line.
 */
export function runPhaseLabel(t: Tr, phase: string | null): string {
  if (!phase) return t('ops.run.phase.queued');
  if (!KNOWN_PHASES.includes(phase)) return phase;
  return t(`ops.run.phase.${phase}` as MessageKey);
}

/** Label of an operation. The protocol may name one that this screen ignores. */
export function runKindLabel(t: Tr, kind: string): string {
  if (kind !== 'update' && kind !== 'backup' && kind !== 'verify') return kind;
  return t(`ops.run.kind.${kind}` as MessageKey);
}

/** What the screen must say about the execution mechanism, and in what tone. */
export interface MechanismNotice {
  tone: 'info' | 'warning';
  text: string;
  /** Diagnostic command to display, when there is a useful one. */
  command: string | null;
}

/**
 * Translates the mechanism's state into a message. `null` when all is well: a permanent banner
 * that says "it works" eventually goes unread, and hides the one that matters.
 */
export function mechanismNotice(
  t: Tr,
  mechanism: Mechanism,
  commands: OpsOverview['commands'],
  formatDate: (iso: string) => string,
): MechanismNotice | null {
  switch (mechanism.state) {
    case 'absent':
      return { tone: 'info', text: t('ops.agent.absent'), command: commands.enableAgent };
    case 'stalled':
      return {
        tone: 'warning',
        text: t('ops.agent.stalled', { date: mechanism.seenAt ? formatDate(mechanism.seenAt) : '—' }),
        command: 'bash scripts/ops-agent.sh status',
      };
    case 'blocked':
      return mechanism.reason === 'PROTOCOL_UNSUPPORTED'
        ? { tone: 'warning', text: t('ops.agent.protocol'), command: 'bash scripts/ops-agent.sh upgrade' }
        : { tone: 'warning', text: t('ops.agent.rootMismatch'), command: 'bash scripts/ops-agent.sh status' };
    default:
      return null;
  }
}

/** Unavailability message for the remote catalogue, or `null` if it responded. */
export function releaseErrorLabel(t: Tr, error: ReleaseError | null): string | null {
  if (error === 'UNREACHABLE') return t('ops.latest.unreachable');
  if (error === 'RATE_LIMITED') return t('ops.latest.rateLimited');
  if (error === 'DISABLED') return t('ops.latest.disabled');
  return null;
}

/**
 * Does the update button make sense?
 *
 * Build mode is excluded **on purpose**: switching to it recompiles gigabytes
 * on the studio's server, and `git checkout` would rewrite the repository under a stack
 * that is running. The screen shows the command there, never a button.
 */
export function canUpdateFromHere(overview: OpsOverview): boolean {
  return (
    overview.mode === 'registry' &&
    overview.mechanism.state === 'ready' &&
    overview.mechanism.allow.update &&
    overview.updateAvailable &&
    overview.latest !== null
  );
}

/** Can a backup be ordered with one click? */
export function canBackupFromHere(overview: OpsOverview): boolean {
  return overview.mechanism.state === 'ready' && overview.mechanism.allow.backup;
}
