// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AssetAssignDialog from './AssetAssignDialog';
import type { MockRequest, MockResolver } from '../../test/apiMock';
import { renderWithProviders } from '../../test/renderWithProviders';

/**
 * The assignment dialog is a selector: it must offer **all** the shots of the
 * project, and only offer them once they have all arrived. Two opposing requirements:
 * the full list costs round trips in series, and the `all` mode of
 * `useInfiniteList` reconciles this by requesting pages as large as the server serves.
 */

const shot = (id: number) => ({
  id,
  code: `SH0${id}`,
  name: `Plan ${id}`,
  sequenceId: 1,
  thumbnailUrl: null,
  status: 'PENDING',
});

/** Cursor server: two pages, whatever the number of rows requested. */
function shotsInTwoPages(second: () => Promise<void> | undefined) {
  return async (req: MockRequest) => {
    const cursor = req.url.searchParams.get('cursor');
    if (!cursor) return { items: [shot(11)], total: 2, page: 1, pageSize: 500, nextCursor: 'c2' };
    await second();
    return { items: [shot(22)], total: 2, page: 2, pageSize: 500, nextCursor: null };
  };
}

const baseApi = (shots: MockResolver): Record<string, MockResolver> => ({
  'GET /api/shots': shots,
  'GET /api/sequences': {
    sequences: [{ id: 1, code: 'SQ010', name: 'Ouverture', shotCount: 2 }],
    unsequencedShots: 0,
  },
  'GET /api/assets/7': { asset: { shots: [], sequences: [] } },
});

const dialog = () => <AssetAssignDialog assetId={7} projectId={3} assetName="Dragon" onClose={() => {}} />;

describe('AssetAssignDialog', () => {
  it('proposes the shots of the following pages, requesting the largest page served', async () => {
    const { api } = renderWithProviders(dialog(), { api: baseApi(shotsInTwoPages(() => undefined)) });

    // The shot of the second page is the real issue: without chaining, it would be
    // impossible to attach the asset to it.
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(screen.getAllByText('SH011')).not.toHaveLength(0);
    const shots = api.called('GET /api/shots');
    expect(shots).toHaveLength(2);
    // A page of 500 rather than the 100 served by default: twenty round trips in
    // series for two thousand shots become four.
    expect(shots.map((c) => c.url.searchParams.get('pageSize'))).toEqual(['500', '500']);
  });

  it('keeps the skeleton until the list is complete', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = renderWithProviders(dialog(), { api: baseApi(shotsInTwoPages(() => held)) });

    await waitFor(() => expect(api.called('GET /api/shots')).toHaveLength(2));
    // The first page has arrived, the second is pending: showing SH011 alone would suggest
    // that the project has only one attachable shot.
    expect(screen.queryAllByText('SH011')).toHaveLength(0);
    release();
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(screen.getAllByText('SH011')).not.toHaveLength(0);
  });
});
