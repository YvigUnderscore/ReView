// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import PendingDrafts from './PendingDrafts';
import { t } from '../i18n';

/**
 * La pastille des brouillons en attente, devenue conditionnelle (Phase 50).
 *
 * Ce qui se vérifie : sans le réglage `draftMode`, la pastille ne demande RIEN au serveur.
 * Un média naît publié — la liste serait vide sur toutes les instances, et l'aller-retour
 * serait payé par chaque page de chaque compte. Avec le réglage, tout revient : la requête
 * part et la pastille compte ce qu'elle trouve.
 */

const DRAFT = {
  id: 12,
  originalName: 'chase_v003.mov',
  kind: 'VIDEO',
  status: 'READY',
  versionName: 'v003',
  location: 'ALPHA / sq010 / sh020',
  createdAt: '2026-09-01T10:00:00.000Z',
  versionId: 5,
  projectId: 3,
  reviewRequest: { requireNote: false, minNoteLength: 5 },
};

/** Branding servi par la coquille — c'est lui qui porte le réglage. */
const branding = (draftMode: boolean) => ({
  name: 'Test Studio',
  accent: null,
  logoUrl: null,
  sourceUrl: 'https://example.invalid/source',
  draftMode,
});

describe('PendingDrafts', () => {
  it('ne demande pas la liste des brouillons quand le studio publie d’office', async () => {
    const { api } = renderWithProviders(<PendingDrafts />, {
      api: {
        'GET /api/studio/branding': branding(false),
        'GET /api/media/drafts': { drafts: [DRAFT] },
      },
    });
    // Le branding est bien lu — c'est la preuve que le composant a eu sa chance.
    await waitFor(() => expect(api.called('GET /api/studio/branding').length).toBeGreaterThan(0));
    expect(api.called('GET /api/media/drafts')).toHaveLength(0);
    expect(screen.queryByText(t('drafts.count', { count: 1 }))).toBeNull();
  });

  it('compte les brouillons quand le studio garde le parcours en deux temps', async () => {
    renderWithProviders(<PendingDrafts />, {
      api: {
        'GET /api/studio/branding': branding(true),
        'GET /api/media/drafts': { drafts: [DRAFT] },
      },
    });
    expect(await screen.findByText(t('drafts.count', { count: 1 }))).toBeTruthy();
  });
});
