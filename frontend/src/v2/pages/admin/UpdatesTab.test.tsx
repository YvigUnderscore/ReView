// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';

const { api, toast } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn(), patch: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The REAL module, of which only `api` is replaced: the panel also imports `ApiError`
// to tell a final 404 from a passing outage, and a mock that does not export it
// makes it `undefined` — `instanceof` then throws, and the screen no longer renders anything at all.
vi.mock('@/lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/apiClient')>('@/lib/apiClient');
  return { ...actual, api };
});
vi.mock('sonner', () => ({ toast }));

import UpdatesTab from './UpdatesTab';
import { ApiError } from '@/lib/apiClient';
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
 * The rule these checks defend: **never a dead button**. An instance that
 * cannot act on itself does not show a greyed-out button — which suggests a fault
 * and teaches nothing — but the exact command to type.
 */
describe('UpdatesTab', () => {
  it('offers the update when everything is in place', async () => {
    mount();
    expect(await screen.findByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeTruthy();
  });

  it('without an agent: no action button, the command instead', async () => {
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

  it('in build mode: the command, never the button', async () => {
    // Switching to it would recompile gigabytes on the studio's server.
    withOverview({ mode: 'build' });
    mount();
    expect(await screen.findByText('bash scripts/update.sh --version v2.4.0')).toBeTruthy();
    expect(screen.queryByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeNull();
    expect(screen.getByText(t('ops.installed.buildHint'))).toBeTruthy();
  });

  it('says the repository is misconfigured rather than letting a save go into the void', async () => {
    withOverview({ mechanism: { ...OVERVIEW.mechanism, state: 'blocked', reason: 'ROOT_MISMATCH' } });
    mount();
    expect(await screen.findByText(t('ops.agent.rootMismatch'))).toBeTruthy();
    expect(screen.queryByText(t('ops.backups.create'))).toBeNull();
  });

  it('announces the absence of a backup catalogue without claiming there are none', async () => {
    withOverview({ backups: { available: false, dir: null, entries: [] } });
    mount();
    expect(await screen.findByText(t('ops.backups.unavailable'))).toBeTruthy();
    expect(screen.queryByText(t('ops.backups.empty'))).toBeNull();
  });

  it('stays readable when the remote catalogue is unreachable', async () => {
    withOverview({
      latest: null,
      newer: [],
      updateAvailable: false,
      release: { checkedAt: null, error: 'UNREACHABLE' },
    });
    mount();
    expect(await screen.findByText(t('ops.latest.unreachable'))).toBeTruthy();
    expect(screen.getByText(t('about.version'))).toBeTruthy();
    // Neither "up to date" nor "available": we don't know, and we don't pretend to.
    expect(screen.queryByText(t('ops.latest.upToDate'))).toBeNull();
  });

  it('follows the operation the server says is active', async () => {
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
    // An operation in progress locks the other gestures.
    expect(screen.queryByText(t('ops.update.action', { tag: 'v2.4.0' }))).toBeNull();
  });

  it('does not stay stuck on a remembered run that no longer exists', async () => {
    // The dead end observed in use: an identifier left in localStorage, an API that
    // answers 404 — hence a FINAL response — and a screen that announced "the instance
    // is restarting" endlessly, with no button to get out since "dismiss" only appeared
    // once the operation was finished.
    localStorage.setItem('review:ops-run', '20260910-142233-a1b2c3');
    api.get.mockImplementation((path: string) =>
      path.startsWith('/api/admin/ops/runs/')
        ? Promise.reject(new ApiError('Resource not found', 404, 'NOT_FOUND'))
        : Promise.resolve(OVERVIEW),
    );
    mount();
    expect(await screen.findByText(t('ops.run.gone'))).toBeTruthy();
    expect(screen.queryByText(t('ops.run.reconnecting'))).toBeNull();
    // An exit, and an immediate forget: a reload must not bring the ghost back.
    expect(screen.getByText(t('ops.run.dismiss'))).toBeTruthy();
    expect(localStorage.getItem('review:ops-run')).toBeNull();
  });

  it('does not cry error when the API disappears during a switchover', async () => {
    // This is the EXPECTED behaviour of an update: the container that was answering is in
    // the middle of being recreated. A red toast would suggest a fault at every successful switchover.
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
