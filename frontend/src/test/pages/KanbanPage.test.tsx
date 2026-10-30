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
 * The kanban is the screen where the studio's vocabulary must win over ReView's: a
 * ShotGrid site declares fifteen statuses, the internal enumeration knows only six, and
 * confusing the two files "On Hold" under "Waiting to Start". The tests therefore target
 * what the reference data produces: the columns it dictates, the column where a
 * card lands, and what goes to the server when a status is changed by right click.
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

/** The column bearing this title, identified by its header rather than by its position. */
const column = (label: string): HTMLElement => {
  const head = screen.getByTitle(label);
  const box = head.closest('div.flex.w-64');
  if (!box) throw new Error(`Column not found: ${label}`);
  return box as HTMLElement;
};

describe('KanbanPage', () => {
  it('builds its columns from the project reference data, not the internal enumeration', async () => {
    mount(boardApi([task({ id: 1, name: 'Comp' })]));

    expect(await screen.findByTitle('Waiting to Start')).toBeInTheDocument();
    expect(screen.getByTitle('On Hold')).toBeInTheDocument();
    expect(screen.getByTitle('Kickoff')).toBeInTheDocument();
    expect(screen.getByTitle('Final')).toBeInTheDocument();
    // Families group the columns: "To Do" holds two of them here.
    expect(
      screen.getByRole('button', { name: new RegExp(t('kanban.family.todo'), 'i') }),
    ).toBeInTheDocument();
  });

  it('places each card in the column of its reference status', async () => {
    mount(
      boardApi([
        task({ id: 1, name: 'Layout', pipelineStatusId: 2, status: 'TODO' }),
        task({ id: 2, name: 'Anim', pipelineStatusId: 3, status: 'IN_PROGRESS' }),
      ]),
    );

    await screen.findByTitle('On Hold');
    expect(within(column('On Hold')).getByRole('link', { name: 'Layout' })).toBeInTheDocument();
    expect(within(column('Kickoff')).getByRole('link', { name: 'Anim' })).toBeInTheDocument();
    // "Layout" must not also appear in the column of the same family.
    expect(within(column('Waiting to Start')).queryByRole('link', { name: 'Layout' })).toBeNull();
  });

  it('folds a column of a card without a status onto its enumeration family', async () => {
    mount(boardApi([task({ id: 5, name: 'Orphan', pipelineStatusId: null, status: 'APPROVED' })]));

    await screen.findByTitle('Final');
    expect(within(column('Final')).getByRole('link', { name: 'Orphan' })).toBeInTheDocument();
  });

  it('says the board is truncated rather than letting it pass for complete', async () => {
    mount(boardApi([task({ id: 1, name: 'Comp' })], { total: 1200, truncated: true }));

    expect(await screen.findByText(t('kanban.truncated', { shown: 1, total: 1200 }))).toBeInTheDocument();
  });

  it('shows an empty state rather than a board of hollow columns', async () => {
    mount(boardApi([]));

    expect(await screen.findByText(t('task.noTaskYet'))).toBeInTheDocument();
    expect(screen.queryByTitle('On Hold')).not.toBeInTheDocument();
  });

  it('changes the status on right click: the card moves before the response, the server receives the identifier', async () => {
    // A server that really keeps what it is written: without this, the re-read that follows
    // the PATCH would bring back the old status and the test would only see a back-and-forth.
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

    // Optimistic: the card has changed column while the request is still in flight.
    await waitFor(() => expect(within(column('Kickoff')).getByRole('link', { name: 'Comp' })).toBeVisible());
    const [patch] = api.called('PATCH /api/tasks/:id');
    expect(patch.path).toBe('/api/tasks/42');
    expect(patch.body).toEqual({ pipelineStatusId: 3 });

    // And it stays there once the server is re-read (the board is invalidated after the response).
    answered.resolve({ task: { id: 42 } });
    await waitFor(() => expect(api.called(`GET /api/tasks/board`).length).toBeGreaterThan(1));
    expect(within(column('Kickoff')).getByRole('link', { name: 'Comp' })).toBeVisible();
  });
});
