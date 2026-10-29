// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';
import AssetTaskCards from './AssetTaskCards';
import type { AssetTreeTask, DepartmentGroup } from '../../types/api';

/**
 * The task cards of a shot or an asset.
 *
 * What is at stake here is the question one asks a pipe before all others:
 * who is on it. It had no answer on this page — one had to open each
 * task — and the gesture to answer it (assign) required opening its settings.
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
  it('shows who is on the task, without opening it', async () => {
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

  it('shows nothing about the person when the task has none', () => {
    renderWithProviders(<AssetTaskCards groups={groups([task()])} projectId={1} entityType="Shot" />, {
      api: API,
    });

    // The department name titles the group, the task's title titles the card.
    expect(screen.getAllByText('Animation').length).toBeGreaterThan(0);
    expect(screen.queryByTitle('Alice Martin')).not.toBeInTheDocument();
  });

  it('leaves the card alone when there is no task to assign', () => {
    // The catch-all of versions without a task: nothing to assign, hence no menu.
    renderWithProviders(
      <AssetTaskCards groups={groups([task({ id: null })])} projectId={1} entityType="Shot" />,
      { api: API },
    );

    expect(screen.getByText(t('asset.tree.looseVersions'))).toBeInTheDocument();
  });
});
