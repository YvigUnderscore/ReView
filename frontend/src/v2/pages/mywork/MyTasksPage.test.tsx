// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import MyTasksPage from '../MyTasksPage';
import { t } from '../../i18n';

/**
 * The "my tasks" page, destination of the two personal counters on the home page.
 *
 * Its filter lives in the URL, otherwise the "my retakes" card could not open its view: that was
 * the whole defect of the former `#my-tasks` anchor.
 */

const task = {
  id: 4,
  name: 'Compositing',
  type: 'COMP',
  status: 'RETAKE',
  location: 'SQ01 · SH010',
  projectId: 7,
  projectName: 'Dock',
  dueDate: null,
};

const mount = (route: string) =>
  renderWithProviders(<MyTasksPage />, {
    route,
    path: '/my-tasks',
    api: { 'GET /api/dashboard/tasks': { items: [task], total: 1, page: 1, pageSize: 100, hasMore: false } },
  });

describe('MyTasksPage', () => {
  it('unfolds the retake counter when the address asks for it', async () => {
    const { api } = mount('/my-tasks?scope=blocked');
    await waitFor(() => expect(api.called('GET /api/dashboard/tasks').length).toBeGreaterThan(0));
    expect(api.called('GET /api/dashboard/tasks').at(-1)!.url.searchParams.get('scope')).toBe('blocked');
    expect(await screen.findByText('Compositing')).toBeInTheDocument();
    expect(screen.getByText('Dock')).toBeInTheDocument();
  });

  it('shows all my tasks when no scope is requested', async () => {
    const { api } = mount('/my-tasks');
    await waitFor(() => expect(api.called('GET /api/dashboard/tasks').length).toBeGreaterThan(0));
    expect(api.called('GET /api/dashboard/tasks').at(-1)!.url.searchParams.get('scope')).toBeNull();
    expect(await screen.findByRole('combobox', { name: t('mywork.tasks.scopeAll') })).toHaveValue('all');
  });
});
