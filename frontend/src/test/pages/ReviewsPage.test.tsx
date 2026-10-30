// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReviewsPage from '../../v2/pages/ReviewsPage';
import type { ReviewItem } from '../../v2/pages/reviews/reviewsTypes';
import type { MockResolver } from '../apiMock';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * The Reviews page shows a hundred cards, each with its Radix context menu, its checkbox
 * and its animated preview. Ticking **one** box re-rendered all hundred: the menu descriptors
 * were recreated at each render of the page, so no card could be
 * memoized. On a full grid, each selection click cost several hundred
 * of milliseconds.
 *
 * The quantity measured here is therefore a **count of card renders**, counted on the computation
 * that each card does once per render: its review link.
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
      // The "assigned to me" box disappears when empty: it then renders
      // no card, and does not weigh on the counter.
      'GET /api/media/reviews?assigned=me&pageSize=6': { items: [], total: 0 },
      'GET /api/media/reviews': page(items),
      'GET /api/projects': page([]),
      ...extra,
    },
  });

describe('ReviewsPage — cost of a selection click', () => {
  it('renders one card per media', async () => {
    mount([item(1), item(2)]);

    expect(await screen.findByText('shot_0001.mov')).toBeInTheDocument();
    expect(screen.getByText('shot_0002.mov')).toBeInTheDocument();
  });

  it('re-renders only the card whose checkbox changes', async () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1));
    const { user } = mount(items);

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(items.length);
    // The list is set and the requests have settled: what follows is only due to the click.
    await waitFor(() => expect(screen.getByText('shot_0030.mov')).toBeInTheDocument());
    const before = probe.cardRenders;

    await user.click(boxes[0]);
    await waitFor(() => expect(boxes[0]).toHaveAttribute('aria-checked', 'true'));

    // One card re-rendered (the one we just ticked), and not thirty.
    expect(probe.cardRenders - before).toBe(1);
  });
});
