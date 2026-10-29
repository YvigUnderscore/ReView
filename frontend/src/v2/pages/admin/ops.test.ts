// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import {
  canBackupFromHere,
  canUpdateFromHere,
  isTerminalState,
  mechanismNotice,
  releaseErrorLabel,
  runKindLabel,
  runPhaseLabel,
  runStateLabel,
  runStateVariant,
  type Mechanism,
  type OpsOverview,
  type RunState,
} from './ops';

const COMMANDS = {
  update: 'bash scripts/update.sh --version v2.4.0',
  backup: 'bash scripts/backup.sh',
  enableAgent: 'bash scripts/ops-agent.sh install',
};

const mechanism = (over: Partial<Mechanism> = {}): Mechanism => ({
  state: 'ready',
  reason: null,
  protocol: 1,
  agentVersion: '2.4.0',
  seenAt: '2026-09-10T14:00:00Z',
  allow: { update: true, backup: true, verify: true },
  ...over,
});

const overview = (over: Partial<OpsOverview> = {}): OpsOverview => ({
  current: { version: '2.3.0', commit: null, builtAt: null, node: 'v22', source: 'https://x' },
  mode: 'registry',
  latest: { tag: 'v2.4.0', name: '', publishedAt: null, notesMd: '', htmlUrl: '', prerelease: false },
  newer: [],
  release: { checkedAt: null, error: null },
  updateAvailable: true,
  backups: { available: true, dir: '/backups', entries: [] },
  mechanism: mechanism(),
  activeRun: null,
  recentRuns: [],
  commands: COMMANDS,
  ...over,
});

describe('isTerminalState', () => {
  it('distinguishes what will still move from what has played', () => {
    expect(isTerminalState('queued')).toBe(false);
    expect(isTerminalState('running')).toBe(false);
    for (const state of [
      'succeeded',
      'rolled-back',
      'failed',
      'cancelled',
      'expired',
      'rejected',
      'unknown',
    ]) {
      expect(isTerminalState(state as RunState), state).toBe(true);
    }
  });
});

describe('labels', () => {
  it('translates a state, including one whose key changes spelling', () => {
    // The agent writes "rolled-back", the catalogue names it "rolledBack": the mapping
    // lives in one place, otherwise the screen would show the raw key the day it matters.
    expect(runStateLabel(t, 'rolled-back')).toBe(t('ops.run.state.rolledBack'));
    expect(runStateLabel(t, 'succeeded')).toBe(t('ops.run.state.succeeded'));
  });

  it('renders an unknown milestone as is', () => {
    // A newer agent than this screen emits milestones it ignores: better an
    // English word than an empty line in the middle of an update.
    expect(runPhaseLabel(t, 'backup')).toBe(t('ops.run.phase.backup'));
    expect(runPhaseLabel(t, 'quelque-chose-de-neuf')).toBe('quelque-chose-de-neuf');
    expect(runPhaseLabel(t, null)).toBe(t('ops.run.phase.queued'));
  });

  it('renders an unknown kind of operation as is', () => {
    expect(runKindLabel(t, 'update')).toBe(t('ops.run.kind.update'));
    expect(runKindLabel(t, 'quelque-chose')).toBe('quelque-chose');
  });

  it('does not paint a rollback as a failure', () => {
    // The instance is up, in its previous version: this is a warning, not an outage.
    expect(runStateVariant('rolled-back')).toBe('warning');
    expect(runStateVariant('failed')).toBe('destructive');
    expect(runStateVariant('succeeded')).toBe('success');
    expect(runStateVariant('running')).toBe('info');
  });

  it('explains a remote catalogue outage, and stays silent when all is well', () => {
    expect(releaseErrorLabel(t, 'UNREACHABLE')).toBe(t('ops.latest.unreachable'));
    expect(releaseErrorLabel(t, 'RATE_LIMITED')).toBe(t('ops.latest.rateLimited'));
    expect(releaseErrorLabel(t, 'DISABLED')).toBe(t('ops.latest.disabled'));
    expect(releaseErrorLabel(t, null)).toBeNull();
  });
});

describe('mechanismNotice', () => {
  const date = (iso: string) => iso;

  it('stays silent when the agent is fine — a permanent banner stops being read', () => {
    expect(mechanismNotice(t, mechanism(), COMMANDS, date)).toBeNull();
    expect(mechanismNotice(t, mechanism({ state: 'busy' }), COMMANDS, date)).toBeNull();
  });

  it('offers to install the agent when there is none', () => {
    const notice = mechanismNotice(t, mechanism({ state: 'absent', reason: 'SPOOL_UNSET' }), COMMANDS, date);
    expect(notice?.tone).toBe('info');
    expect(notice?.command).toBe(COMMANDS.enableAgent);
  });

  it('distinguishes a silent agent from a misconfigured one', () => {
    // Two very different failures: one can be diagnosed, the other would SILENTLY CORRUPT a
    // backup if let through.
    const stalled = mechanismNotice(
      t,
      mechanism({ state: 'stalled', reason: 'AGENT_STALE' }),
      COMMANDS,
      date,
    );
    expect(stalled?.tone).toBe('warning');
    expect(stalled?.text).toContain('2026-09-10T14:00:00Z');

    const root = mechanismNotice(t, mechanism({ state: 'blocked', reason: 'ROOT_MISMATCH' }), COMMANDS, date);
    expect(root?.text).toBe(t('ops.agent.rootMismatch'));

    const proto = mechanismNotice(
      t,
      mechanism({ state: 'blocked', reason: 'PROTOCOL_UNSUPPORTED' }),
      COMMANDS,
      date,
    );
    expect(proto?.text).toBe(t('ops.agent.protocol'));
    expect(proto?.command).toContain('upgrade');
  });
});

describe('what the screen allows itself to do', () => {
  it('offers the update only when everything is in place', () => {
    expect(canUpdateFromHere(overview())).toBe(true);
    expect(canUpdateFromHere(overview({ updateAvailable: false }))).toBe(false);
    expect(canUpdateFromHere(overview({ mechanism: mechanism({ state: 'absent' }) }))).toBe(false);
    expect(canUpdateFromHere(overview({ mechanism: mechanism({ state: 'busy' }) }))).toBe(false);
    expect(
      canUpdateFromHere(
        overview({ mechanism: mechanism({ allow: { update: false, backup: true, verify: true } }) }),
      ),
    ).toBe(false);
  });

  it('refuses the button in build mode, whatever else happens', () => {
    // Switching to it would recompile gigabytes on the studio's server, and `git checkout`
    // would rewrite the repository under a stack that is running.
    expect(canUpdateFromHere(overview({ mode: 'build' }))).toBe(false);
  });

  it('separates the right to back up from the right to update', () => {
    const partial = mechanism({ allow: { update: false, backup: true, verify: true } });
    expect(canBackupFromHere(overview({ mechanism: partial }))).toBe(true);
    expect(canBackupFromHere(overview({ mechanism: mechanism({ state: 'stalled' }) }))).toBe(false);
  });
});
