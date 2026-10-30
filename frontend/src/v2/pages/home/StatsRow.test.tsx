// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import StatsRow from './StatsRow';
import { t } from '../../i18n';

/**
 * Where the four home counters lead.
 *
 * Two of them pointed to the `#my-tasks` anchor: it vanished with the "my tasks" block as soon as
 * that block was removed from the home page, and the click then did nothing. The other two led to
 * `/reviews` without a filter, where nothing matched the displayed figure. Each card must open
 * ITS view, otherwise nobody can verify its figure, and that is where a counter starts lying
 * without anyone noticing.
 */

const stats = {
  projects: 2,
  mediaInReview: 5,
  comments: 11,
  mediaInReview7d: 1,
  comments7d: 3,
  myRetakes: 4,
  awaitingMyReview: 2,
};

describe('StatsRow', () => {
  it('opens a per-counter filtered view, with no dead anchor left', () => {
    renderWithProviders(<StatsRow stats={stats} />);
    const targets = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(targets).toEqual([
      '/my-tasks?scope=blocked',
      '/reviews?assigned=me&decision=none',
      '/reviews?status=published&decision=none',
      '/comments',
    ]);
    expect(targets.some((href) => href?.startsWith('#'))).toBe(false);
  });

  it('says "what is expected of me" instead of "awaiting review"', () => {
    renderWithProviders(<StatsRow stats={stats} />);
    expect(screen.getByText(t('home.stat.awaitingMyReview'))).toBeInTheDocument();
    // The label of the fourth card is no longer borrowed from the review feed's filter.
    expect(screen.getByText(t('home.stat.comments'))).toBeInTheDocument();
    expect(screen.queryByText(t('comments.filter.all'))).toBeNull();
  });
});
