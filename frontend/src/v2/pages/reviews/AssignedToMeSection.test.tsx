// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, page } from '../../../test/renderWithProviders';
import AssignedToMeSection from './AssignedToMeSection';
import { t } from '../../i18n';

/**
 * The "Assigned to me" panel of the Reviews page.
 *
 * What is verified: it only lists the reviews assigned to me (it does request `assigned=me`), it
 * disappears when there are none — an empty frame at the top of the page would cost everyone —
 * and it offers to see the whole queue only when the queue overflows the preview.
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
  it('shows nothing when no review is assigned to me', async () => {
    const { api } = renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([]) },
    });
    await waitFor(() => expect(api.called('GET /api/media/reviews').length).toBe(1));
    // The toast manager's `<section>` lives in the same container: we are looking for the named
    // panel, not just any section.
    expect(screen.queryByRole('region', { name: t('reviews.assigned.title') })).toBeNull();
  });

  it('only queries my reviews, and shows them', async () => {
    const { api } = renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 1 }) },
    });
    expect(await screen.findByText('plan.mp4')).toBeTruthy();
    const [call] = api.called('GET /api/media/reviews');
    expect(call.url.searchParams.get('assigned')).toBe('me');
    expect(screen.getByText(t('reviews.assigned.count', { count: 1 }))).toBeTruthy();
  });

  it('offers "see all" only when the queue exceeds the preview', async () => {
    const onSeeAll = vi.fn();
    const { user } = renderWithProviders(<AssignedToMeSection onSeeAll={onSeeAll} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 12 }) },
    });
    await user.click(await screen.findByRole('button', { name: t('refs.seeAll') }));
    expect(onSeeAll).toHaveBeenCalled();
  });

  it('does not offer "see all" when everything is already on screen', async () => {
    renderWithProviders(<AssignedToMeSection onSeeAll={() => {}} />, {
      api: { 'GET /api/media/reviews': page([item(5, 'plan.mp4')], { total: 1 }) },
    });
    expect(await screen.findByText('plan.mp4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('refs.seeAll') })).toBeNull();
  });
});
