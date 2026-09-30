// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import AdminPage from '../../v2/pages/AdminPage';
import { t } from '../../v2/i18n';
import type { MockResolver } from '../apiMock';
import { renderWithProviders } from '../renderWithProviders';

/**
 * L'administration porte vingt-sept sections derrière une seule route. Deux garanties
 * suffisent à la tenir : le rôle décide de l'accès (et pas d'une section en particulier —
 * la page entière), et l'URL décide de la section montée, elle seule. Le contenu de chaque
 * section a ses propres tests ; ici on teste l'aiguillage.
 */

const stats = {
  users: { total: 12, byRole: { ADMIN: 1 }, online: 3 },
  pipeline: { projects: 4, sequences: 9, shots: 120, assets: 30, versions: 400 },
  media: { count: 380, byKind: { VIDEO: 300 }, byStatus: { READY: 380 }, storageBytes: 1024 },
  comments: 88,
  jobs: null,
  topStorageUsers: [],
};

const api: Record<string, MockResolver> = {
  'GET /api/admin/stats': stats,
  'GET /api/admin/system': {
    host: {
      platform: 'linux',
      arch: 'x64',
      nodeVersion: 'v22.0.0',
      cpus: 8,
      loadAvg: [0, 0, 0],
      uptimeSec: 10,
      processUptimeSec: 5,
    },
    memory: { total: 16, free: 8, used: 8, processRss: 1 },
    disk: null,
    services: { database: true, redis: true, minio: true },
  },
  'GET /api/users': {
    users: [
      {
        id: 4,
        email: 'lea@review.local',
        name: 'Lea Nord',
        role: 'ARTIST',
        status: 'ONLINE',
        initials: 'LN',
        displayName: 'Lea',
        avatarUrl: null,
      },
    ],
  },
  'GET /api/admin/users/4': {
    user: {
      id: 4,
      email: 'lea@review.local',
      name: 'Lea Nord',
      displayName: 'Lea',
      initials: 'LN',
      avatarUrl: null,
      role: 'ARTIST',
      status: 'ONLINE',
      storageUsed: 0,
      storageLimit: null,
      lastSeenAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
    },
    memberships: [],
    sessions: [],
    apiTokens: [],
    activity: [],
    counts: { media: 0, versions: 0, comments: 0, tasks: 0 },
  },
};

/**
 * Vignette « commentaires » du tableau de bord, repérée par son nom accessible : la valeur
 * puis le libellé. Les espaces sont ignorés — leur présence dépend du calcul de nom
 * accessible, pas de l'écran.
 */
const COMMENTS_METRIC = (name: string): boolean =>
  name.replace(/\s+/g, '') === `88${t('admin.tab.comments')}`;

const mount = (route: string, path: string, role: 'ADMIN' | 'SUPERVISOR' = 'ADMIN') =>
  renderWithProviders(<AdminPage />, { route, path, user: { role }, api });

describe('AdminPage', () => {
  it('ferme la page entière à un compte qui n’est pas administrateur', () => {
    mount('/admin', '/admin', 'SUPERVISOR');

    expect(screen.getByText(t('admin.restricted'))).toBeInTheDocument();
    // Pas de barre latérale : aucune section n'est même nommée.
    expect(screen.queryByRole('link', { name: new RegExp(t('admin.tab.users')) })).not.toBeInTheDocument();
  });

  it('ouvre le tableau de bord par défaut et propose chaque section en lien direct', async () => {
    mount('/admin', '/admin');

    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: new RegExp(t('admin.tab.dashboard')) })).toHaveAttribute(
      'href',
      '/admin/overview',
    );
    expect(within(nav).getByRole('link', { name: new RegExp(t('admin.tab.users')) })).toHaveAttribute(
      'href',
      '/admin/users',
    );
    // Les sections sont rangées par groupe, pas jetées en vrac.
    expect(within(nav).getByText(t('admin.group.studio'))).toBeInTheDocument();
    expect(within(nav).getByText(t('admin.group.maintenance'))).toBeInTheDocument();
    // Le tableau de bord est bien celui qui est monté : ses compteurs viennent du serveur.
    expect(await screen.findByRole('link', { name: COMMENTS_METRIC })).toHaveAttribute(
      'href',
      '/admin/comments',
    );
  });

  it('monte la section nommée dans l’URL, pas le tableau de bord', async () => {
    mount('/admin/users', '/admin/:section');

    expect(await screen.findByPlaceholderText(t('users.searchPlaceholder'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: COMMENTS_METRIC })).not.toBeInTheDocument();
  });

  it('bascule sur la fiche détaillée quand l’URL porte un identifiant', async () => {
    mount('/admin/users/4', '/admin/:section/:id');

    // La liste laisse la place à la fiche : plus de champ de recherche.
    expect(await screen.findByText('lea@review.local')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t('users.searchPlaceholder'))).not.toBeInTheDocument();
  });

  it('retombe sur le tableau de bord quand la section de l’URL n’existe pas', async () => {
    mount('/admin/section-fantome', '/admin/:section');

    expect(await screen.findByRole('link', { name: COMMENTS_METRIC })).toBeInTheDocument();
  });
});
