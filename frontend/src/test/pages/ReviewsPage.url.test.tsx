// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import ReviewsPage from '../../v2/pages/ReviewsPage';
import { t } from '../../v2/i18n';
import { page, renderWithProviders } from '../renderWithProviders';

/**
 * URL ↔ filter synchronization of the Reviews page.
 *
 * The page completely ignored the query string: its filters lived in a `useState`.
 * No card on the Home page could therefore open a filtered view: the only possible link
 * was "everything". A search state could not be shared, and the browser's back button left the page
 * instead of undoing the last filter.
 */

/** Browser back navigation, in the test's memory router. */
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

describe('ReviewsPage — filters and URL', () => {
  it('reads the filters from the address and sends them to the server', async () => {
    // This is what lets a counter on the Home page open ITS view.
    const { api } = mount('/reviews?assigned=me&decision=none');
    await waitFor(() => expect(api.called('GET /api/media/reviews').length).toBeGreaterThan(0));
    const asked = api.called('GET /api/media/reviews').at(-1)!.url;
    expect(asked.searchParams.get('assigned')).toBe('me');
    expect(asked.searchParams.get('decision')).toBe('none');
  });

  it('shows the filter read from the address, not an empty selector', async () => {
    mount('/reviews?kind=IMAGE');
    await waitFor(() => expect(kindSelect()).toHaveValue('IMAGE'));
  });

  it('writes to the address the filter that is set', async () => {
    const { user, currentPath } = mount('/reviews');
    await waitFor(() => expect(kindSelect()).toBeInTheDocument());
    await user.selectOptions(kindSelect(), 'VIDEO');
    await waitFor(() => expect(currentPath()).toBe('/reviews?kind=VIDEO'));
  });

  it('undoes the last filter on back navigation, instead of leaving the page', async () => {
    const { user, currentPath } = mount('/reviews');
    await waitFor(() => expect(kindSelect()).toBeInTheDocument());
    await user.selectOptions(kindSelect(), 'VIDEO');
    await waitFor(() => expect(currentPath()).toBe('/reviews?kind=VIDEO'));
    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(currentPath()).toBe('/reviews'));
    expect(kindSelect()).toHaveValue('');
  });
});
