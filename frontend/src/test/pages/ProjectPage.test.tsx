// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ProjectPage from '../../v2/pages/ProjectPage';
import { t } from '../../v2/i18n';
import type { MockResolver } from '../apiMock';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * La page projet est une barre d'onglets et un routeur déguisé : l'onglet vit dans l'URL
 * (partage de lien, retour navigateur), et la moitié des onglets n'existe que pour qui
 * administre le projet. Ce sont ces deux règles qu'on tient ici — pas le contenu de chaque
 * onglet, qui a ses propres écrans.
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

// Les onglets portent désormais `role="tab"` et `aria-selected` : sans eux, la synthèse
// vocale n'annonçait que des boutons interchangeables, sans dire lequel était actif.
describe('ProjectPage', () => {
  it('ouvre l’aperçu par défaut et sort le nom du projet du serveur', async () => {
    mount();

    expect(await screen.findByRole('heading', { name: 'Alpha', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: new RegExp(t('project.tab.overview')) })).toBeInTheDocument();
  });

  it('compte les plans et les assets d’après le total du serveur, pas la page chargée', async () => {
    mount();

    // 42 plans existent, aucun n'est encore descendu : le badge doit dire 42.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: new RegExp(`^${t('shots.title')}`) })).toHaveTextContent('42'),
    );
    expect(screen.getByRole('tab', { name: /^Assets/ })).toHaveTextContent('7');
  });

  it('écrit l’onglet actif dans l’URL pour qu’un lien s’ouvre au bon endroit', async () => {
    const { user, currentPath } = mount();

    await user.click(await screen.findByRole('tab', { name: new RegExp(`^${t('shots.title')}`) }));

    await waitFor(() => expect(currentPath()).toContain('tab=shots'));
    // Le panneau a suivi : l'en-tête de la section des plans est monté.
    expect(await screen.findByRole('heading', { name: t('shots.title'), level: 2 })).toBeInTheDocument();
  });

  it('monte directement l’onglet demandé par l’URL', async () => {
    mount('ADMIN', `/projects/${PROJECT_ID}?tab=members`);

    expect(await screen.findByRole('tab', { name: new RegExp(t('nav.members')) })).toBeInTheDocument();
    // L'aperçu n'est pas monté : un seul panneau à la fois.
    expect(screen.queryByRole('heading', { name: t('shots.title'), level: 2 })).not.toBeInTheDocument();
  });

  it('cache les onglets de gestion à un compte qui n’administre pas', async () => {
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
    // Les onglets de consultation, eux, restent là.
    expect(screen.getByRole('tab', { name: new RegExp(`^${t('shots.title')}`) })).toBeInTheDocument();
  });

  it('n’affiche l’onglet ShotGrid que sur un projet réellement relié', async () => {
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
