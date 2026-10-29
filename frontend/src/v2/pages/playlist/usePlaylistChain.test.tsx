// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders';
import type { PlaylistItemEntry } from '../../types/api';
import { usePlaylistChain } from './usePlaylistChain';

const item = (id: number, mediaId: number | null): PlaylistItemEntry => ({
  id,
  order: id,
  version: { id: id * 10, name: `v00${id}`, location: `SQ · SH${id}`, mediaCount: 1, reviewStatus: null },
  media:
    mediaId === null ? null : { id: mediaId, kind: 'VIDEO', originalName: `sh${id}.mov`, thumbnailUrl: null },
});

const playlist = {
  playlist: {
    id: 5,
    name: 'Dailies',
    projectId: 1,
    createdBy: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    items: [item(1, 101), item(2, null), item(3, 103)],
  },
};

/** Minimal player: the hook only needs a video element and a media id. */
function Probe({ mediaId }: { mediaId: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const chain = usePlaylistChain(mediaId, videoRef);
  return (
    <div>
      <video ref={videoRef} data-testid="player" />
      <span data-testid="next">{chain.next?.media?.id ?? 'none'}</span>
      <span data-testid="state">{`${chain.active}/${chain.enabled}`}</span>
      <button onClick={chain.toggle}>toggle</button>
    </div>
  );
}

const setup = (route: string) =>
  renderWithProviders(<Probe mediaId={101} />, {
    route,
    path: '/review/:mediaId',
    api: { 'GET /api/playlists/5': playlist },
  });

describe('usePlaylistChain', () => {
  it('the end of a shot opens the next playable one, playlist context kept', async () => {
    const { currentPath } = setup('/review/101?playlist=5');
    await waitFor(() => expect(screen.getByTestId('next')).toHaveTextContent('103'));
    fireEvent.ended(screen.getByTestId('player'));
    await waitFor(() => expect(currentPath()).toBe('/review/sh3-103?playlist=5'));
  });

  it('outside a playlist, nothing chains', async () => {
    const { currentPath } = setup('/review/101');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('false/true'));
    fireEvent.ended(screen.getByTestId('player'));
    await waitFor(() => expect(currentPath()).toBe('/review/101'));
  });

  it('toggle disarmed: playback stops at the end of the shot', async () => {
    const { currentPath, user } = setup('/review/101?playlist=5');
    await waitFor(() => expect(screen.getByTestId('next')).toHaveTextContent('103'));
    await user.click(screen.getByRole('button'));
    expect(screen.getByTestId('state')).toHaveTextContent('true/false');
    fireEvent.ended(screen.getByTestId('player'));
    await waitFor(() => expect(currentPath()).toBe('/review/101?playlist=5'));
  });

  it('an automatic edit leads: the playlist does not navigate twice', async () => {
    const { currentPath } = setup('/review/101?playlist=5&timeline=3');
    await waitFor(() => expect(screen.getByTestId('next')).toHaveTextContent('103'));
    fireEvent.ended(screen.getByTestId('player'));
    await waitFor(() => expect(currentPath()).toBe('/review/101?playlist=5&timeline=3'));
  });
});
