// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import ReviewsFilters from './ReviewsFilters';
import { filtersFrom } from './reviewsTypes';
import { t } from '../../i18n';

/**
 * The publication filter of the Reviews page, now conditional (Phase 50).
 *
 * What is verified: "My drafts" is no longer offered when the studio publishes automatically — the
 * filter could only ever return leftovers. The selector comes back as soon as the `draftMode`
 * setting is on, AND when a saved view has set a filter: a view must be able to undo it, even if
 * the setting has changed since.
 */

const branding = (draftMode: boolean) => ({
  name: 'Test Studio',
  accent: null,
  logoUrl: null,
  sourceUrl: 'https://example.invalid/source',
  draftMode,
});

const API = { 'GET /api/projects': { items: [], nextCursor: null } };

const mount = (draftMode: boolean, status = '') =>
  renderWithProviders(<ReviewsFilters value={{ ...filtersFrom({}), status }} onChange={() => {}} />, {
    api: { ...API, 'GET /api/studio/branding': branding(draftMode) },
  });

describe('ReviewsFilters — publication filter', () => {
  it('does not offer "My drafts" when the studio publishes automatically', async () => {
    mount(false);
    await waitFor(() => expect(screen.getByText(t('reviews.filter.allTypes'))).toBeTruthy());
    expect(screen.queryByText(t('reviews.filter.myDrafts'))).toBeNull();
    expect(screen.queryByText(t('reviews.filter.publishedAndDrafts'))).toBeNull();
  });

  it('offers it when the studio keeps the two-step workflow', async () => {
    mount(true);
    expect(await screen.findByText(t('reviews.filter.myDrafts'))).toBeTruthy();
  });

  it('lets a saved view that filtered on drafts be undone', async () => {
    mount(false, 'draft');
    expect(await screen.findByText(t('reviews.filter.myDrafts'))).toBeTruthy();
  });
});
