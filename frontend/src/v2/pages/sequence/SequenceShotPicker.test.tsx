// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SequenceShotPicker from './SequenceShotPicker';
import type { MockRequest } from '../../../test/apiMock';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';

/**
 * Attaching a shot to a sequence requires seeing **all** the shots of the project. As long as
 * the pages are still chaining, what the screen shows is wrong by construction: the shots already
 * in the open sequence are filtered out of the list, so a first page containing only those would
 * make the screen say "no shot to attach".
 */

const shot = (id: number, sequenceId: number | null) => ({
  id,
  code: `SH0${id}`,
  name: `Plan ${id}`,
  sequenceId,
  thumbnailUrl: null,
  status: 'PENDING',
});

/** Page 1: nothing attachable (everything is already in the sequence). Page 2: one free shot. */
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
  it('waits for the whole list before concluding there is nothing to attach', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = renderWithProviders(picker(), {
      api: { 'GET /api/shots': shotsInTwoPages(() => held) },
    });

    await waitFor(() => expect(api.called('GET /api/shots')).toHaveLength(2));
    // Page 1 only contains the shot already filed here: without waiting for the rest, the screen
    // would announce there is nothing to attach while SH022 is free.
    expect(screen.queryByText(t('sequenceShots.noneToAttach'))).not.toBeInTheDocument();
    release();
    expect(await screen.findAllByText('SH022')).not.toHaveLength(0);
    expect(api.called('GET /api/shots').map((c) => c.url.searchParams.get('pageSize'))).toEqual([
      '500',
      '500',
    ]);
  });
});
