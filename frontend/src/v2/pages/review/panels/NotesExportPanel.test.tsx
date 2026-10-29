// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { download, toasts } = vi.hoisted(() => ({
  download: vi.fn(),
  toasts: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../lib/notesExport', () => ({ downloadNotes: download }));
vi.mock('sonner', () => ({ toast: toasts }));

import NotesExportPanel from './NotesExportPanel';

/**
 * The panel does only three things, but each one is visible: triggering the right format, saying that
 * the file has left, and also saying when it is incomplete.
 */

function mount() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesExportPanel scope="media" id={7} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  download.mockResolvedValue({ filename: 'notes-media-7.csv', truncated: false });
});

afterEach(cleanup);

describe('NotesExportPanel', () => {
  it('offers exactly two outputs: the spreadsheet and the contact sheet', () => {
    mount();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('requests the CSV of the displayed scope and confirms the download', async () => {
    mount();
    await userEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'media', id: 7, format: 'csv' }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it('requests the printable contact sheet from the second button', async () => {
    mount();
    await userEvent.click(screen.getAllByRole('button')[1]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'media', id: 7, format: 'sheet' }));
  });

  it('warns when the server capped the export', async () => {
    download.mockResolvedValue({ filename: 'notes-media-7.csv', truncated: true });
    mount();
    await userEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled());
  });

  it('surfaces the failure without leaving the interface blocked', async () => {
    download.mockRejectedValue(new Error('No access to this project'));
    mount();
    const csv = screen.getAllByRole('button')[0] as HTMLButtonElement;
    await userEvent.click(csv);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('No access to this project'));
    await waitFor(() => expect(csv.disabled).toBe(false));
  });
});
