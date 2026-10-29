// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { EMPTY_SEARCH, type SearchResults } from '../lib/searchApi';
import CommandPalette from './CommandPalette';

/**
 * Ctrl+K palette: what a supervisor must find in it.
 *
 * The search only covered five kinds of entities: the most typed string in the studio
 * (`SH0120_comp_v012`) and the phrase said in review ("remove the reflection") returned
 * nothing. This test mounts the palette with the ten families served by `GET /api/search` and
 * checks that they display, that they lead somewhere, and that typing does not flood
 * the server.
 */

const RESULTS: SearchResults = {
  ...EMPTY_SEARCH,
  shots: [{ id: 3, code: 'SH0120', name: 'Casque', projectId: 1 }],
  versions: [
    { id: 12, name: 'v012', mediaId: 88, taskId: 4, assetId: null, context: 'SH0120 · comp' },
    { id: 13, name: 'v013', mediaId: null, taskId: null, assetId: null, context: 'SH0120 · comp' },
  ],
  media: [{ id: 88, name: 'SH0120_comp_v012.mov', kind: 'VIDEO', context: 'SH0120 · comp · v012' }],
  playlists: [{ id: 5, name: 'Dailies jeudi', projectName: 'Alpha' }],
  comments: [
    {
      id: 51,
      mediaObjectId: 88,
      excerpt: 'Enlever le reflet sur le casque',
      authorName: 'ana',
      createdAt: '2026-08-21T10:00:00.000Z',
      context: 'SH0120 · SH0120_comp_v012.mov',
    },
  ],
  people: [
    { id: 2, name: 'ana', jobTitle: 'Compositing' },
    { id: 3, name: null, jobTitle: null },
  ],
};

function mount(results: SearchResults = RESULTS) {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(
    <CommandPalette
      open
      onOpenChange={onOpenChange}
      onShortcuts={() => undefined}
      onToggleSidebar={() => undefined}
    />,
    { api: { 'GET /api/search': () => results } },
  );
  return { ...view, onOpenChange };
}

/** The palette's field (cmdk marks it with a stable attribute). */
const input = (): HTMLInputElement => {
  const el = document.querySelector('[cmdk-input]');
  if (!(el instanceof HTMLInputElement)) throw new Error('palette input not found');
  return el;
};

