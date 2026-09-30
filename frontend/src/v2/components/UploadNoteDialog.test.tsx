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
 * La consigne exigée AVANT l'envoi (Phase 50).
 *
 * Ce qui se vérifie, et qui est le cœur de la décision : quand le projet exige une consigne,
 * le dépôt **ne part pas** tant qu'elle n'est pas écrite — rien n'est créé, pas même la
 * version. Et quand il n'exige rien, la question ne s'affiche pas : le chemin ordinaire ne
 * gagne aucun clic.
 */

/** Réglages du projet, servis au lecteur hors composant comme à l'écran. */
const settings = (requireNote: boolean) => ({
  settings: { reviewRequest: { requireNote, minNoteLength: 5 } },
});

describe('consigne exigée à l’upload', () => {
  beforeEach(() => {
    // Le lecteur hors composant partage le cache de l'application : un test ne doit pas
    // hériter de la règle d'un autre.
    queryClient.clear();
    useUploadNoteStore.setState({ pending: null });
  });

  it('retient le dépôt jusqu’à ce que la consigne convienne', async () => {
    const sent: (string | null)[] = [];
    const { user } = renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(true) },
    });

    await act(() => withUploadNote(7, (note) => void sent.push(note)));

    // Rien n'est parti, et la question est posée.
    expect(sent).toHaveLength(0);
    expect(await screen.findByText(t('upload.note.hint'))).toBeTruthy();

    // Champ vide : le bouton reste fermé, et l'écran dit pourquoi.
    const upload = screen.getByRole('button', { name: t('common.upload') });
    expect(upload.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(t('reviewers.noteRequired'))).toBeTruthy();

    // Trop courte : toujours fermé, avec le plancher du projet en clair.
    await user.type(screen.getByRole('textbox'), 'ok');
    expect(screen.getByText(t('reviewers.noteTooShort', { min: 5 }))).toBeTruthy();
    expect(upload.hasAttribute('disabled')).toBe(true);

    // Consigne recevable : le dépôt reprend, avec elle.
    await user.type(screen.getByRole('textbox'), ' la lumière du plan');
    await user.click(screen.getByRole('button', { name: t('common.upload') }));
    expect(sent).toEqual(['ok la lumière du plan']);
  });

  it('abandonne sans rien créer quand on renonce', async () => {
    const sent: (string | null)[] = [];
    const { user } = renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(true) },
    });

    await act(() => withUploadNote(8, (note) => void sent.push(note)));
    await user.click(await screen.findByRole('button', { name: t('common.cancel') }));

    expect(sent).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(t('upload.note.hint'))).toBeNull());
  });

  it('ne pose aucune question quand le projet n’exige rien', async () => {
    const sent: (string | null)[] = [];
    renderWithProviders(<UploadNoteDialog />, {
      api: { 'GET /api/projects/:id/settings': settings(false) },
    });

    await act(() => withUploadNote(9, (note) => void sent.push(note)));

    expect(sent).toEqual([null]);
    expect(screen.queryByText(t('upload.note.hint'))).toBeNull();
  });

  it('ne bloque pas un dépôt hors projet — le serveur reste l’autorité', async () => {
    const sent: (string | null)[] = [];
    renderWithProviders(<UploadNoteDialog />, { api: {} });

    await act(() => withUploadNote(null, (note) => void sent.push(note)));

    expect(sent).toEqual([null]);
  });
});
