// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import ProjectsPage from '../../v2/pages/ProjectsPage';
import type { Project } from '../../v2/types/api';
import { t } from '../../v2/i18n';
import { deferred, type MockRequest, type MockResolver } from '../apiMock';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * The project list is the first screen of a studio, and the first to lie: it long
 * displayed its first page as if it were the whole catalog. This file holds the
 * four states that matter (loading, empty, populated, truncated), and above all the
 * boundary between the first two: announcing "no project" while loading
 * would suggest a data loss.
 */

const project = (id: number, name: string): Project => ({
  id,
  name,
  description: null,
  status: 'ACTIVE',
  thumbnailUrl: null,
});

const mount = (api: Record<string, MockResolver>, role?: 'ADMIN' | 'ARTIST') =>
  renderWithProviders(<ProjectsPage />, {
    route: '/projects',
    path: '/projects',
    user: role ? { role } : undefined,
    api,
  });

describe('ProjectsPage', () => {
  it('does not announce an empty list before the response arrives', async () => {
    const pending = deferred<ReturnType<typeof page<Project>>>();
    const { container } = mount({ 'GET /api/projects': () => pending.promise });

    // The skeleton holds the place; neither the empty state nor a card is shown.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(t('projects.empty.title'))).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    pending.resolve(page([project(1, 'Alpha')]));
    expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('offers creation when the studio has no project yet', async () => {
    mount({ 'GET /api/projects': page<Project>([]) });

    expect(await screen.findByText(t('projects.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(t('projects.empty.canManage'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('projects.empty.action') })).toBeInTheDocument();
  });

  it('does not offer creation to an account that does not administer', async () => {
    mount({ 'GET /api/projects': page<Project>([]) }, 'ARTIST');

    expect(await screen.findByText(t('projects.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(t('projects.empty.member'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('common.create') })).not.toBeInTheDocument();
  });

  it('renders one card per project, each pointing to its readable URL', async () => {
    mount({ 'GET /api/projects': page([project(12, 'Alpha Centauri'), project(34, 'Bêta Pictoris')]) });

    const first = await screen.findByRole('link', { name: /Alpha Centauri/ });
    expect(first).toHaveAttribute('href', '/projects/alpha-centauri-12');
    expect(screen.getByRole('link', { name: /Bêta Pictoris/ })).toHaveAttribute(
      'href',
      '/projects/beta-pictoris-34',
    );
    // The counter announces the server total, not the size of the rendered page.
    expect(screen.getByText(t('projects.count', { count: 2 }))).toBeInTheDocument();
  });

  it('says what remains to load and fetches the next page on demand', async () => {
    const { user, api } = mount({
      'GET /api/projects': ({ url }: MockRequest) =>
        url.searchParams.get('page') === '2'
          ? page([project(3, 'Gamma')], { total: 3, hasMore: false })
          : page([project(1, 'Alpha'), project(2, 'Beta')], { total: 3, hasMore: true }),
    });

    // Two lines out of three: the truncation is stated, not suffered.
    expect(await screen.findByText(t('list.countOf', { loaded: '2', total: '3' }))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Gamma/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('list.loadMore') }));

    expect(await screen.findByRole('link', { name: /Gamma/ })).toBeInTheDocument();
    // Once everything is down, the sentinel disappears and the counter goes back to the total.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('list.loadMore') })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(t('projects.count', { count: 3 }))).toBeInTheDocument();
    expect(api.called('GET /api/projects')).toHaveLength(2);
  });

  it('creates a project from the dialog and refreshes the list', async () => {
    let created = false;
    const { user, api } = mount({
      'GET /api/projects': () => (created ? page([project(9, 'Nouveau')]) : page<Project>([])),
      'POST /api/projects': () => {
        created = true;
        return { project: project(9, 'Nouveau') };
      },
    });

    await user.click(await screen.findByRole('button', { name: t('projects.empty.action') }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByPlaceholderText(t('projects.name.placeholder')), 'Nouveau');
    await user.click(within(dialog).getByRole('button', { name: t('common.create') }));

    expect(api.called('POST /api/projects')[0]?.body).toEqual({ name: 'Nouveau' });
    // Visible feedback: the invalidated list redisplays the freshly created project.
    expect(await screen.findByRole('link', { name: /Nouveau/ })).toBeInTheDocument();
  });
});
