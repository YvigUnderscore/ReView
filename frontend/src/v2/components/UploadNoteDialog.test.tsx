// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { queryClient } from '../lib/query';
import { useUploadNoteStore, withUploadNote } from '../../stores/useUploadNoteStore';
import UploadNoteDialog from './UploadNoteDialog';
import { t } from '../i18n';

/**
 * The instruction required BEFORE sending (Phase 50).
 *
 * What is verified, and what is at the heart of the decision: when the project requires an instruction,
 * the drop **does not go out** until it is written: nothing is created, not even the
 * version. And when it requires nothing, the question is not displayed: the ordinary path gains
 * no click.
 */

/** Project settings, served to the reader outside the component as well as on screen. */
const settings = (requireNote: boolean) => ({
  settings: { reviewRequest: { requireNote, minNoteLength: 5 } },
});

describe('instruction required at upload', () => {
  beforeEach(() => {
    // The reader outside the component shares the application's cache: a test must not
    // inherit another's rule.
    queryClient.clear();
    useUploadNoteStore.setState({ pending: null });
  });

  it('holds the drop until the instruction is acceptable', async () => {
    const sent: (string | null)[] = [];
    const { user } = renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(true) },
    });

    await act(() => withUploadNote(7, (note) => void sent.push(note)));

    // Nothing left, and the question is asked.
    expect(sent).toHaveLength(0);
    expect(await screen.findByText(t('upload.note.hint'))).toBeTruthy();

    // Empty field: the button stays closed, and the screen says why.
    const upload = screen.getByRole('button', { name: t('common.upload') });
    expect(upload.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(t('reviewers.noteRequired'))).toBeTruthy();

    // Too short: always closed, with the project's floor stated plainly.
    await user.type(screen.getByRole('textbox'), 'ok');
    expect(screen.getByText(t('reviewers.noteTooShort', { min: 5 }))).toBeTruthy();
    expect(upload.hasAttribute('disabled')).toBe(true);

    // Acceptable instruction: the drop resumes, with it.
    await user.type(screen.getByRole('textbox'), ' la lumière du plan');
    await user.click(screen.getByRole('button', { name: t('common.upload') }));
    expect(sent).toEqual(['ok la lumière du plan']);
  });

  it('gives up without creating anything when cancelled', async () => {
    const sent: (string | null)[] = [];
    const { user } = renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(true) },
    });

    await act(() => withUploadNote(8, (note) => void sent.push(note)));
    await user.click(await screen.findByRole('button', { name: t('common.cancel') }));

    expect(sent).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(t('upload.note.hint'))).toBeNull());
  });

  it('asks no question when the project requires nothing', async () => {
    const sent: (string | null)[] = [];
    renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(false) },
    });

    await act(() => withUploadNote(9, (note) => void sent.push(note)));

    expect(sent).toEqual([null]);
    expect(screen.queryByText(t('upload.note.hint'))).toBeNull();
  });

  it('does not block a drop outside any project: the server remains the authority', async () => {
    const sent: (string | null)[] = [];
    renderWithProviders(<UploadNoteDialog />, { api: {} });

    await act(() => withUploadNote(null, (note) => void sent.push(note)));

    expect(sent).toEqual([null]);
  });
});
