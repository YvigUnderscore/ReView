// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import KanbanPage from '../../v2/pages/KanbanPage';
import type { BoardTask } from '../../v2/pages/kanban/kanbanTypes';
import type { PipelineStatus } from '../../v2/types/shotgrid';
import { t } from '../../v2/i18n';
import { deferred, type MockRequest, type MockResolver } from '../apiMock';
import { clickMenuRadio, openContextMenu, openSubmenu } from '../menu';
import { renderWithProviders } from '../renderWithProviders';

/**
 * Le kanban est l'écran où le vocabulaire du studio doit gagner sur celui de ReView : un
 * site ShotGrid déclare quinze statuts, l'énumération interne n'en connaît que six, et
 * confondre les deux range « On Hold » sous « Waiting to Start ». Les tests visent donc
 * ce que produit le référentiel : les colonnes qu'il dicte, la colonne où atterrit une
 * carte, et ce qui part au serveur quand on change un statut au clic droit.
 */

const PROJECT_ID = 7;

const status = (id: number, name: string, legacy: PipelineStatus['legacyStatus']): PipelineStatus => ({
  id,
  scope: 'task',
  code: name.toLowerCase().replace(/\s+/g, '_'),
  name,
  color: '#3366ff',
  order: id,
  isDone: legacy === 'APPROVED',
  isDefault: false,
  legacyStatus: legacy,
});

const STATUSES: PipelineStatus[] = [
  status(1, 'Waiting to Start', 'TODO'),
  status(2, 'On Hold', 'TODO'),
  status(3, 'Kickoff', 'IN_PROGRESS'),
  status(4, 'Final', 'APPROVED'),
];

const task = (patch: Partial<BoardTask> & Pick<BoardTask, 'id' | 'name'>): BoardTask => ({
  type: 'COMPOSITING',
  status: 'TODO',
  pipelineStatusId: null,
  department: 'comp',
  departmentId: 1,
  assignee: null,
  dueDate: null,
  versionCount: 0,
  parentKind: 'shot',
  parentId: 100,
  parentLabel: 'SH010',
  sequenceId: null,
  ...patch,
});

const boardApi = (
  items: BoardTask[],
  extra: { total?: number; truncated?: boolean } = {},
): Record<string, MockResolver> => ({
  [`GET /api/tasks/board?projectId=${PROJECT_ID}`]: {
    items,
    total: extra.total ?? items.length,
    truncated: extra.truncated ?? false,
  },
  [`GET /api/pipeline-statuses?scope=task&projectId=${PROJECT_ID}`]: { statuses: STATUSES },
  [`GET /api/sequences?projectId=${PROJECT_ID}`]: { sequences: [], unsequencedShots: 0 },
  [`GET /api/projects/${PROJECT_ID}/departments`]: { departments: [] },
  [`GET /api/context/project/${PROJECT_ID}`]: { context: { project: { id: PROJECT_ID, name: 'Alpha' } } },
});

const mount = (api: Record<string, MockResolver>) =>
  renderWithProviders(<KanbanPage />, {
    route: `/projects/${PROJECT_ID}/kanban`,
    path: '/projects/:id/kanban',
    api,
  });

/** La colonne portant ce titre, repérée par son en-tête plutôt que par sa position. */
const column = (label: string): HTMLElement => {
  const head = screen.getByTitle(label);
  const box = head.closest('div.flex.w-64');
  if (!box) throw new Error(`Column not found: ${label}`);
  return box as HTMLElement;
};

