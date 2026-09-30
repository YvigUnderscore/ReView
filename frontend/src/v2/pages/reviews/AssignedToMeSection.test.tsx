// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, page } from '../../../test/renderWithProviders';
import AssignedToMeSection from './AssignedToMeSection';
import { t } from '../../i18n';

/**
 * L'encart « Assigned to me » de la page Reviews.
 *
 * Ce qui se vérifie : il ne parle que des reviews qu'on m'a confiées (il demande bien
 * `assigned=me`), il disparaît quand il n'y en a aucune — un cadre vide en tête de page
 * coûterait à tout le monde — et il propose de voir la file entière seulement quand elle
 * déborde de l'aperçu.
 */

const item = (id: number, name: string) => ({
  id,
  kind: 'VIDEO',
  name,
  published: true,
  createdAt: '2026-09-01T10:00:00Z',
  thumbnailUrl: null,
  hoverSprite: null,
  location: 'SQ01 · SH010 › Comp',
  versionName: 'V02',
  reviewStatus: null,
  project: { id: 7, name: 'Film' },
  uploader: 'Ana',
});

describe('AssignedToMeSection', () => {
  it('ne montre rien quand aucune review ne m’est confiée', async () => {
    const { api } = renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([]) },
    });
    await waitFor(() => expect(api.called('GET /api/media/reviews').length).toBe(1));
    // Le `<section>` du gestionnaire de toasts vit dans le même conteneur : c'est l'encart
    // nommé qu'on cherche, pas n'importe quelle section.
    expect(screen.queryByRole('region', { name: t('reviews.assigned.title') })).toBeNull();
  });

  it('n’interroge que mes reviews, et les montre', async () => {
    const { api } = renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 1 }) },
    });
    expect(await screen.findByText('plan.mp4')).toBeTruthy();
    const [call] = api.called('GET /api/media/reviews');
    expect(call.url.searchParams.get('assigned')).toBe('me');
    expect(screen.getByText(t('reviews.assigned.count', { count: 1 }))).toBeTruthy();
  });

  it('propose « tout voir » seulement quand la file dépasse l’aperçu', async () => {
    const onSeeAll = vi.fn();
    const { user } = renderWithProviders(<AssignedToMeSection onSeeAll={onSeeAll} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 12 }) },
    });
    await user.click(await screen.findByRole('button', { name: t('refs.seeAll') }));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it('ne propose pas « tout voir » quand tout est déjà à l’écran', async () => {
    renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 1 }) },
    });
    expect(await screen.findByText('plan.mp4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('refs.seeAll') })).toBeNull();
  });
});
