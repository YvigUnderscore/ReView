// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Link, Route, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/apiClient';
import { useAuth } from '../v2/stores/useAuth';
import { renderWithProviders } from './renderWithProviders';

/**
 * Le harnais est le socle de tous les tests d'écran : s'il ment sur la session, sur l'URL
 * ou sur le réseau, ce sont quarante tests qui mentent avec lui. On vérifie donc ses
 * quatre promesses, sur un composant minuscule dont on maîtrise tout.
 */

function Probe() {
  const { id } = useParams();
  const role = useAuth((s) => s.user?.role ?? 'anonymous');
  const { data } = useQuery({
    queryKey: ['probe'],
    queryFn: () => api.get<{ label: string }>('/api/probe'),
  });
  return (
    <div>
      <p>{`id:${id ?? 'none'}`}</p>
      <p>{`role:${role}`}</p>
      <p>{`label:${data?.label ?? 'pending'}`}</p>
      <Link to="/ailleurs">go</Link>
    </div>
  );
}

describe('renderWithProviders', () => {
  it('monte l’écran sous le motif de route demandé, paramètres compris', async () => {
    renderWithProviders(<Probe />, {
      route: '/projects/12?tab=shots',
      path: '/projects/:id',
      api: { 'GET /api/probe': { label: 'ok' } },
    });

    expect(screen.getByText('id:12')).toBeInTheDocument();
    expect(await screen.findByText('label:ok')).toBeInTheDocument();
  });

  it('ouvre une session d’administrateur par défaut, et rien du tout sur `null`', () => {
    const { unmount } = renderWithProviders(<Probe />, { api: { 'GET /api/probe': {} } });
    expect(screen.getByText('role:ADMIN')).toBeInTheDocument();
    unmount();

    renderWithProviders(<Probe />, { user: null, api: { 'GET /api/probe': {} } });
    expect(screen.getByText('role:anonymous')).toBeInTheDocument();
    expect(useAuth.getState().user).toBeNull();
  });

  it('ne remplace que ce qu’on lui passe de la session', () => {
    renderWithProviders(<Probe />, { user: { role: 'ARTIST' }, api: { 'GET /api/probe': {} } });

    expect(screen.getByText('role:ARTIST')).toBeInTheDocument();
    // Le reste du compte par défaut est conservé : un test sur le rôle n'a pas à réécrire
    // une identité complète.
    expect(useAuth.getState().user?.email).toBe('admin@review.local');
  });

  it('suit l’URL du routeur mémoire à chaque navigation', async () => {
    const { user, currentPath } = renderWithProviders(<Probe />, {
      route: '/depart',
      path: '/depart',
      api: { 'GET /api/probe': {} },
      extraRoutes: <Route path="/ailleurs" element={<p>arrivée</p>} />,
    });

    expect(currentPath()).toBe('/depart');
    await user.click(screen.getByRole('link', { name: 'go' }));

    expect(await screen.findByText('arrivée')).toBeInTheDocument();
    await waitFor(() => expect(currentPath()).toBe('/ailleurs'));
  });

  it('laisse un test resserrer une réponse posée d’office par le harnais', async () => {
    const { api: mock } = renderWithProviders(<Probe />, {
      api: {
        'GET /api/probe': {},
        // `GET /api/notifications` fait partie des réponses par défaut : la redéfinir doit
        // gagner, sinon aucun test ne pourrait s'y intéresser.
        'GET /api/notifications': { notifications: [{ id: 1 }], unread: 1 },
      },
    });

    const res = await fetch('/api/notifications');
    expect(await res.json()).toEqual({ notifications: [{ id: 1 }], unread: 1 });
    expect(mock.unhandled).toEqual([]);
  });

  it('repart d’un cache neuf : deux montages successifs interrogent deux fois le serveur', async () => {
    const first = renderWithProviders(<Probe />, { api: { 'GET /api/probe': { label: 'un' } } });
    expect(await screen.findByText('label:un')).toBeInTheDocument();
    expect(first.api.called('GET /api/probe')).toHaveLength(1);
    first.unmount();

    const second = renderWithProviders(<Probe />, { api: { 'GET /api/probe': { label: 'deux' } } });
    expect(await screen.findByText('label:deux')).toBeInTheDocument();
    expect(second.api.called('GET /api/probe')).toHaveLength(1);
  });
});