/** Lets the debounce pass without waiting for anything specific. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('CommandPalette — what one really searches for', () => {
  it('finds a media by its file name', async () => {
    const { user } = mount();
    await user.type(input(), 'SH0120');
    expect(await screen.findByText('SH0120_comp_v012.mov')).toBeInTheDocument();
    expect(screen.getByText('SH0120 · comp · v012')).toBeInTheDocument();
  });

  it('finds a version by its number', async () => {
    const { user } = mount();
    await user.type(input(), 'v012');
    expect(await screen.findByText('v012')).toBeInTheDocument();
  });

  it('finds a shot by the text of a review note', async () => {
    const { user } = mount();
    await user.type(input(), 'reflet');
    expect(await screen.findByText('Enlever le reflet sur le casque')).toBeInTheDocument();
    expect(screen.getByText('ana · SH0120 · SH0120_comp_v012.mov')).toBeInTheDocument();
  });

  it('also finds playlists and people', async () => {
    const { user } = mount();
    await user.type(input(), 'ana');
    expect(await screen.findByText('Dailies jeudi')).toBeInTheDocument();
    expect(screen.getByText('Compositing')).toBeInTheDocument();
  });

  it('shows a readable fallback for an account without a name', async () => {
    const { user } = mount();
    await user.type(input(), 'ana');
    await screen.findByText('Compositing');
    // The key is set by `logs/i18n-lots/lot-recherche.json`; what counts here is
    // its presence, not its translation.
    expect(screen.getAllByText(/palette\.person\.unnamed|Account without a name/)).not.toHaveLength(0);
  });
});

describe('CommandPalette — navigation', () => {
  it('opens the review of the chosen media', async () => {
    const { user, currentPath, onOpenChange } = mount();
    await user.type(input(), 'SH0120');
    await user.click(await screen.findByText('SH0120_comp_v012.mov'));
    expect(currentPath()).toBe('/review/88');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens the review at the chosen note', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'reflet');
    await user.click(await screen.findByText('Enlever le reflet sur le casque'));
    expect(currentPath()).toBe('/review/88?comment=51');
  });

  it('sends a version to its most recent media', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'v012');
    await user.click(await screen.findByText('v012'));
    expect(currentPath()).toBe('/review/88');
  });

  it('disables a version none of whose media is visible, rather than leading nowhere', async () => {
    const { user } = mount();
    await user.type(input(), 'v013');
    const item = (await screen.findByText('v013')).closest('[cmdk-item]');
    expect(item).toHaveAttribute('aria-disabled', 'true');
  });

  it('opens a person profile', async () => {
    const { user, currentPath } = mount();
    await user.type(input(), 'ana');
    await user.click(await screen.findByText('Compositing'));
    expect(currentPath()).toBe('/users/2');
  });
});

describe('CommandPalette — typing does not flood the server', () => {
  it('does not query the server on a single character', async () => {
    const { user, api } = mount();
    await user.type(input(), 'S');
    await settle();
    expect(api.called('GET /api/search')).toHaveLength(0);
  });

  it('launches only one request for a string typed in one go', async () => {
    const { user, api } = mount();
    await user.type(input(), 'SH0120');
    await screen.findByText('SH0120_comp_v012.mov');
    await settle();
    const calls = api.called('GET /api/search');
    expect(calls).toHaveLength(1);
    expect(calls[0].url.searchParams.get('q')).toBe('SH0120');
  });

  it('announces the absence of results without erasing the input', async () => {
    const { user } = mount(EMPTY_SEARCH);
    await user.type(input(), 'zzzz');
    await settle();
    expect(input().value).toBe('zzzz');
    expect(screen.getByText(/palette\.empty|No results/)).toBeInTheDocument();
  });
});

/**
 * The palette's keyboard handling.
 *
 * HONESTY ABOUT SCOPE: the original failure (no active item after typing, so
 * a first Enter lost) was only reproduced in the BROWSER. Under jsdom, cmdk
 * reselects by itself, and these assertions already passed before the fix. They therefore hold
 * the invariant ("one and only one active item as soon as results are there"), not the
 * exact scenario; a future change that left the list without a selection would make them fail.
 */
describe('CommandPalette — the keyboard', () => {
  /** The item cmdk considers active, or null if the list designates none. */
  const activeItem = () => document.querySelector('[cmdk-item][aria-selected="true"]');

  it('designates the first result as soon as it arrives', async () => {
    const { user } = mount();
    await user.type(input(), 'SH0120');
    await screen.findByText('SH0120_comp_v012.mov');
    // No element was selected: `shouldFilter={false}` deprives cmdk of the pass that
    // reselects the first item, and the active value remained that of a quick action
    // unmounted in the meantime.
    expect(activeItem()).not.toBeNull();
  });

  it('opens the result on a SINGLE press of Enter', async () => {
    const { user, currentPath, onOpenChange } = mount();
    await user.type(input(), 'SH0120');
    await screen.findByText('SH0120_comp_v012.mov');
    // Without a prior arrow key: that is precisely what did not work.
    await user.keyboard('{Enter}');
    expect(currentPath()).not.toBe('/');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('redesignates the first item when the query changes', async () => {
    const { user } = mount();
    await user.type(input(), 'SH0120');
    await screen.findByText('SH0120_comp_v012.mov');
    const first = activeItem()?.getAttribute('data-value');
    await user.clear(input());
    await user.type(input(), 'ana');
    await screen.findByText('Dailies jeudi');
    expect(activeItem()).not.toBeNull();
    expect(activeItem()?.getAttribute('data-value')).not.toBe(undefined);
    expect(first).toBeTruthy();
  });
});
