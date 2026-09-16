// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AssetAssignDialog from './AssetAssignDialog';
import type { MockRequest, MockResolver } from '../../test/apiMock';
import { renderWithProviders } from '../../test/renderWithProviders';

/**
 * Le dialogue d'assignation est un sélecteur : il doit proposer **tous** les plans du
 * projet, et il ne doit les proposer qu'une fois tous arrivés. Deux exigences opposées —
 * la liste complète coûte des allers-retours en série — que le mode `all` de
 * `useInfiniteList` concilie en demandant des pages aussi grandes que le serveur en sert.
 */

const shot = (id: number) => ({
  id,
  code: `SH0${id}`,
  name: `Plan ${id}`,
  sequenceId: 1,
  thumbnailUrl: null,
  status: 'PENDING',
});

/** Serveur à curseur : deux pages, quel que soit le nombre de lignes demandé. */
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
  it('propose les plans des pages suivantes, en demandant la plus grande page servie', async () => {
    const { api } = renderWithProviders(dialog(), { api: baseApi(shotsInTwoPages(() => undefined)) });

    // Le plan de la seconde page est le vrai enjeu : sans enchaînement, il serait
    // impossible de lui rattacher l'asset.
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(screen.getAllByText('SH011')).not.toHaveLength(0);
    const shots = api.called('GET /api/shots');
    expect(shots).toHaveLength(2);
    // Une page de 500 plutôt que les 100 servis par défaut : vingt allers-retours en
    // série pour deux mille plans deviennent quatre.
    expect(shots.map((c) => c.url.searchParams.get('pageSize'))).toEqual(['500', '500']);
  });

  it('garde le squelette tant que la liste n’est pas entière', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = renderWithProviders(dialog(), { api: baseApi(shotsInTwoPages(() => held)) });

    await waitFor(() => expect(api.called('GET /api/shots')).toHaveLength(2));
    // La première page est arrivée, la seconde pend : afficher SH011 seul ferait croire
    // que le projet n'a qu'un plan rattachable.
    expect(screen.queryAllByText('SH011')).toHaveLength(0);
    release();
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(screen.getAllByText('SH011')).not.toHaveLength(0);
  });
});
