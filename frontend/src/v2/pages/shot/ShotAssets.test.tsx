// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ShotAssets from './ShotAssets';
import type { MockResolver } from '../../../test/apiMock';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';

/**
 * Le bloc « assets du plan » lit deux choses : les assets **rattachés** (une requête sur le
 * plan) et, pour le menu « rattacher un existant », la bibliothèque **entière** du projet.
 * La seconde coûte une page par centaine d'assets — elle n'a donc rien à faire quand le
 * menu n'est pas rendu.
 */

const api: Record<string, MockResolver> = {
  'GET /api/shots/12': { shot: { assets: [{ id: 1, name: 'Dragon', type: 'CHARACTER' }] } },
  'GET /api/assets': {
    items: [
      { id: 1, name: 'Dragon', type: 'CHARACTER' },
      { id: 2, name: 'Château', type: 'ENVIRONMENT' },
    ],
    total: 2,
    page: 1,
    pageSize: 500,
    nextCursor: null,
  },
};

describe('ShotAssets', () => {
  it('ne charge pas la bibliothèque du projet pour un lecteur', async () => {
    const { api: mock } = renderWithProviders(<ShotAssets shotId={12} projectId={3} canManage={false} />, {
      api,
    });

    expect(await screen.findByText('Dragon', { exact: false })).toBeInTheDocument();
    // Le sélecteur n'est pas rendu : pas une seule page d'assets ne doit partir.
    expect(screen.queryByLabelText(t('asset.attach'))).not.toBeInTheDocument();
    expect(mock.called('GET /api/assets')).toHaveLength(0);
  });

  it('charge la bibliothèque entière quand le menu de rattachement est là', async () => {
    const { api: mock } = renderWithProviders(<ShotAssets shotId={12} projectId={3} canManage />, { api });

    const select = await screen.findByLabelText(t('asset.attach'));
    // Le seul asset non rattaché est proposé ; celui déjà lié ne l'est pas.
    await waitFor(() => expect(select).toHaveTextContent('Château'));
    const calls = mock.called('GET /api/assets');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get('pageSize')).toBe('500');
  });
});
