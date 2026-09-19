// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import RetakePanel from './RetakePanel';
import type { MockResolver } from '../../../test/apiMock';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';

/**
 * Le panneau des retakes.
 *
 * Trois exigences : il ne doit pas afficher un zéro là où le serveur ne sait pas (un
 * ancien serveur ne rend ni les tours de review ni la distribution), il doit classer le
 * pire plan en tête, et il doit rester lisible sur un projet qui n'a encore aucun retake —
 * c'est même l'état le plus fréquent en début de production.
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
  it('résume les retakes en quatre chiffres', async () => {
    render();
    expect(await screen.findByText(t('production.retakes.avgRetakes'))).toBeTruthy();
    expect(screen.getByText('1.4')).toBeTruthy();
    expect(screen.getByText('2.2')).toBeTruthy();
    expect(screen.getByText('2.5')).toBeTruthy();
    expect(screen.getByText(t('production.retakes.percent', { value: 45 }))).toBeTruthy();
  });

  it('classe le plan le plus repris en tête', async () => {
    render();
    const rows = await screen.findAllByRole('row');
    // Ligne 0 = l'en-tête du tableau ; le pire plan vient juste après.
    expect(within(rows[1]).getByRole('link').textContent).toBe('SH02');
    expect(within(rows[1]).getByText('5')).toBeTruthy();
    expect(within(rows[1]).getByText('6')).toBeTruthy();
  });

  it('trace la distribution par nombre de retakes', async () => {
    render();
    expect(await screen.findByText(t('production.retakes.distribution'))).toBeTruthy();
    expect(screen.getByText(t('production.retakes.bucketRange', { min: 1, max: 2 }))).toBeTruthy();
    expect(screen.getByText(t('production.retakes.bucketFrom', { min: 5 }))).toBeTruthy();
  });

  it('n’invente rien quand le serveur ne rend pas encore les tours de review', async () => {
    const old = {
      totals: { ...STATS.totals, avgReviewRoundsPerShot: undefined, firstTimeRightRate: undefined },
      sequences: [],
      slowestShots: [shot(3, 1)],
    };
    render(old);
    await screen.findByText(t('production.retakes.avgRetakes'));
    // Deux tuiles sans valeur connue : un « — », jamais un zéro qui affirmerait le contraire.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // Le classement retombe sur les plans les plus lents, les seuls que l'ancienne
    // réponse nommait — partiel, mais jamais faux.
    expect(screen.getByRole('link', { name: 'SH03' })).toBeTruthy();
    expect(screen.queryByText(t('production.retakes.distribution'))).toBeNull();
  });

  it('le dit quand aucun retake n’a encore été enregistré', async () => {
    render({ ...STATS, mostRetakenShots: [], slowestShots: [], retakeBuckets: [] });
    expect(await screen.findByText(t('production.retakes.empty'))).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('montre l’erreur du serveur plutôt qu’un tableau vide', async () => {
    render(() => {
      throw new Error('nope');
    });
    expect(await screen.findByText(/nope|500/)).toBeTruthy();
  });
});
