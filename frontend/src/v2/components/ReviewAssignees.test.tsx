// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import ReviewAssignees from './ReviewAssignees';
import { t } from '../i18n';

/**
 * Confier la review d'une version à quelqu'un.
 *
 * Ce qui se vérifie : la liste se lit par tout le monde mais ne s'écrit que par un
 * gestionnaire, un clic sur un nom l'ajoute d'un geste (pas de bouton « Enregistrer »
 * qu'on peut quitter sans l'avoir vu), et recliquer le retire — le même bouton doit faire
 * les deux, sinon retirer quelqu'un demande de chercher où.
 */

const PROJECT = {
  project: {
    id: 7,
    myRole: 'SUPERVISOR',
    memberships: [
      { role: 'ARTIST', user: { id: 4, name: 'Alice', email: 'alice@studio.test', role: 'ARTIST' } },
      { role: 'ARTIST', user: { id: 5, name: 'Bruno', email: 'bruno@studio.test', role: 'ARTIST' } },
    ],
  },
};

const reviewer = (id: number, name: string) => ({
  id,
  name,
  firstName: null,
  lastName: null,
  username: null,
  avatarUrl: null,
});

describe('ReviewAssignees', () => {
  it('dit que personne n’est chargé de la review, et propose d’en charger un', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: { 'GET /api/projects/:id': PROJECT, 'GET /api/versions/:id/reviewers': { reviewers: [] } },
    });
    expect(await screen.findByText(t('reviewers.none'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('reviewers.assign') })).toBeTruthy();
  });

  it('sans le droit d’assigner : la liste se lit, le bouton n’existe pas', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign={false} />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/versions/:id/reviewers': { reviewers: [reviewer(4, 'Alice')] },
      },
    });
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('reviewers.assign') })).toBeNull();
  });

  it('un clic sur un nom l’ajoute à la liste envoyée', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/versions/:id/reviewers': { reviewers: [] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Bruno'));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({ userIds: [5] });
  });

  it('recliquer une personne déjà chargée la retire', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/versions/:id/reviewers': { reviewers: [reviewer(4, 'Alice'), reviewer(5, 'Bruno')] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Alice'));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({ userIds: [5] });
  });
});
