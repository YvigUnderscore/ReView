// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import StatsRow from './StatsRow';
import { t } from '../../i18n';

/**
 * Où mènent les quatre compteurs de l'Accueil.
 *
 * Deux d'entre eux pointaient l'ancre `#my-tasks` : elle disparaissait avec le bloc
 * « mes tâches » dès qu'on le retirait de son accueil, et le clic ne faisait alors plus
 * rien. Les deux autres menaient à `/reviews` sans filtre, où rien ne correspondait au
 * chiffre affiché. Chaque carte doit ouvrir SA vue — sinon personne ne peut vérifier son
 * chiffre, et c'est là qu'un compteur se met à mentir sans qu'on le sache.
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
  it('ouvre une vue filtrée par compteur, et plus aucune ancre morte', () => {
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

  it('dit « ce qu’on attend de moi » à la place de « awaiting review »', () => {
    renderWithProviders(<StatsRow stats={stats} />);
    expect(screen.getByText(t('home.stat.awaitingMyReview'))).toBeInTheDocument();
    // Le libellé de la quatrième carte n'est plus emprunté au filtre du fil de review.
    expect(screen.getByText(t('home.stat.comments'))).toBeInTheDocument();
    expect(screen.queryByText(t('comments.filter.all'))).toBeNull();
  });
});
