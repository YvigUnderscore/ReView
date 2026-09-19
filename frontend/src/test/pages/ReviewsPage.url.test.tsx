// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import ReviewsPage from '../../v2/pages/ReviewsPage';
import { t } from '../../v2/i18n';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * Synchronisation URL ↔ filtres de la page Reviews.
 *
 * La page ignorait complètement la query-string : ses filtres vivaient dans un `useState`.
 * Aucune carte de l'Accueil ne pouvait donc ouvrir une vue filtrée — le seul lien possible
 * était « tout » —, un état de recherche ne se partageait pas, et le retour arrière du
 * navigateur quittait la page au lieu de défaire le dernier filtre.
 */

/** Retour arrière du navigateur, dans le routeur mémoire du test. */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      back
    </button>
  );
}

const mount = (route: string) =>
  renderWithProviders(
    <>
      <ReviewsPage />
      <BackButton />
    </>,
    {
      route,
      path: '/reviews',
      api: {
        'GET /api/media/reviews?assigned=me&pageSize=6': { items: [], total: 0 },
        'GET /api/media/reviews': page([]),
        'GET /api/projects': page([]),
      },
    },
  );

const kindSelect = () => screen.getByRole('combobox', { name: t('reviews.filter.allTypes') });

describe('ReviewsPage — filtres et URL', () => {
  it('lit les filtres dans l’adresse et les envoie au serveur', async () => {
    // C'est ce qui permet à un compteur de l'Accueil d'ouvrir SA vue.
    const { api } = mount('/reviews?assigned=me&decision=none');
    await waitFor(() => expect(api.called('GET /api/media/reviews').length).toBeGreaterThan(0));
    const asked = api.called('GET /api/media/reviews').at(-1)!.url;
    expect(asked.searchParams.get('assigned')).toBe('me');
    expect(asked.searchParams.get('decision')).toBe('none');
  });

  it('montre le filtre lu dans l’adresse, et non un sélecteur vide', async () => {
    mount('/reviews?kind=IMAGE');
    await waitFor(() => expect(kindSelect()).toHaveValue('IMAGE'));
  });

  it('écrit dans l’adresse le filtre qu’on pose', async () => {
    const { user, currentPath } = mount('/reviews');
    await waitFor(() => expect(kindSelect()).toBeInTheDocument());
    await user.selectOptions(kindSelect(), 'VIDEO');
    await waitFor(() => expect(currentPath()).toBe('/reviews?kind=VIDEO'));
  });

  it('défait le dernier filtre au retour arrière, au lieu de quitter la page', async () => {
    const { user, currentPath } = mount('/reviews');
    await waitFor(() => expect(kindSelect()).toBeInTheDocument());
    await user.selectOptions(kindSelect(), 'VIDEO');
    await waitFor(() => expect(currentPath()).toBe('/reviews?kind=VIDEO'));
    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(currentPath()).toBe('/reviews'));
    expect(kindSelect()).toHaveValue('');
  });
});
