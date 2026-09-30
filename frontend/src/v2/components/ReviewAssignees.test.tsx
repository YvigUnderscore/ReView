// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import ReviewAssignees from './ReviewAssignees';
import { t } from '../i18n';

/**
 * Confier la review d'une version à quelqu'un, et lui dire quoi regarder.
 *
 * Ce qui se vérifie : la liste se lit par tout le monde mais ne s'écrit que par un
 * gestionnaire, un clic sur un nom l'ajoute d'un geste (pas de bouton « Enregistrer »
 * qu'on peut quitter sans l'avoir vu), et recliquer le retire — le même bouton doit faire
 * les deux, sinon retirer quelqu'un demande de chercher où.
 *
 * Et, depuis la consigne : la personne part avec la sienne, et quand le projet EXIGE une
 * consigne, cliquer un nom ne l'assigne PAS tout de suite — il la met en attente le temps
 * qu'on écrive. L'assigner d'abord pour se faire refuser ensuite serait une fausse promesse.
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

const reviewer = (id: number, name: string, note: string | null = null) => ({
  id,
  name,
  firstName: null,
  lastName: null,
  username: null,
  avatarUrl: null,
  note,
});

/** Réglages du projet : par défaut, aucune consigne exigée. */
const settings = (requireNote = false) => ({
  settings: { reviewRequest: { requireNote, minNoteLength: 5 } },
});

describe('ReviewAssignees', () => {
  it('dit que personne n’est chargé de la review, et propose d’en charger un', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
      },
    });
    expect(await screen.findByText(t('reviewers.none'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('reviewers.assign') })).toBeTruthy();
  });

  it('sans le droit d’assigner : la liste se lit, le bouton n’existe pas', async () => {
    renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign={false} />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [reviewer(4, 'Alice', 'la lumière')] },
      },
    });
    expect(await screen.findByText('Alice')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('reviewers.assign') })).toBeNull();
  });

  it('un clic sur un nom l’ajoute à la liste envoyée', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Bruno'));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: null }],
    });
  });

  it('recliquer une personne déjà chargée la retire — sa consigne part avec elle', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(),
        'GET /api/versions/:id/reviewers': {
          reviewers: [reviewer(4, 'Alice'), reviewer(5, 'Bruno', 'le raccord')],
        },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno', 'le raccord')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    // Par le RÔLE : « Alice » apparaît aussi dans sa ligne de consigne, qui n'est pas un
    // bouton — c'est celui de l'annuaire qu'on veut recliquer.
    await user.click(await screen.findByRole('button', { name: /Alice/ }));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    // Bruno reste, AVEC sa consigne : un remplacement qui l'oublierait l'effacerait.
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: 'le raccord' }],
    });
  });

  it('consigne obligatoire : cliquer un nom met la personne en attente, sans rien écrire', async () => {
    const { user, api } = renderWithProviders(<ReviewAssignees versionId={42} projectId={7} canAssign />, {
      api: {
        'GET /api/projects/:id': PROJECT,
        'GET /api/projects/:id/settings': settings(true),
        'GET /api/versions/:id/reviewers': { reviewers: [] },
        'PUT /api/versions/:id/reviewers': { reviewers: [reviewer(5, 'Bruno', 'la lumière')] },
      },
    });
    await user.click(await screen.findByRole('button', { name: t('reviewers.assign') }));
    await user.click(await screen.findByText('Bruno'));
    // Rien n'est parti : le serveur aurait refusé, et l'écran l'aurait appris trop tard.
    expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(0);
    expect(screen.getByText(t('reviewers.noteRequired'))).toBeTruthy();

    await user.type(screen.getByLabelText(t('reviewers.noteLabel', { name: 'Bruno' })), 'la lumière');
    await user.click(screen.getByRole('button', { name: t('reviewers.confirm') }));
    await waitFor(() => expect(api.called('PUT /api/versions/:id/reviewers').length).toBe(1));
    expect(api.called('PUT /api/versions/:id/reviewers')[0].body).toEqual({
      reviewers: [{ userId: 5, note: 'la lumière' }],
    });
  });
});
