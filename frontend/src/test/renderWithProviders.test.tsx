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
 * The harness is the foundation of all the screen tests: if it lies about the session, the URL
 * or the network, forty tests lie with it. So we verify its
 * four promises, on a tiny component whose every aspect we control.
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
  it('mounts the screen under the requested route pattern, parameters included', async () => {
    renderWithProviders(<Probe />, {
      route: '/projects/12?tab=shots',
      path: '/projects/:id',
      api: { 'GET /api/probe': { label: 'ok' } },
    });

    expect(screen.getByText('id:12')).toBeInTheDocument();
    expect(await screen.findByText('label:ok')).toBeInTheDocument();
  });

  it('opens an administrator session by default, and nothing at all on `null`', () => {
    const { unmount } = renderWithProviders(<Probe />, { api: { 'GET /api/probe': {} } });
    expect(screen.getByText('role:ADMIN')).toBeInTheDocument();
    unmount();

    renderWithProviders(<Probe />, { user: null, api: { 'GET /api/probe': {} } });
    expect(screen.getByText('role:anonymous')).toBeInTheDocument();
    expect(useAuth.getState().user).toBeNull();
  });

  it('only replaces what is passed to it from the session', () => {
    renderWithProviders(<Probe />, { user: { role: 'ARTIST' }, api: { 'GET /api/probe': {} } });

    expect(screen.getByText('role:ARTIST')).toBeInTheDocument();
    // The rest of the default account is kept: a test on the role does not have to rewrite
    // a complete identity.
    expect(useAuth.getState().user?.email).toBe('admin@review.local');
  });

  it('follows the memory router URL on each navigation', async () => {
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

  it('lets a test tighten a response set by default by the harness', async () => {
    const { api: mock } = renderWithProviders(<Probe />, {
      api: {
        'GET /api/probe': {},
        // `GET /api/notifications` is one of the default answers: redefining it must
        // win, otherwise no test could take an interest in it.
        'GET /api/notifications': { notifications: [{ id: 1 }], unread: 1 },
      },
    });

    const res = await fetch('/api/notifications');
    expect(await res.json()).toEqual({ notifications: [{ id: 1 }], unread: 1 });
    expect(mock.unhandled).toEqual([]);
  });

  it('starts from a fresh cache: two successive mounts query the server twice', async () => {
    const first = renderWithProviders(<Probe />, { api: { 'GET /api/probe': { label: 'un' } } });
    expect(await screen.findByText('label:un')).toBeInTheDocument();
    expect(first.api.called('GET /api/probe')).toHaveLength(1);
    first.unmount();

    const second = renderWithProviders(<Probe />, { api: { 'GET /api/probe': { label: 'deux' } } });
    expect(await screen.findByText('label:deux')).toBeInTheDocument();
    expect(second.api.called('GET /api/probe')).toHaveLength(1);
  });
});
