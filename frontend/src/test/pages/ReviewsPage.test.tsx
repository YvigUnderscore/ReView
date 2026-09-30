// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReviewsPage from '../../v2/pages/ReviewsPage';
import type { ReviewItem } from '../../v2/pages/reviews/reviewsTypes';
import type { MockResolver } from '../apiMock';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * La page Reviews affiche cent cartes, chacune avec son menu contextuel Radix, sa case
 * cochable et son aperçu animé. Cocher **une** case en re-rendait cent : les descripteurs
 * de menu étaient recréés à chaque rendu de la page, donc aucune carte ne pouvait être
 * mémoïsée. Sur une grille pleine, chaque clic de sélection coûtait plusieurs centaines
 * de millisecondes.
 *
 * La grandeur mesurée ici est donc un **nombre de rendus de carte**, compté sur le calcul
 * que chaque carte fait une fois par rendu — son lien de review.
 */
const probe = vi.hoisted(() => ({ cardRenders: 0 }));

vi.mock('../../v2/lib/slug', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../v2/lib/slug')>();
  return {
    ...actual,
    reviewPath: (media: { id: number; originalName?: string | null }) => {
      probe.cardRenders += 1;
      return actual.reviewPath(media);
    },
  };
});

const item = (id: number): ReviewItem => ({
  id,
  kind: 'VIDEO',
  name: `shot_${String(id).padStart(4, '0')}.mov`,
  published: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  thumbnailUrl: 'https://minio/thumb.jpg',
  hoverSprite: null,
  location: 'SEQ010',
  versionId: 1000 + id,
  versionName: 'v001',
  reviewStatus: null,
  project: { id: 1, name: 'Alpha' },
  uploader: null,
});

const mount = (items: ReviewItem[], extra: Record<string, MockResolver> = {}) =>
  renderWithProviders(<ReviewsPage />, {
    route: '/reviews',
    path: '/reviews',
    api: {
      // L'encart « assigned to me » disparaît quand il est vide : il ne rend alors
      // aucune carte, et ne pèse pas sur le compteur.
      'GET /api/media/reviews?assigned=me&pageSize=6': { items: [], total: 0 },
      'GET /api/media/reviews': page(items),
      'GET /api/projects': page([]),
      ...extra,
    },
  });

describe('ReviewsPage — coût d’un clic de sélection', () => {
  it('rend une carte par média', async () => {
    mount([item(1), item(2)]);

    expect(await screen.findByText('shot_0001.mov')).toBeInTheDocument();
    expect(screen.getByText('shot_0002.mov')).toBeInTheDocument();
  });

  it('ne re-rend que la carte dont la case change', async () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1));
    const { user } = mount(items);

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(items.length);
    // La liste est posée et les requêtes retombées : ce qui suit n'est dû qu'au clic.
    await waitFor(() => expect(screen.getByText('shot_0030.mov')).toBeInTheDocument());
    const before = probe.cardRenders;

    await user.click(boxes[0]);
    await waitFor(() => expect(boxes[0]).toHaveAttribute('aria-checked', 'true'));

    // Une carte re-rendue — celle qu'on vient de cocher — et pas trente.
    expect(probe.cardRenders - before).toBe(1);
  });
});
