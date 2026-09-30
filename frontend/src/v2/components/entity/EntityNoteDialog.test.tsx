// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';
import EntityNoteDialog from './EntityNoteDialog';

/**
 * La porte de la fenêtre.
 *
 * Échap, le clic à l'extérieur et la croix mènent tous au même endroit — et une fiche à
 * moitié écrite ne doit pas partir avec. Le cas s'est présenté sans qu'on le cherche :
 * annuler le sélecteur de fichiers se fait avec Échap, et cet Échap-là emportait l'édition.
 */

const API = {
  'GET /api/shots/12/note': { note: { body: 'Brief initial', updatedAt: null, updatedBy: null } },
  'GET /api/note-templates': { templates: [] },
};

const mount = () => {
  const onClose = vi.fn();
  const out = renderWithProviders(
    <EntityNoteDialog kind="shots" id={12} projectId={1} canManage people={[]} onClose={onClose} />,
    { api: API },
  );
  return { ...out, onClose };
};

/** Ouvre l'édition et écrit quelque chose — la fiche devient « sale ». */
async function edit(user: ReturnType<typeof mount>['user']) {
  await user.click(await screen.findByRole('button', { name: t('common.edit') }));
  await user.click(await screen.findByRole('button', { name: t('note.text.edit') }));
  await user.type(screen.getByRole('textbox'), ' modifié');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EntityNoteDialog', () => {
  it('ferme sans rien demander tant que rien n’a changé', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { user, onClose } = mount();

    await user.keyboard('{Escape}');

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('demande confirmation quand une fiche en cours d’écriture allait être perdue', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { user, onClose } = mount();

    await edit(user);
    await user.keyboard('{Escape}');

    expect(confirm).toHaveBeenCalledWith(t('note.discardConfirm'));
    // Refus : la fenêtre reste, et le texte avec elle.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Brief initial modifié');
  });

  it('laisse partir quand la perte est assumée', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const { user, onClose } = mount();

    await edit(user);
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
