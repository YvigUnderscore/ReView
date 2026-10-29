// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import AdminPage from '../../v2/pages/AdminPage';
import { t } from '../../v2/i18n';
import type { MockResolver } from '../apiMock';
import { renderWithProviders } from '../renderWithProviders';

/**
 * Administration holds twenty-seven sections behind a single route. Two guarantees
 * suffice to hold it: the role decides access (not one section in particular, but the
 * whole page), and the URL alone decides which section is mounted. Each section's
 * content has its own tests; here we test the routing.
 */

const stats = {
  users: { total: 12, byRole: { ADMIN: 1 }, online: 3 },
  pipeline: { projects: 4, sequences: 9, shots: 120, assets: 30, versions: 400 },
  media: { count: 380, byKind: { VIDEO: 300 }, byStatus: { READY: 380 }, storageBytes: 1024 },
  comments: 88,
  jobs: null,
  topStorageUsers: [],
};

const api: Record<string, MockResolver> = {
  'GET /api/admin/stats': stats,
  'GET /api/admin/system': {
    host: {
      platform: 'linux',
      arch: 'x64',
      nodeVersion: 'v22.0.0',
      cpus: 8,
      loadAvg: [0, 0, 0],
      uptimeSec: 10,
      processUptimeSec: 5,
    },
    memory: { total: 16, free: 8, used: 8, processRss: 1 },
    disk: null,
    services: { database: true, redis: true, minio: true },
  },
  'GET /api/users': {
    users: [
      {
        id: 4,
        email: 'lea@review.local',
        name: 'Lea Nord',
        role: 'ARTIST',
        status: 'ONLINE',
        initials: 'LN',
        displayName: 'Lea',
        avatarUrl: null,
      },
    ],
  },
  'GET /api/admin/users/4': {
    user: {
      id: 4,
      email: 'lea@review.local',
      name: 'Lea Nord',
      displayName: 'Lea',
      initials: 'LN',
      avatarUrl: null,
      role: 'ARTIST',
      status: 'ONLINE',
      storageUsed: 0,
      storageLimit: null,
      lastSeenAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
    },
    memberships: [],
    sessions: [],
    apiTokens: [],
    activity: [],
    counts: { media: 0, versions: 0, comments: 0, tasks: 0 },
  },
};

/**
 * "Comments" tile of the dashboard, identified by its accessible name: the value
 * then the label. Spaces are ignored: their presence depends on the accessible-name
 * computation, not on the screen.
 */
const COMMENTS_METRIC = (name: string): boolean =>
  name.replace(/\s+/g, '') === `88${t('admin.tab.comments')}`;

const mount = (route: string, path: string, role: 'ADMIN' | 'SUPERVISOR' = 'ADMIN') =>
  renderWithProviders(<AdminPage />, { route, path, user: { role }, api });

describe('AdminPage', () => {
  it('closes the whole page to an account that is not an administrator', () => {
    mount('/admin', '/admin', 'SUPERVISOR');

    expect(screen.getByText(t('admin.restricted'))).toBeInTheDocument();
    // No sidebar: no section is even named.
    expect(screen.queryByRole('link', { name: new RegExp(t('admin.tab.users')) })).not.toBeInTheDocument();
  });

  it('opens the dashboard by default and offers each section as a direct link', async () => {
    mount('/admin', '/admin');

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: new RegExp(t('admin.tab.dashboard')) })).toHaveAttribute(
      'href',
      '/admin/overview',
    );
    expect(within(nav).getByRole('link', { name: new RegExp(t('admin.tab.users')) })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    // Sections are grouped by category, not dumped in bulk.
    expect(within(nav).getByText(t('admin.group.studio'))).toBeInTheDocument();
    expect(within(nav).getByText(t('admin.group.maintenance'))).toBeInTheDocument();
    // The dashboard is indeed the one mounted: its counters come from the server.
    expect(await screen.findByRole('link', { name: COMMENTS_METRIC })).toHaveAttribute(
      'href',
      '/admin/comments',
    );
  });

  it('mounts the section named in the URL, not the dashboard', async () => {
    mount('/admin/users', '/admin/:section');

    expect(await screen.findByPlaceholderText(t('users.searchPlaceholder'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COMMENTS_METRIC })).not.toBeInTheDocument();
  });

  it('switches to the detail sheet when the URL carries an identifier', async () => {
    mount('/admin/users/4', '/admin/:section/:id');

    // The list gives way to the card: no more search field.
    expect(await screen.findByText('lea@review.local')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t('users.searchPlaceholder'))).not.toBeInTheDocument();
  });

  it('falls back to the dashboard when the section named in the URL does not exist', async () => {
    mount('/admin/section-fantome', '/admin/:section');

    expect(await screen.findByRole('link', { name: COMMENTS_METRIC })).toBeInTheDocument();
  });
});
