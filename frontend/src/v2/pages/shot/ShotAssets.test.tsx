// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ShotAssets from './ShotAssets';
import type { MockResolver } from '../../../test/apiMock';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';

/**
 * The "shot assets" block reads two things: the **attached** assets (one request on the shot)
 * and, for the "attach an existing one" menu, the project's **whole** library. The second costs
 * one page per hundred assets — it therefore has nothing to do when the menu is not rendered.
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
  it('does not load the project library for a reader', async () => {
    const { api: mock } = renderWithProviders(<ShotAssets shotId={12} projectId={3} canManage={false} />, {
      api,
    });

    expect(await screen.findByText('Dragon', { exact: false })).toBeInTheDocument();
    // The selector is not rendered: not a single asset page must be requested.
    expect(screen.queryByLabelText(t('asset.attach'))).not.toBeInTheDocument();
    expect(mock.called('GET /api/assets')).toHaveLength(0);
  });

  it('loads the whole library when the attach menu is present', async () => {
    const { api: mock } = renderWithProviders(<ShotAssets shotId={12} projectId={3} canManage />, { api });

    const select = await screen.findByLabelText(t('asset.attach'));
    // The only unattached asset is offered; the one already linked is not.
    await waitFor(() => expect(select).toHaveTextContent('Château'));
    const calls = mock.called('GET /api/assets');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get('pageSize')).toBe('500');
  });
});
