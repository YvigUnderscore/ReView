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

vi.mock('../lib/notesExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/notesExport')>()),
  downloadNotes: download,
}));
vi.mock('sonner', () => ({ toast: toasts }));

import { NotesExportButtons } from './NotesExportMenu';
import { notesFormatsFor, useNotesExportEntry } from '../lib/useNotesExportMenu';
import EntityContextMenu from './ui/entity-menu';
import type { NotesScope } from '../lib/notesExport';

/**
 * L'EDL et l'OTIO existaient sans surface d'appel. Ce qui se vérifie ici : ils sont
 * proposés là où le serveur les accepte — une suite de plans — et nulle part ailleurs.
 */

const withQuery = (node: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
};

/** Petit hôte : le sous-menu déclaratif n'existe qu'à travers un menu contextuel. */
function MenuHost({ scope, id }: { scope: NotesScope; id: number }) {
  const entry = useNotesExportEntry({ scope, id });
  return (
    <EntityContextMenu entries={[entry]}>
      <p>{'zone'}</p>
    </EntityContextMenu>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  download.mockResolvedValue({ filename: 'notes-timeline-3.edl', truncated: false });
});

afterEach(cleanup);

describe('notesFormatsFor', () => {
  it('n’offre l’EDL et l’OTIO que sur une suite de plans', () => {
    expect(notesFormatsFor('timeline')).toEqual(['csv', 'sheet', 'edl', 'otio']);
    expect(notesFormatsFor('playlist')).toEqual(['csv', 'sheet', 'edl', 'otio']);
    for (const scope of ['media', 'version', 'shot'] as NotesScope[])
      expect(notesFormatsFor(scope)).toEqual(['csv', 'sheet']);
  });
});

describe('NotesExportButtons', () => {
  it('propose les quatre formats du montage', () => {
    withQuery(<NotesExportButtons scope="timeline" id={3} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('demande l’EDL de la portée affichée et confirme le téléchargement', async () => {
    withQuery(<NotesExportButtons scope="timeline" id={3} />);
    await userEvent.click(screen.getAllByRole('button')[2]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'timeline', id: 3, format: 'edl' }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it('demande l’OTIO sur le quatrième bouton', async () => {
    withQuery(<NotesExportButtons scope="timeline" id={3} />);
    await userEvent.click(screen.getAllByRole('button')[3]);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'timeline', id: 3, format: 'otio' }));
  });

  it('prévient d’un export plafonné et laisse l’échec réessayable', async () => {
    download.mockResolvedValue({ filename: 'notes-timeline-3.csv', truncated: true });
    withQuery(<NotesExportButtons scope="timeline" id={3} />);
    const csv = screen.getAllByRole('button')[0] as HTMLButtonElement;
    await userEvent.click(csv);
    await waitFor(() => expect(toasts.warning).toHaveBeenCalled());

    download.mockRejectedValue(new Error('No access to this project'));
    await userEvent.click(csv);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('No access to this project'));
    await waitFor(() => expect(csv.disabled).toBe(false));
  });

  it('ne propose que le tableur et la planche sur un média isolé', () => {
    withQuery(<NotesExportButtons scope="media" id={7} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('useNotesExportEntry', () => {
  it('décrit un sous-menu dont chaque entrée déclenche son format', async () => {
    withQuery(<MenuHost scope="playlist" id={11} />);
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByText('zone') });
    const trigger = await screen.findByRole('menuitem', { name: /notesExport\.title|Review notes/i });
    await userEvent.click(trigger);
    const otio = await screen.findByRole('menuitem', { name: /OpenTimelineIO|notesExport\.otio/i });
    await userEvent.click(otio);
    await waitFor(() => expect(download).toHaveBeenCalledWith({ scope: 'playlist', id: 11, format: 'otio' }));
  });
});
