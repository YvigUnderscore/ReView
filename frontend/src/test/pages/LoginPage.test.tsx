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
 * La porte d'entrée. Ce qui doit tenir : un refus laisse l'écran utilisable et dit
 * pourquoi, une réussite ouvre la session **et** quitte la page. Les libellés sont
 * calculés par `t()` plutôt que recopiés — une reformulation du catalogue ne doit pas
 * casser un test qui, lui, parle du comportement.
 */

const CREDENTIALS = { email: 'ada@review.local', password: 'hunter2hunter2' };

/** Repère de la destination : sa présence prouve que le routeur a bien quitté /login. */
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
  it('refuse des identifiants faux sans quitter la page ni ouvrir de session', async () => {
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
    // Le message reste lisible : le formulaire n'est pas resté bloqué en « connexion… ».
    expect(screen.getByRole('button', { name: t('login.submit') })).toBeEnabled();
    expect(api.called('POST /api/auth/login')).toHaveLength(1);
  });

  it('ouvre la session et quitte la page de connexion quand le serveur accepte', async () => {
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
    // Les deux jetons sont posés : sans le jeton de renouvellement, la session meurt au
    // premier 401 au lieu de se rejouer.
    expect(getToken()).toBe('access-token');
    expect(localStorage.getItem('refreshToken')).toBe('renew-token');
    // Le mot de passe part bien tel quel dans le corps, pas dans l'URL.
    const [call] = api.called('POST /api/auth/login');
    expect(call.body).toEqual(CREDENTIALS);
    expect(call.url.search).toBe('');
  });

  it('demande le code à usage unique quand le compte porte une double authentification', async () => {
    const { user } = renderWithProviders(<LoginPage />, {
      route: '/login',
      path: '/login',
      user: null,
      api: { 'POST /api/auth/login': { requires2fa: true, tmpToken: 'tmp-1' } },
    });

    await fillAndSubmit(user);

    expect(await screen.findByText(t('twofa.title'))).toBeInTheDocument();
    // Aucune session tant que le code n'est pas vérifié.
    expect(useAuth.getState().user).toBeNull();
    expect(getToken()).toBeNull();
    expect(screen.queryByLabelText(t('login.password'))).not.toBeInTheDocument();
  });

  it('remplace le formulaire par le bouton du fournisseur en mode « SSO seul »', async () => {
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
