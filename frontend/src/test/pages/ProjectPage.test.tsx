// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ProjectPage from '../../v2/pages/ProjectPage';
import { t } from '../../v2/i18n';
import type { MockResolver } from '../apiMock';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * The project page is a tab bar and a disguised router: the tab lives in the URL
 * (link sharing, browser back), and half of the tabs only exist for whoever
 * administers the project. These are the two rules held here, not the content of each
 * tab, which has its own screens.
 */

const PROJECT_ID = 3;

const baseApi: Record<string, MockResolver> = {
  [`GET /api/projects/${PROJECT_ID}`]: { project: { name: 'Alpha', startFrame: 1001 } },
  [`GET /api/projects/${PROJECT_ID}/settings`]: { settings: null },
  [`GET /api/sequences?projectId=${PROJECT_ID}`]: { sequences: [], unsequencedShots: 0 },
  [`GET /api/shots?projectId=${PROJECT_ID}`]: page([], { total: 42 }),
  [`GET /api/assets?projectId=${PROJECT_ID}`]: page([], { total: 7 }),
  [`GET /api/projects/${PROJECT_ID}/departments`]: { departments: [] },
  [`GET /api/context/project/${PROJECT_ID}`]: {
    context: { project: { id: PROJECT_ID, name: 'Alpha' } },
  },
  [`GET /api/shotgrid/projects/${PROJECT_ID}/connection`]: { connection: null },
  [`GET /api/media?projectId=${PROJECT_ID}`]: { items: [] },
  'GET /api/pipeline-statuses': { statuses: [] },
};

const mount = (role: 'ADMIN' | 'ARTIST' = 'ADMIN', route = `/projects/${PROJECT_ID}`) =>
  renderWithProviders(<ProjectPage />, {
    route,
    path: '/projects/:id',
    user: { role },
    api: baseApi,
  });

// The tabs now carry `role="tab"` and `aria-selected`: without them, the screen reader
// only announced interchangeable buttons, without saying which one was active.
describe('ProjectPage', () => {
  it('opens the preview by default and takes the project name from the server', async () => {
    mount();

    expect(await screen.findByRole('heading', { name: 'Alpha', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: new RegExp(t('project.tab.overview')) })).toBeInTheDocument();
  });

  it('counts shots and assets from the server total, not the loaded page', async () => {
    mount();

    // 42 shots exist, none has been processed yet: the badge must say 42.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: new RegExp(`^${t('shots.title')}`) })).toHaveTextContent('42'),
    );
    expect(screen.getByRole('tab', { name: /^Assets/ })).toHaveTextContent('7');
  });

  it('writes the active tab into the URL so that a link opens in the right place', async () => {
    const { user, currentPath } = mount();

    await user.click(await screen.findByRole('tab', { name: new RegExp(`^${t('shots.title')}`) }));

    // Wait for the PANEL before the URL, and not the other way round: since the twelve tabs are
    // loaded by `lazy()`, the click crosses a Suspense boundary. Waiting for the URL first
    // amounted to giving a second to a dynamic import: the test passed alone and
    // failed as soon as the machine was loaded. The delay is explicit for the same reason.
    expect(
      await screen.findByRole('heading', { name: t('shots.title'), level: 2 }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toContain('tab=shots'));
  });

  it('mounts the tab requested by the URL directly', async () => {
    mount('ADMIN', `/projects/${PROJECT_ID}?tab=members`);

    expect(await screen.findByRole('tab', { name: new RegExp(t('nav.members')) })).toBeInTheDocument();
    // The preview is not mounted: one panel at a time.
    expect(screen.queryByRole('heading', { name: t('shots.title'), level: 2 })).not.toBeInTheDocument();
  });

  it('hides the management tabs from an account that does not administer', async () => {
    mount('ARTIST');

    await screen.findByRole('heading', { name: 'Alpha', level: 1 });
    for (const label of [
      t('nav.members'),
      t('project.tab.shares'),
      t('admin.tab.settings'),
      t('admin.tab.trash'),
    ]) {
      expect(screen.queryByRole('tab', { name: new RegExp(label) })).not.toBeInTheDocument();
    }
    // The read-only tabs, on the other hand, stay there.
    expect(screen.getByRole('tab', { name: new RegExp(`^${t('shots.title')}`) })).toBeInTheDocument();
  });

  it('shows the ShotGrid tab only on a project that is really linked', async () => {
    const { unmount } = mount();
    await screen.findByRole('heading', { name: 'Alpha', level: 1 });
    expect(screen.queryByRole('tab', { name: new RegExp(t('shotgrid.tab.label')) })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ProjectPage />, {
      route: `/projects/${PROJECT_ID}`,
      path: '/projects/:id',
      api: {
        ...baseApi,
        [`GET /api/shotgrid/projects/${PROJECT_ID}/connection`]: {
          connection: { id: 1, active: true, sgProjectId: 55, sgProjectName: 'Alpha' },
        },
      },
    });

    expect(await screen.findByRole('tab', { name: new RegExp(t('shotgrid.tab.label')) })).toBeInTheDocument();
  });
});
