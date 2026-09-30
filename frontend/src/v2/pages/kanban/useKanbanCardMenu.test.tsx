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
// Statut et assignation ont leurs propres tests : ici, seules comptent les entrées neuves
// et la stabilité de `menuFor`, dont dépend la mémoïsation des mille cartes du board.
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
 * Écriture optimiste stable, comme celle que `useKanbanBoard` mémoïse : le board la passe
 * telle quelle, et c'est une condition de la stabilité de `menuFor`.
 */
const applyOptimisticStatus = () => () => undefined;

/** Un écran minimal : il rend le menu de la carte, et une frappe qui le fait se re-rendre. */
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
 * Renommer et supprimer une tâche n'existait nulle part dans l'interface (Phase 50) — et la
 * suppression ne s'expose qu'avec sa garde serveur, `Version.taskId` étant en cascade.
 */
describe('useKanbanCardMenu', () => {
  it('offre le renommage et la suppression à la production, et rien aux autres', () => {
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
   * Le point fragile : `menuFor` est la dépendance de mémoïsation des cartes. S'il devient
   * neuf à chaque rendu, une frappe dans la recherche rejoue les mille cartes du board.
   */
  it('garde la même identité quand l’écran se rend à nouveau', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'sh0' } });
    fireEvent.change(screen.getByLabelText('search'), { target: { value: 'sh01' } });
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen).size).toBe(1);
  });

  it('renomme la tâche depuis son dialogue', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('task.rename')));
    fireEvent.change(screen.getByLabelText(t('task.nameLabel')), { target: { value: ' comp v2 ' } });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/tasks/50', { name: 'comp v2' }));
  });

  /** La suppression passe par une confirmation : c'est un geste sans retour. */
  it('ne supprime qu’après confirmation', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText(t('task.delete')));
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(t('common.delete')));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/api/tasks/50'));
  });
});
