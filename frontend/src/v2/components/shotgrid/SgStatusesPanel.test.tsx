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
 * The screen that sets the sort order must see the whole catalogue: ticking items in a
 * list already trimmed by itself would make it impossible to get back.
 */
describe('SgStatusesPanel', () => {
  it('requests the whole catalogue, not the list already reduced', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    expect(usePipelineStatuses).toHaveBeenCalledWith('shot', 461, { all: true });
  });

  it('ticks the retained statuses and leaves the others unticked', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    expect(screen.getByRole('checkbox', { name: /In Progress/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Final/ })).not.toBeChecked();
  });

  it('adds a code to the current scope without touching the others', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Final/ }));
    expect(mutateAsync).toHaveBeenCalledWith({
      settings: { visibleStatuses: { task: [], shot: ['ip', 'fin'], sequence: [], asset: [] } },
    });
  });

  it('removes an already ticked code', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.click(screen.getByRole('checkbox', { name: /In Progress/ }));
    expect(mutateAsync).toHaveBeenCalledWith({
      settings: { visibleStatuses: { task: [], shot: [], sequence: [], asset: [] } },
    });
  });

  it('writes nothing when the user does not manage the project', () => {
    render(<SgStatusesPanel connection={connection} canManage={false} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Final/ }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('follows the scope chosen in the dropdown', () => {
    render(<SgStatusesPanel connection={connection} canManage />);
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'asset' } });
    expect(usePipelineStatuses).toHaveBeenLastCalledWith('asset', 461, { all: true });
  });
});
