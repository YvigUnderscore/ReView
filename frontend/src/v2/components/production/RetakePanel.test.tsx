// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import RetakePanel from './RetakePanel';
import type { MockResolver } from '@/test/apiMock';
import { renderWithProviders } from '@/test/renderWithProviders';
import { t } from '../../i18n';

/**
 * The retakes panel.
 *
 * Three requirements: it must not display a zero where the server does not know (an old server returns neither the review
 * rounds nor the distribution), it must rank the worst shot first, and it must remain readable on a project that has no
 * retake yet: that is in fact the most frequent state at the start of production.
 */

const shot = (id: number, retakes: number, over: Record<string, unknown> = {}) => ({
  shotId: id,
  code: `SH0${id}`,
  name: `Shot ${id}`,
  sequenceId: 1,
  versions: 4,
  retakes,
  openNotes: 2,
  reviewDays: 3.5,
  status: 'inReview',
  ...over,
});

const STATS = {
  totals: {
    shots: 12,
    versions: 40,
    decisions: 20,
    approvalRate: 60,
    openNotes: 7,
    avgReviewDays: 2.5,
    avgRetakesPerShot: 1.4,
    avgNotesPerVersion: 0.8,
    avgReviewRoundsPerShot: 2.2,
    firstTimeRightRate: 45,
  },
  sequences: [],
  slowestShots: [],
  mostRetakenShots: [shot(1, 2), shot(2, 5, { reviewRounds: 6, openNotes: 1 })],
  retakeBuckets: [
    { min: 0, max: 0, shots: 4 },
    { min: 1, max: 2, shots: 5 },
    { min: 5, max: null, shots: 1 },
  ],
};

const render = (stats: MockResolver = STATS) =>
  renderWithProviders(<RetakePanel projectId={7} />, { api: { 'GET /api/projects/7/stats': stats } });

describe('RetakePanel', () => {
  it('summarises the retakes in four figures', async () => {
    render();
    expect(await screen.findByText(t('production.retakes.avgRetakes'))).toBeTruthy();
    expect(screen.getByText('1.4')).toBeTruthy();
    expect(screen.getByText('2.2')).toBeTruthy();
    expect(screen.getByText('2.5')).toBeTruthy();
    expect(screen.getByText(t('production.retakes.percent', { value: 45 }))).toBeTruthy();
  });

  it('ranks the most retaken shot first', async () => {
    render();
    const rows = await screen.findAllByRole('row');
    // Row 0 = the table header; the worst shot comes right after.
    expect(within(rows[1]).getByRole('link').textContent).toBe('SH02');
    expect(within(rows[1]).getByText('5')).toBeTruthy();
    expect(within(rows[1]).getByText('6')).toBeTruthy();
  });

  it('plots the distribution by number of retakes', async () => {
    render();
    expect(await screen.findByText(t('production.retakes.distribution'))).toBeTruthy();
    expect(screen.getByText(t('production.retakes.bucketRange', { min: 1, max: 2 }))).toBeTruthy();
    expect(screen.getByText(t('production.retakes.bucketFrom', { min: 5 }))).toBeTruthy();
  });

  it('invents nothing when the server does not yet return the review rounds', async () => {
    const old = {
      totals: { ...STATS.totals, avgReviewRoundsPerShot: undefined, firstTimeRightRate: undefined },
      sequences: [],
      slowestShots: [shot(3, 1)],
    };
    render(old);
    await screen.findByText(t('production.retakes.avgRetakes'));
    // Two tiles with no known value: a "—", never a zero that would assert the opposite.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // Ranking falls back to the slowest shots, the only ones the old response named: partial, but never wrong.
    expect(screen.getByRole('link', { name: 'SH03' })).toBeTruthy();
    expect(screen.queryByText(t('production.retakes.distribution'))).toBeNull();
  });

  it('says so when no retake has been recorded yet', async () => {
    render({ ...STATS, mostRetakenShots: [], slowestShots: [], retakeBuckets: [] });
    expect(await screen.findByText(t('production.retakes.empty'))).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the server error rather than an empty table', async () => {
    render(() => {
      throw new Error('nope');
    });
    expect(await screen.findByText(/nope|500/)).toBeTruthy();
  });
});
