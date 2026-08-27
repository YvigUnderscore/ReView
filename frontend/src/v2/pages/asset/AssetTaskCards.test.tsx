// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';
import AssetTaskCards from './AssetTaskCards';
import type { AssetTreeTask, DepartmentGroup } from '../../types/api';

/**
 * Les cartes de tâches d'un plan ou d'un asset.
 *
 * Ce qui se joue ici, c'est la question qu'on pose à un pipe avant toutes les autres :
 * qui est dessus. Elle n'avait pas de réponse sur cette page — il fallait ouvrir chaque
 * tâche — et le geste pour y répondre (assigner) demandait d'ouvrir ses réglages.
 */

const task = (over: Partial<AssetTreeTask> = {}): AssetTreeTask => ({
  id: 5,
  name: 'Animation',
  type: 'ANIMATION',
  status: 'TODO',
  pipelineStatusId: null,
  startDate: null,
  dueDate: null,
  department: 'anim',
  assignee: null,
  versions: [],
  ...over,
});

const groups = (items: AssetTreeTask[]): DepartmentGroup<AssetTreeTask>[] => [
  { key: 'anim', name: 'Animation', rank: 0, items },
];

const API = {
  'GET /api/projects/1/departments': {
    departments: [{ id: 3, studioId: 1, projectId: null, key: 'anim', name: 'Animation', order: 0 }],
  },
  'GET /api/projects/1/members': { members: [{ id: 9, name: 'Alice', role: 'ARTIST' }] },
};

describe('AssetTaskCards', () => {
  it('montre qui est sur la tâche, sans avoir à l’ouvrir', async () => {
    renderWithProviders(
      <AssetTaskCards
        groups={groups([
          task({
            assignee: {
              id: 9,
              name: 'Alice Martin',
              firstName: null,
              lastName: null,
              username: null,
              avatarUrl: null,
            },
          }),
        ])}
        projectId={1}
        entityType="Shot"
      />,
      { api: API },
    );

    expect(await screen.findByTitle('Alice Martin')).toBeInTheDocument();
  });

  it('n’affiche rien de la personne quand la tâche n’en a pas', () => {
    renderWithProviders(<AssetTaskCards groups={groups([task()])} projectId={1} entityType="Shot" />, {
      api: API,
    });

    // Le nom du département titre le groupe, celui de la tâche titre la carte.
    expect(screen.getAllByText('Animation').length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Alice Martin')).not.toBeInTheDocument();
  });

  it('laisse la carte seule quand il n’y a pas de tâche à assigner', () => {
    // Le fourre-tout des versions sans tâche : rien à assigner, donc pas de menu.
    renderWithProviders(
      <AssetTaskCards groups={groups([task({ id: null })])} projectId={1} entityType="Shot" />,
      { api: API },
    );

    expect(screen.getByText(t('asset.tree.looseVersions'))).toBeInTheDocument();
  });
});
