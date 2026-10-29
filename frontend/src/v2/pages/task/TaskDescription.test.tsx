// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn() } }));
vi.mock('../../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TaskDescription from './TaskDescription';
import { t } from '../../i18n';

const mount = (description: string | null, canEdit: boolean) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaskDescription taskId={7} description={description} canEdit={canEdit} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  api.patch.mockResolvedValue({ task: { id: 7 } });
});

afterEach(cleanup);

/**
 * A task's brief (Phase 50): the model had no description field, and the artist read the step's
 * name and guessed the rest.
 */
describe('TaskDescription', () => {
  it('stays silent when there is nothing to read and nothing to write', () => {
    const view = mount(null, false);
    expect(view.container.textContent).toBe('');
  });

  it('shows the brief to someone who cannot write it, without making it clickable', () => {
    mount('Halo too hot on the last 12 frames', false);
    expect(screen.getByText(/Halo too hot/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers to write it when empty, and saves it', async () => {
    mount(null, true);
    fireEvent.click(screen.getByText(t('task.descriptionEmpty')));
    fireEvent.change(screen.getByPlaceholderText(t('task.descriptionPlaceholder')), {
      target: { value: '  Redo the halo  ' },
    });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/tasks/7', { description: 'Redo the halo' }),
    );
  });

  /** Clearing the brief is a change like any other: it is sent as `null`. */
  it('clears the brief by erasing it', async () => {
    mount('To redo', true);
    fireEvent.click(screen.getByText('To redo'));
    fireEvent.change(screen.getByPlaceholderText(t('task.descriptionPlaceholder')), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/tasks/7', { description: null }));
  });

  it('sends nothing when the text has not changed', async () => {
    mount('To redo', true);
    fireEvent.click(screen.getByText('To redo'));
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(screen.getByText('To redo')).toBeTruthy());
    expect(api.patch).not.toHaveBeenCalled();
  });
});
