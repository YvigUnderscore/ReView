// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import { QueryObserver } from '@tanstack/react-query';
import SetupPage from '../../v2/pages/SetupPage';
import { useAuth } from '../../v2/stores/useAuth';
import { clearTokens, getToken } from '../../lib/apiClient';
import { qk } from '../../v2/lib/query';
import { t } from '../../v2/i18n';
import { renderWithProviders } from '../renderWithProviders';

/**
 * First install. The router offers only /setup while the cached setup status says it is needed, and that
 * status is fetched once: the page must mark the setup as done, or the new admin is sent back to an empty
 * setup form instead of their studio.
 */

beforeEach(clearTokens);

const admin = {
  id: 1,
  email: 'admin@review.local',
  name: 'Admin',
  displayName: 'Admin',
  initials: 'A',
  avatarUrl: null,
  status: 'ONLINE',
  role: 'ADMIN',
};

describe('SetupPage', () => {
  it('opens the session, marks the setup as done and leaves for the studio', async () => {
    const HOME_PROBE = 'home-reached';
    const { user, api, queryClient, currentPath } = renderWithProviders(<SetupPage />, {
      route: '/setup',
      path: '/setup',
      user: null,
      api: { 'POST /api/setup': { token: 'access-token', user: admin } },
      extraRoutes: <Route path="/" element={<div>{HOME_PROBE}</div>} />,
    });
    // The app shell's status query, as App.tsx holds it (an observer keeps it from being collected).
    queryClient.setQueryData(qk.setupStatus, { needsSetup: true });
    const status = new QueryObserver(queryClient, { queryKey: qk.setupStatus, enabled: false });
    const unsubscribe = status.subscribe(() => undefined);

    await user.type(screen.getByLabelText(t('setup.studioName')), 'E2E Studio');
    await user.click(screen.getByRole('button', { name: t('setup.continue') }));
    await user.type(screen.getByLabelText(t('setup.adminEmail')), admin.email);
    await user.type(screen.getByLabelText(t('setup.password')), 'admin1234');
    await user.click(screen.getByRole('button', { name: t('setup.submit') }));

    expect(await screen.findByText(HOME_PROBE)).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(status.getCurrentResult().data).toEqual({ needsSetup: false });
    unsubscribe();
    expect(getToken()).toBe('access-token');
    expect(useAuth.getState().user?.email).toBe(admin.email);
    expect(api.called('POST /api/setup')).toHaveLength(1);
  });
});
