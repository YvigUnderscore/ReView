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
 * Le panneau ne fait que trois choses, mais chacune se voit : déclencher le bon format,
 * dire que le fichier est parti, et dire aussi quand il est incomplet.
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
  it('offre exactement deux sorties : le tableur et la planche', () => {
    mount();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('demande le CSV de la portée affichée et confirme le téléchargement', async () => {
    mount();
    await userEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'media', id: 7, format: 'csv' }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it('demande la planche imprimable sur le second bouton', async () => {
    mount();
    await userEvent.click(screen.getAllByRole('button')[1]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'media', id: 7, format: 'sheet' }));
  });

  it('prévient quand le serveur a plafonné l’export', async () => {
    download.mockResolvedValue({ filename: 'notes-media-7.csv', truncated: true });
    mount();
    await userEvent.click(screen.getAllByRole('button')[0]);
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled());
  });

  it('remonte l’échec sans laisser l’interface bloquée', async () => {
    download.mockRejectedValue(new Error('No access to this project'));
    mount();
    const csv = screen.getAllByRole('button')[0] as HTMLButtonElement;
    await userEvent.click(csv);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('No access to this project'));
    await waitFor(() => expect(csv.disabled).toBe(false));
  });
});
