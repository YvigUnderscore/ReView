// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { t } from '../../i18n';
import NoteEditor from './NoteEditor';

/**
 * The note editor, mounted the way the application mounts it.
 *
 * What matters is not the shape of the screen but the end-to-end contract: what is opened, what is done in it, and
 * what goes to the server. Markdown remains the saved format, and that is precisely what these tests watch: the editor
 * may change appearance, but it cannot start writing something else.
 */

const API = { 'GET /api/note-templates': { templates: [] } };

const mount = (initial: string) => {
  const onSave = vi.fn();
  const out = renderWithProviders(
    <NoteEditor
      initial={initial}
      kind="shots"
      id={12}
      projectId={1}
      scope="shot"
      onSave={onSave}
      onCancel={vi.fn()}
    />,
    { api: API },
  );
  return { ...out, onSave };
};

const save = () => screen.getByRole('button', { name: t('common.save') });

describe('NoteEditor', () => {
  it('opens an existing note as blocks, and saves it back unchanged', async () => {
    const source = '## Brief\n\nAmbiance de nuit.\n\n::progress Animation 60';
    const { onSave, user } = mount(source);

    // The section title is a field, not a line of syntax.
    expect(screen.getByDisplayValue('Brief')).toBeInTheDocument();
    // The gauge is set by its figure, and the text is displayed rendered.
    expect(screen.getByDisplayValue('Animation')).toBeInTheDocument();
    expect(screen.getByText('Ambiance de nuit.')).toBeInTheDocument();
    // No directive on screen: that is the whole point of the change.
    expect(screen.queryByText(/::progress/)).not.toBeInTheDocument();

    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(source);
  });

  it('writes the expected directive when a block is adjusted', async () => {
    const { onSave, user } = mount('::progress Animation 60');

    const label = screen.getByDisplayValue('Animation');
    await user.clear(label);
    await user.type(label, 'Compositing');
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('::progress Compositing 60');
  });

  it('adds a block through the menu, at the requested place', async () => {
    const { onSave, user } = mount('Un mot.');

    // The last "+" is the one at the end of the note; the others live between the blocks.
    const adders = screen.getAllByRole('button', { name: t('note.block.add') });
    await user.click(adders[adders.length - 1]);
    await user.click(await screen.findByRole('button', { name: t('note.block.divider') }));
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('Un mot.\n\n---');
  });

  it('removes a block, and the note no longer mentions it', async () => {
    const { onSave, user } = mount('Un mot.\n\n::small Précision');

    const rows = screen.getAllByRole('button', { name: t('note.block.remove') });
    await user.click(rows[rows.length - 1]);
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('Un mot.');
  });

  it('switches to preview: the note is read there as it will be read', async () => {
    const { user } = mount('## Brief\n\n::progress Animation 60');

    await user.click(screen.getByRole('button', { name: t('note.preview') }));

    const gauge = screen.getByRole('progressbar');
    expect(within(gauge).queryByRole('textbox')).not.toBeInTheDocument();
    expect(gauge).toHaveAttribute('aria-valuenow', '60');
  });

  it('opens an empty note on a text block ready to be written', () => {
    mount('');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  /**
   * A file dropped beside a drop zone: the browser would open it in place of the page, taking the note
   * being written with it. The guard listens in the **capture** phase: in the bubble phase, a middle handler stopping
   * propagation was enough for it to never see anything pass, which the page indeed did.
   */
  it('cancels the drop of a file outside a zone, even when propagation is stopped', () => {
    mount('Un mot.');
    document.body.addEventListener('drop', (e) => e.stopPropagation());

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
  });
});
