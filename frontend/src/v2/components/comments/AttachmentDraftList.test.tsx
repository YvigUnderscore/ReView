// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttachmentDraftList from './AttachmentDraftList';
import type { AttachmentDraft } from './attachmentDrafts';
import { t } from '../../i18n';

const image = (id: string, name: string): AttachmentDraft => ({
  id,
  name,
  contentType: 'image/png',
  url: `blob:preview/${id}`,
});

/**
 * Before sending, an attachment was only identified by its file name, so there was no way to
 * check what was sent when the capture was named "image (3).png". So we check the thumbnail,
 * the carousel that a click opens, and the remove button.
 */
describe('AttachmentDraftList', () => {
  it('rend une vignette par image, avec son URL de prévisualisation', () => {
    render(<AttachmentDraftList drafts={[image('file:0', 'image (3).png')]} onRemove={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'image (3).png' })).toHaveAttribute('src', 'blob:preview/file:0');
  });

  it("ouvre le carrousel sur l'image cliquée, même avant envoi", async () => {
    const user = userEvent.setup();
    render(
      <AttachmentDraftList
        drafts={[image('file:0', 'a.png'), image('file:1', 'b.png')]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: t('comments.openAttachment') })[1]);
    const dialog = await screen.findByRole('dialog');
    // The enlarged image is the second one, and the carousel announces its two views.
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'blob:preview/file:1');
    expect(dialog).toHaveTextContent('2 / 2');
  });

  it('retire la pièce désignée par sa croix, sans toucher aux autres', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <AttachmentDraftList
        drafts={[image('file:0', 'a.png'), image('file:1', 'b.png')]}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getAllByRole('button', { name: t('comments.removeAttachment') })[0]);
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('file:0');
  });

  /** A PDF has no thumbnail: it stays a named chip, removable like the others. */
  it("n'ouvre pas de carrousel pour une pièce qui n'est pas une image", () => {
    render(
      <AttachmentDraftList
        drafts={[{ id: 'file:0', name: 'notes.pdf', contentType: 'application/pdf', url: null }]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: t('comments.openAttachment') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('comments.removeAttachment') })).toBeInTheDocument();
    expect(screen.getByText('notes.pdf')).toBeInTheDocument();
  });
});
