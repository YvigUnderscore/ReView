// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api, projectRole } = vi.hoisted(() => ({
  api: { patch: vi.fn(), del: vi.fn() },
  projectRole: { canManage: true },
}));
vi.mock('../../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../lib/useProjectRole', () => ({ useProjectRole: () => projectRole }));
vi.mock('../../stores/useAuth', () => ({
  useAuth: (pick: (s: unknown) => unknown) => pick({ user: { id: 4 } }),
}));
// Status and assignment have their own tests: here only the new entries matter, and the stability
// of `menuFor`, on which the memoization of the board's thousand cards depends.
vi.mock('../../lib/useStatusMenu', () => ({
  useStatusMenu: () => ({ entry: () => null, choices: [] }),
}));
vi.mock('../../lib/useTaskAssignMenu', () => ({
  useTaskAssignMenu: () => ({ assignEntry: () => null, departmentEntry: () => null, epoch: 'members' }),
}));

import { useKanbanCardMenu } from './useKanbanCardMenu';
import type { BoardTask } from './kanbanTypes';
import { t } from '../../i18n';

const TASK: BoardTask = {
  id: 50,
  name: 'comp',
  type: 'COMPOSITING',
  status: 'TODO',
  pipelineStatusId: 42,
  department: 'comp',
  departmentId: 6,
  assignee: null,
  dueDate: null,
  versionCount: 0,
  parentKind: 'shot',
  parentId: 7,
  parentLabel: 'SH010',
  sequenceId: null,
};

const seen: ((task: BoardTask) => unknown)[] = [];

/**
 * Stable optimistic write, as the one `useKanbanBoard` memoizes: the board passes it through as
 * is, and this is a condition of the stability of `menuFor`.
 */
const applyOptimisticStatus = () => () => undefined;

/** A minimal screen: it renders the card menu, and a keystroke that makes it re-render. */
function Harness() {
  const [typed, setTyped] = useState('');
  const { menuFor, dialogs } = useKanbanCardMenu(3, applyOptimisticStatus);
  seen.push(menuFor);
  const entries = menuFor(TASK);
  return (
    <>
      <input aria-label="search" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {entries.map((entry) =>
        'onSelect' in entry ? (
          <button key={entry.id} onClick={entry.onSelect}>
            {entry.label}
          </button>
        ) : null,
      )}
      {dialogs}
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seen.length = 0;
  projectRole.canManage = true;
  api.patch.mockResolvedValue({ task: { id: 50 } });
  api.del.mockResolvedValue(undefined);
});

afterEach(cleanup);

/**
 * Renaming and deleting a task existed nowhere in the interface (Phase 50). Deletion is only
 * exposed together with its server guard, since `Version.taskId` cascades.
 */
describe('useKanbanCardMenu', () => {
  it('offers renaming and deletion to production, and nothing to the others', () => {
    render(<Harness />);
    expect(screen.getByText(t('task.rename'))).toBeTruthy();
    expect(screen.getByText(t('task.delete'))).toBeTruthy();
    cleanup();
    projectRole.canManage = false;
    render(<Harness />);
    expect(screen.queryByText(t('task.rename'))).toBeNull();
    expect(screen.queryByText(t('task.delete'))).toBeNull();
  });

  /**
   * The fragile point: `menuFor` is the memoization dependency of the cards. If it becomes new on
   * each render, a keystroke in the search replays the board's thousand cards.
   */
  it('keeps the same identity when the screen renders again', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'sh0' } });
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'sh01' } });
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(1);
  });

  it('renames the task from its dialog', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('task.rename')));
    fireEvent.change(screen.getByLabelText(t('task.nameLabel')), { target: { value: ' comp v2 ' } });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/tasks/50', { name: 'comp v2' }));
  });

  /** Deletion goes through a confirmation: it is a gesture with no way back. */
  it('deletes only after confirmation', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('task.delete')));
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(t('common.delete')));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/api/tasks/50'));
  });
});
