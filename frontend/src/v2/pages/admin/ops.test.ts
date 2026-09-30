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
  it('distingue ce qui bougera encore de ce qui est joué', () => {
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

describe('libellés', () => {
  it('traduit un état, y compris celui dont la clé change de graphie', () => {
    // L'agent écrit « rolled-back », le catalogue nomme « rolledBack » : la correspondance
    // vit à un seul endroit, sinon l'écran afficherait la clé brute le jour où ça compte.
    expect(runStateLabel(t, 'rolled-back')).toBe(t('ops.run.state.rolledBack'));
    expect(runStateLabel(t, 'succeeded')).toBe(t('ops.run.state.succeeded'));
  });

  it('rend tel quel un jalon qu’il ne connaît pas', () => {
    // Un agent plus récent que cet écran émet des jalons que celui-ci ignore : mieux vaut
    // un mot anglais qu'une ligne vide au milieu d'une mise à jour.
    expect(runPhaseLabel(t, 'backup')).toBe(t('ops.run.phase.backup'));
    expect(runPhaseLabel(t, 'quelque-chose-de-neuf')).toBe('quelque-chose-de-neuf');
    expect(runPhaseLabel(t, null)).toBe(t('ops.run.phase.queued'));
  });

  it('rend tel quel un genre d’opération inconnu', () => {
    expect(runKindLabel(t, 'update')).toBe(t('ops.run.kind.update'));
    expect(runKindLabel(t, 'quelque-chose')).toBe('quelque-chose');
  });

  it('ne peint pas un retour arrière comme un échec', () => {
    // L'instance est debout, dans sa version d'avant : c'est un avertissement, pas une panne.
    expect(runStateVariant('rolled-back')).toBe('warning');
    expect(runStateVariant('failed')).toBe('destructive');
    expect(runStateVariant('succeeded')).toBe('success');
    expect(runStateVariant('running')).toBe('info');
  });

  it('explique une indisponibilité du catalogue distant, et se tait quand tout va', () => {
    expect(releaseErrorLabel(t, 'UNREACHABLE')).toBe(t('ops.latest.unreachable'));
    expect(releaseErrorLabel(t, 'RATE_LIMITED')).toBe(t('ops.latest.rateLimited'));
    expect(releaseErrorLabel(t, 'DISABLED')).toBe(t('ops.latest.disabled'));
    expect(releaseErrorLabel(t, null)).toBeNull();
  });
});

describe('mechanismNotice', () => {
  const date = (iso: string) => iso;

  it('se tait quand l’agent va bien — un bandeau permanent ne se lit plus', () => {
    expect(mechanismNotice(t, mechanism(), COMMANDS, date)).toBeNull();
    expect(mechanismNotice(t, mechanism({ state: 'busy' }), COMMANDS, date)).toBeNull();
  });

  it('propose d’installer l’agent quand il n’y en a pas', () => {
    const notice = mechanismNotice(t, mechanism({ state: 'absent', reason: 'SPOOL_UNSET' }), COMMANDS, date);
    expect(notice?.tone).toBe('info');
    expect(notice?.command).toBe(COMMANDS.enableAgent);
  });

  it('distingue un agent muet d’un agent mal monté', () => {
    // Deux pannes très différentes : l'une se diagnostique, l'autre CORROMPRAIT une
    // sauvegarde en silence si on la laissait passer.
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

describe('ce que l’écran s’autorise à faire', () => {
  it('ne propose la mise à jour que si tout est réuni', () => {
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

  it('refuse le bouton en mode construction, quoi qu’il arrive par ailleurs', () => {
    // Y basculer recompilerait des giga-octets sur le serveur du studio, et `git checkout`
    // réécrirait le dépôt sous les pieds d'une pile en train de tourner.
    expect(canUpdateFromHere(overview({ mode: 'build' }))).toBe(false);
  });

  it('sépare le droit de sauvegarder du droit de mettre à jour', () => {
    const partial = mechanism({ allow: { update: false, backup: true, verify: true } });
    expect(canBackupFromHere(overview({ mechanism: partial }))).toBe(true);
    expect(canBackupFromHere(overview({ mechanism: mechanism({ state: 'stalled' }) }))).toBe(false);
  });
});
