// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { resolveQueryPhase, type QueryPhase, type QuerySnapshot } from './query-state.helpers';

/** Shortcut: an idle state, with no data or error — the initial load. */
const snap = (over: Partial<QuerySnapshot> = {}): QuerySnapshot => ({
  isError: false,
  hasData: false,
  ...over,
});

describe('resolveQueryPhase — deciding query states (admin)', () => {
  it('shows the skeleton as long as nothing answers', () => {
    expect(resolveQueryPhase(snap())).toBe('pending');
  });

  it('shows the content as soon as data is at hand', () => {
    expect(resolveQueryPhase(snap({ hasData: true }))).toBe('ready');
  });

  it('shows the failure when the server refused and there is nothing to display', () => {
    // The corrected default: this case rendered a skeleton that pulsed forever.
    expect(resolveQueryPhase(snap({ isError: true }))).toBe('error');
  });

  it('keeps the content already displayed when a refresh fails', () => {
    // Paginated lists case (keepPreviousData): clearing the screen would be a regression.
    expect(resolveQueryPhase(snap({ isError: true, hasData: true }))).toBe('ready');
  });

  it('never returns anything other than the three known phases', () => {
    const phases: QueryPhase[] = ['pending', 'error', 'ready'];
    for (const isError of [false, true])
      for (const hasData of [false, true]) expect(phases).toContain(resolveQueryPhase({ isError, hasData }));
  });
});