describe('KanbanPage', () => {
  it('bâtit ses colonnes sur le référentiel du projet, pas sur l’énumération interne', async () => {
    mount(boardApi([task({ id: 1, name: 'Comp' })]));

    expect(await screen.findByTitle('Waiting to Start')).toBeInTheDocument();
    expect(screen.getByTitle('On Hold')).toBeInTheDocument();
    expect(screen.getByTitle('Kickoff')).toBeInTheDocument();
    expect(screen.getByTitle('Final')).toBeInTheDocument();
    // Les familles regroupent les colonnes : « à faire » en porte deux ici.
    expect(
      screen.getByRole('button', { name: new RegExp(t('kanban.family.todo'), 'i') }),
    ).toBeInTheDocument();
  });

  it('range chaque carte dans la colonne de son statut de référentiel', async () => {
    mount(
      boardApi([
        task({ id: 1, name: 'Layout', pipelineStatusId: 2, status: 'TODO' }),
        task({ id: 2, name: 'Anim', pipelineStatusId: 3, status: 'IN_PROGRESS' }),
      ]),
    );

    await screen.findByTitle('On Hold');
    expect(within(column('On Hold')).getByRole('link', { name: 'Layout' })).toBeInTheDocument();
    expect(within(column('Kickoff')).getByRole('link', { name: 'Anim' })).toBeInTheDocument();
    // « Layout » ne doit pas apparaître aussi dans la colonne de même famille.
    expect(within(column('Waiting to Start')).queryByRole('link', { name: 'Layout' })).toBeNull();
  });

  it('replie une colonne d’une carte sans statut sur la famille de son énumération', async () => {
    mount(boardApi([task({ id: 5, name: 'Orphan', pipelineStatusId: null, status: 'APPROVED' })]));

    await screen.findByTitle('Final');
    expect(within(column('Final')).getByRole('link', { name: 'Orphan' })).toBeInTheDocument();
  });

  it('dit que le board est tronqué au lieu de le laisser passer pour complet', async () => {
    mount(boardApi([task({ id: 1, name: 'Comp' })], { total: 1200, truncated: true }));

    expect(await screen.findByText(t('kanban.truncated', { shown: 1, total: 1200 }))).toBeInTheDocument();
  });

  it('affiche un état vide plutôt qu’un board de colonnes creuses', async () => {
    mount(boardApi([]));

    expect(await screen.findByText(t('task.noTaskYet'))).toBeInTheDocument();
    expect(screen.queryByTitle('On Hold')).not.toBeInTheDocument();
  });

  it('change le statut au clic droit : la carte bouge avant la réponse, le serveur reçoit l’identifiant', async () => {
    // Un serveur qui garde vraiment ce qu'on lui écrit : sans cela, la relecture qui suit
    // le PATCH ramènerait l'ancien statut et le test ne verrait que le va-et-vient.
    const board = [task({ id: 42, name: 'Comp', pipelineStatusId: 1, status: 'TODO' })];
    const answered = deferred<{ task: { id: number } }>();
    const { api } = mount({
      ...boardApi(board),
      [`GET /api/tasks/board?projectId=${PROJECT_ID}`]: () => ({
        items: board,
        total: board.length,
        truncated: false,
      }),
      'PATCH /api/tasks/:id': ({ body }: MockRequest) => {
        const { pipelineStatusId } = body as { pipelineStatusId: number };
        board[0] = { ...board[0], pipelineStatusId, status: 'IN_PROGRESS' };
        return answered.promise;
      },
    });

    openContextMenu(await screen.findByRole('link', { name: 'Comp' }));
    await openSubmenu(t('pipeline.status.menu'));
    await clickMenuRadio(/Kickoff/);

    // Optimiste : la carte a changé de colonne alors que la requête est encore en vol.
    await waitFor(() => expect(within(column('Kickoff')).getByRole('link', { name: 'Comp' })).toBeVisible());
    const [patch] = api.called('PATCH /api/tasks/:id');
    expect(patch.path).toBe('/api/tasks/42');
    expect(patch.body).toEqual({ pipelineStatusId: 3 });

    // Et elle y reste une fois le serveur relu (le board est invalidé après la réponse).
    answered.resolve({ task: { id: 42 } });
    await waitFor(() => expect(api.called(`GET /api/tasks/board`).length).toBeGreaterThan(1));
    expect(within(column('Kickoff')).getByRole('link', { name: 'Comp' })).toBeVisible();
  });
});
