// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mutateAsync = vi.fn().mockResolvedValue(undefined);
const usePipelineStatuses = vi.fn();

vi.mock('../../lib/shotgridApi', () => ({
  usePipelineStatuses: (...args: unknown[]) => usePipelineStatuses(...args) as unknown,
  useUpdateSgConnection: () => ({ mutateAsync }),
}));

import SgStatusesPanel from './SgStatusesPanel';
import type { SgConnection } from '../../types/shotgrid';

const statuses = [
  { id: 1, scope: 'shot', code: 'ip', name: 'In Progress', color: '#3498DB' },
  { id: 2, scope: 'shot', code: 'fin', name: 'Final', color: '#2ECC71' },
];

const connection = {
  projectId: 461,
  settings: { visibleStatuses: { task: [], shot: ['ip'], sequence: [], asset: [] } },
} as unknown as SgConnection;

beforeEach(() => {
  vi.clearAllMocks();
  usePipelineStatuses.mockReturnValue({ data: statuses, isLoading: false });
});

/**
 * L'écran qui règle le tri doit voir le catalogue entier : cocher dans une liste déjà
 * amputée d'elle-même ne permettrait plus d'y revenir.
 */
describe('SgStatusesPanel', () => {
  it('demande le catalogue entier, pas la liste déjà réduite', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    expect(usePipelineStatuses).toHaveBeenCalledWith('shot', 461, { all: true });
  });

  it('coche les statuts retenus et laisse les autres décochés', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    expect(screen.getByRole('checkbox', { name: /In Progress/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Final/ })).not.toBeChecked();
  });

  it('ajoute un code au périmètre courant sans toucher aux autres', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Final/ }));
    expect(mutateAsync).toHaveBeenCalledWith({
      settings: { visibleStatuses: { task: [], shot: ['ip', 'fin'], sequence: [], asset: [] } },
    });
  });

  it('retire un code déjà coché', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /In Progress/ }));
    expect(mutateAsync).toHaveBeenCalledWith({
      settings: { visibleStatuses: { task: [], shot: [], sequence: [], asset: [] } },
    });
  });

  it('n’écrit rien quand on ne gère pas le projet', () => {
    render(<SgStatusesPanel connection={connection} canManage={false} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Final/ }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('suit le périmètre choisi dans la liste déroulante', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'asset' } });
    expect(usePipelineStatuses).toHaveBeenLastCalledWith('asset', 461, { all: true });
  });
});
