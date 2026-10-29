// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { t } from '../../i18n';
import EntityNoteDialog from './EntityNoteDialog';

/**
 * The window's gate.
 *
 * Escape, a click outside and the close button all lead to the same place, and a half-written note must not
 * leave with them. The case came up unbidden: cancelling the file picker is done with Escape, and that Escape
 * discarded the edit.
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

/** Opens the editor and types something: the note becomes "dirty". */
async function edit(user: ReturnType<typeof mount>['user']) {
  await user.click(await screen.findByRole('button', { name: t('common.edit') }));
  await user.click(await screen.findByRole('button', { name: t('note.text.edit') }));
  await user.type(screen.getByRole('textbox'), ' modifié');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EntityNoteDialog', () => {
  it('closes without asking anything as long as nothing has changed', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { user, onClose } = mount();

    await user.keyboard('{Escape}');

    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for confirmation when a note being written would be lost', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { user, onClose } = mount();

    await edit(user);
    await user.keyboard('{Escape}');

    expect(confirm).toHaveBeenCalledWith(t('note.discardConfirm'));
    // Refusal: the window stays, and the text with it.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Brief initial modifié');
  });

  it('lets it go when the loss is accepted', async () => {
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
