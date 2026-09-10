// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';

const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../lib/apiClient', () => ({ api }));
vi.mock('sonner', () => ({ toast }));

import UpdatesTab from './UpdatesTab';
import { t } from '../../i18n';
import type { OpsOverview } from './ops';

const OVERVIEW: OpsOverview = {
  current: { version: '2.3.0', commit: 'abc123', builtAt: null, node: 'v22.11.0', source: 'https://x' },
  mode: 'registry',
  latest: {
    tag: 'v2.4.0',
    name: 'ReView 2.4.0',
    publishedAt: '2026-09-01T10:00:00Z',
    notesMd: '### Highlights\n\nDes choses.',
    htmlUrl: 'https://github.com/x/y/releases/tag/v2.4.0',
    prerelease: false,
  },
  newer: [],
  release: { checkedAt: '2026-09-10T14:00:00Z', error: null },
  updateAvailable: true,
  backups: { available: true, dir: '/backups', entries: [] },
  mechanism: {
    state: 'ready',
    reason: null,
    protocol: 1,
    agentVersion: '2.4.0',
    seenAt: '2026-09-10T14:00:00Z',
    allow: { update: true, backup: true, verify: true },
  },
  activeRun: null,
  recentRuns: [],
  commands: {
    update: 'bash scripts/update.sh --version v2.4.0',
    backup: 'bash scripts/backup.sh',
    enableAgent: 'bash scripts/ops-agent.sh install',
  },
};

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UpdatesTab />
    </QueryClientProvider>,
  );
};

const withOverview = (over: Partial<OpsOverview>) => {
  api.get.mockResolvedValue({ ...OVERVIEW, ...over });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.get.mockResolvedValue(OVERVIEW);
});

afterEach(cleanup);

/**
 * La règle que ces contrôles défendent : **jamais un bouton mort**. Une instance qui ne
 * peut pas agir sur elle-même n'affiche pas un bouton grisé — qui fait croire à une panne
 * et n'apprend rien — mais la commande exacte à taper.
 */
describe('UpdatesTab', () => {
  it('propose la mise à jour quand tout est réuni', async () => {
    mount();
    expect(await screen.findByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeTruthy();
  });

  it('sans agent : aucun bouton d’action, la commande à la place', async () => {
    withOverview({
      mechanism: {
        ...OVERVIEW.mechanism,
        state: 'absent',
        reason: 'SPOOL_UNSET',
        allow: { update: false, backup: false, verify: false },
      },
    });
    mount();
    expect(await screen.findByText(t('ops.agent.absent'))).toBeTruthy();
    expect(screen.queryByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeNull();
    expect(screen.queryByText(t('ops.backups.create'))).toBeNull();
    expect(screen.getByText('bash scripts/ops-agent.sh install')).toBeTruthy();
    expect(screen.getByText('bash scripts/update.sh --version v2.4.0')).toBeTruthy();
  });

  it('en mode construction : la commande, jamais le bouton', async () => {
    // Y basculer recompilerait des giga-octets sur le serveur du studio.
    withOverview({ mode: 'build' });
    mount();
    expect(await screen.findByText('bash scripts/update.sh --version v2.4.0')).toBeTruthy();
    expect(screen.queryByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeNull();
    expect(screen.getByText(t('ops.installed.buildHint'))).toBeTruthy();
  });

  it('dit que le dépôt est mal monté plutôt que de laisser sauvegarder dans le vide', async () => {
    withOverview({ mechanism: { ...OVERVIEW.mechanism, state: 'blocked', reason: 'ROOT_MISMATCH' } });
    mount();
    expect(await screen.findByText(t('ops.agent.rootMismatch'))).toBeTruthy();
    expect(screen.queryByText(t('ops.backups.create'))).toBeNull();
  });

  it('annonce l’absence de catalogue de sauvegardes sans prétendre qu’il n’y en a aucune', async () => {
    withOverview({ backups: { available: false, dir: null, entries: [] } });
    mount();
    expect(await screen.findByText(t('ops.backups.unavailable'))).toBeTruthy();
    expect(screen.queryByText(t('ops.backups.empty'))).toBeNull();
  });

  it('reste lisible quand le catalogue distant est injoignable', async () => {
    withOverview({
      latest: null,
      newer: [],
      updateAvailable: false,
      release: { checkedAt: null, error: 'UNREACHABLE' },
    });
    mount();
    expect(await screen.findByText(t('ops.latest.unreachable'))).toBeTruthy();
    expect(screen.getByText(t('about.version'))).toBeTruthy();
    // Ni « à jour » ni « disponible » : on ne sait pas, et on ne fait pas semblant.
    expect(screen.queryByText(t('ops.latest.upToDate'))).toBeNull();
  });

  it('suit l’opération que le serveur dit active', async () => {
    withOverview({
      activeRun: {
        id: '20260910-142233-a1b2c3',
        kind: 'update',
        target: 'v2.4.0',
        state: 'running',
        phase: 'backup',
        reason: null,
        requestedBy: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        backupId: null,
        agentVersion: '2.4.0',
        restoreCommand: null,
        cancellable: true,
      },
    });
    api.get.mockImplementation((path: string) =>
      path.startsWith('/api/admin/ops/runs/')
        ? Promise.resolve({
            run: {
              ...OVERVIEW.activeRun,
              id: '20260910-142233-a1b2c3',
              kind: 'update',
              state: 'running',
              phase: 'backup',
              cancellable: true,
            },
            log: { from: 0, next: 10, text: '▶ Dump…\n', truncated: false },
          })
        : Promise.resolve({
            ...OVERVIEW,
            activeRun: {
              id: '20260910-142233-a1b2c3',
              kind: 'update',
              state: 'running',
              phase: 'backup',
              cancellable: true,
            },
          }),
    );
    mount();
    expect(await screen.findByText(t('ops.run.title'))).toBeTruthy();
    expect(await screen.findByText('▶ Dump…')).toBeTruthy();
    // Une opération en cours verrouille les autres gestes.
    expect(screen.queryByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeNull();
  });

  it('ne crie pas à l’erreur quand l’API disparaît pendant une bascule', async () => {
    // C'est le comportement ATTENDU d'une mise à jour : le conteneur qui répondait est en
    // train d'être recréé. Un toast rouge ferait croire à une panne à chaque bascule réussie.
    localStorage.setItem('review:ops-run', '20260910-142233-a1b2c3');
    api.get.mockImplementation((path: string) =>
      path.startsWith('/api/admin/ops/runs/')
        ? Promise.reject(new Error('Failed to fetch'))
        : Promise.resolve(OVERVIEW),
    );
    mount();
    expect(await screen.findByText(t('ops.run.reconnecting'))).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
