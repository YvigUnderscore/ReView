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
 * La liste des projets est le premier écran d'un studio, et le premier à mentir : elle a
 * longtemps affiché sa première page comme si c'était tout le catalogue. Ce fichier tient
 * les quatre états qui comptent — chargement, vide, peuplé, tronqué — et surtout la
 * frontière entre les deux premiers : annoncer « aucun projet » pendant le chargement
 * ferait croire à une perte de données.
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
  it('n’annonce pas une liste vide tant que la réponse n’est pas arrivée', async () => {
    const pending = deferred<ReturnType<typeof page<Project>>>();
    const { container } = mount({ 'GET /api/projects': () => pending.promise });

    // Le squelette tient la place ; ni l'état vide ni une carte ne sont affichés.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(t('projects.empty.title'))).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    pending.resolve(page([project(1, 'Alpha')]));
    expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('propose la création quand le studio n’a encore aucun projet', async () => {
    mount({ 'GET /api/projects': page<Project>([]) });

    expect(await screen.findByText(t('projects.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(t('projects.empty.canManage'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('projects.empty.action') })).toBeInTheDocument();
  });

  it('n’offre pas la création à un compte qui n’administre pas', async () => {
    mount({ 'GET /api/projects': page<Project>([]) }, 'ARTIST');

    expect(await screen.findByText(t('projects.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(t('projects.empty.member'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('common.create') })).not.toBeInTheDocument();
  });

  it('rend une carte par projet, chacune pointant sur son URL parlante', async () => {
    mount({ 'GET /api/projects': page([project(12, 'Alpha Centauri'), project(34, 'Bêta Pictoris')]) });

    const first = await screen.findByRole('link', { name: /Alpha Centauri/ });
    expect(first).toHaveAttribute('href', '/projects/alpha-centauri-12');
    expect(screen.getByRole('link', { name: /Bêta Pictoris/ })).toHaveAttribute(
      'href',
      '/projects/beta-pictoris-34',
    );
    // Le compteur annonce le total du serveur, pas la taille de la page rendue.
    expect(screen.getByText(t('projects.count', { count: 2 }))).toBeInTheDocument();
  });

  it('dit ce qui reste à charger et va chercher la page suivante à la demande', async () => {
    const { user, api } = mount({
      'GET /api/projects': ({ url }: MockRequest) =>
        url.searchParams.get('page') === '2'
          ? page([project(3, 'Gamma')], { total: 3, hasMore: false })
          : page([project(1, 'Alpha'), project(2, 'Beta')], { total: 3, hasMore: true }),
    });

    // Deux lignes sur trois : la troncature est dite, pas subie.
    expect(await screen.findByText(t('list.countOf', { loaded: '2', total: '3' }))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Gamma/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('list.loadMore') }));

    expect(await screen.findByRole('link', { name: /Gamma/ })).toBeInTheDocument();
    // Une fois tout descendu, la sentinelle disparaît et le compteur redevient le total.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('list.loadMore') })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(t('projects.count', { count: 3 }))).toBeInTheDocument();
    expect(api.called('GET /api/projects')).toHaveLength(2);
  });

  it('crée un projet depuis le dialogue et rafraîchit la liste', async () => {
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
    // Retour visible : la liste invalidée réaffiche le projet fraîchement créé.
    expect(await screen.findByRole('link', { name: /Nouveau/ })).toBeInTheDocument();
  });
});
