// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router-dom';
import LoginPage from '../../v2/pages/LoginPage';
import { useAuth } from '../../v2/stores/useAuth';
import { getToken } from '../../lib/apiClient';
import { t } from '../../v2/i18n';
import { httpError } from '../apiMock';
import { renderWithProviders } from '../renderWithProviders';

/**
 * The entry door. What must hold: a refusal leaves the screen usable and says
 * why, a success opens the session **and** leaves the page. The labels are
 * computed by `t()` rather than copied: a rewording of the catalog must not
 * break a test that talks about behaviour.
 */

const CREDENTIALS = { email: 'ada@review.local', password: 'hunter2hunter2' };

/** Landmark of the destination: its presence proves the router did leave /login. */
const HOME_PROBE = 'home-reached';

const account = {
  id: 7,
  email: CREDENTIALS.email,
  name: 'Ada Lovelace',
  displayName: 'Ada',
  initials: 'AL',
  avatarUrl: null,
  status: 'ONLINE',
  role: 'ARTIST',
};

const fillAndSubmit = async (user: ReturnType<typeof renderWithProviders>['user']) => {
  await user.type(screen.getByLabelText(t('login.email')), CREDENTIALS.email);
  await user.type(screen.getByLabelText(t('login.password')), CREDENTIALS.password);
  await user.click(screen.getByRole('button', { name: t('login.submit') }));
};

describe('LoginPage', () => {
  it('refuses wrong credentials without leaving the page or opening a session', async () => {
    const { user, api, currentPath } = renderWithProviders(<LoginPage />, {
      route: '/login',
      path: '/login',
      user: null,
      api: { 'POST /api/auth/login': httpError(401, 'Invalid credentials') },
    });

    await fillAndSubmit(user);

    expect(await screen.findByText(t('login.error.credentials'))).toBeInTheDocument();
    expect(useAuth.getState().user).toBeNull();
    expect(getToken()).toBeNull();
    expect(currentPath()).toBe('/login');
    // The message stays readable: the form did not stay stuck on "signing in…".
    expect(screen.getByRole('button', { name: t('login.submit') })).toBeEnabled();
    expect(api.called('POST /api/auth/login')).toHaveLength(1);
  });

  it('opens the session and leaves the sign-in page when the server accepts', async () => {
    const { user, api, currentPath } = renderWithProviders(<LoginPage />, {
      route: '/login',
      path: '/login',
      user: null,
      api: {
        'POST /api/auth/login': { token: 'access-token', refreshToken: 'renew-token', user: account },
      },
      extraRoutes: <Route path="/" element={<div>{HOME_PROBE}</div>} />,
    });

    await fillAndSubmit(user);

    expect(await screen.findByText(HOME_PROBE)).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(useAuth.getState().user?.email).toBe(CREDENTIALS.email);
    // Both tokens are set: without the renewal token, the session dies at the
    // first 401 instead of being replayed.
    expect(getToken()).toBe('access-token');
    expect(localStorage.getItem('refreshToken')).toBe('renew-token');
    // The password goes out as is in the body, not in the URL.
    const [call] = api.called('POST /api/auth/login');
    expect(call.body).toEqual(CREDENTIALS);
    expect(call.url.search).toBe('');
  });

  it('asks for the one-time code when the account has two-factor authentication', async () => {
    const { user } = renderWithProviders(<LoginPage />, {
      route: '/login',
      path: '/login',
      user: null,
      api: { 'POST /api/auth/login': { requires2fa: true, tmpToken: 'tmp-1' } },
    });

    await fillAndSubmit(user);

    expect(await screen.findByText(t('twofa.title'))).toBeInTheDocument();
    // No session until the code is verified.
    expect(useAuth.getState().user).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByLabelText(t('login.password'))).not.toBeInTheDocument();
  });

  it('replaces the form with the provider button in "SSO only" mode', async () => {
    renderWithProviders(<LoginPage />, {
      route: '/login',
      path: '/login',
      user: null,
      api: {
        'GET /api/auth/oidc/status': {
          enabled: true,
          label: 'Studio SSO',
          logoUrl: null,
          passwordLogin: false,
        },
      },
    });

    expect(await screen.findByRole('link', { name: 'Studio SSO' })).toBeInTheDocument();
    expect(screen.queryByLabelText(t('login.password'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('login.submit') })).not.toBeInTheDocument();
  });
});
