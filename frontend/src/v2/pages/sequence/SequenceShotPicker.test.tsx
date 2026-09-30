// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SequenceShotPicker from './SequenceShotPicker';
import type { MockRequest } from '../../../test/apiMock';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';

/**
 * Rattacher un plan à une séquence suppose de voir **tous** les plans du projet. Tant que
 * les pages s'enchaînent, ce que l'écran affiche est faux par construction : les plans déjà
 * rangés dans la séquence ouverte sont écartés de la liste, si bien qu'une première page
 * qui ne contiendrait qu'eux ferait dire à l'écran « aucun plan à rattacher ».
 */

const shot = (id: number, sequenceId: number | null) => ({
  id,
  code: `SH0${id}`,
  name: `Plan ${id}`,
  sequenceId,
  thumbnailUrl: null,
  status: 'PENDING',
});

/** Page 1 : rien de rattachable (tout est déjà dans la séquence). Page 2 : un plan libre. */
function shotsInTwoPages(second: () => Promise<void> | undefined) {
  return async (req: MockRequest) => {
    const cursor = req.url.searchParams.get('cursor');
    if (!cursor) return { items: [shot(11, 5)], total: 2, page: 1, pageSize: 500, nextCursor: 'c2' };
    await second();
    return { items: [shot(22, null)], total: 2, page: 2, pageSize: 500, nextCursor: null };
  };
}

const picker = () => (
  <SequenceShotPicker projectId={3} sequenceId={5} canManage onDone={() => {}} onCancel={() => {}} />
);

describe('SequenceShotPicker', () => {
  it('attend la liste entière avant de conclure qu’il n’y a rien à rattacher', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = renderWithProviders(picker(), {
      api: { 'GET /api/shots': shotsInTwoPages(() => held) },
    });

    await waitFor(() => expect(api.called('GET /api/shots')).toHaveLength(2));
    // La page 1 ne contient que le plan déjà rangé ici : sans attendre la suite, l'écran
    // annoncerait qu'il n'y a rien à rattacher alors que SH022 est libre.
    expect(screen.queryByText(t('sequenceShots.noneToAttach'))).not.toBeInTheDocument();
    release();
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(api.called('GET /api/shots').map((c) => c.url.searchParams.get('pageSize'))).toEqual([
      '500',
      '500',
    ]);
  });
});
