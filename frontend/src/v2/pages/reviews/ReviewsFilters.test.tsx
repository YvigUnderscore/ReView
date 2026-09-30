// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import ReviewsFilters from './ReviewsFilters';
import { filtersFrom } from './reviewsTypes';
import { t } from '../../i18n';

/**
 * Le filtre de publication de la page Reviews, devenu conditionnel (Phase 50).
 *
 * Ce qui se vérifie : « Mes brouillons » ne s'offre plus quand le studio publie d'office —
 * le filtre ne pourrait rapporter que des restes. Le sélecteur revient dès que le réglage
 * `draftMode` est allumé, ET quand une vue enregistrée a posé un filtre : une vue doit
 * pouvoir se défaire, même si le réglage a changé depuis.
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

describe('ReviewsFilters — filtre de publication', () => {
  it('n’offre pas « Mes brouillons » quand le studio publie d’office', async () => {
    mount(false);
    await waitFor(() => expect(screen.getByText(t('reviews.filter.allTypes'))).toBeTruthy());
    expect(screen.queryByText(t('reviews.filter.myDrafts'))).toBeNull();
    expect(screen.queryByText(t('reviews.filter.publishedAndDrafts'))).toBeNull();
  });

  it('l’offre quand le studio garde le parcours en deux temps', async () => {
    mount(true);
    expect(await screen.findByText(t('reviews.filter.myDrafts'))).toBeTruthy();
  });

  it('laisse défaire une vue enregistrée qui filtrait sur les brouillons', async () => {
    mount(false, 'draft');
    expect(await screen.findByText(t('reviews.filter.myDrafts'))).toBeTruthy();
  });
});
