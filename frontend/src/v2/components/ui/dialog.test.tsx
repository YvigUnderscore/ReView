// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

/**
 * The rule for closing a modal.
 *
 * It cost two tickets and a settings panel: opening the file picker moves focus out of the
 * document, and the modal closed itself believing the user had clicked elsewhere. The most
 * mundane gesture — "choose an image" — therefore lost the work in progress. A focus that
 * leaves is not an outside click, and this test keeps it that way.
 */
function Harness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Réglages</DialogTitle>
        <input type="file" data-testid="file" />
      </DialogContent>
    </Dialog>
  );
}

describe('DialogContent', () => {
  it('stays open when the focus moves to a system window', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    // What the browser does when the file picker opens: the document loses focus to
    // something outside the modal.
    document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('always closes on Escape: that gesture does mean "I am leaving"', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * A modal's description.
 *
 * The content had `aria-describedby={undefined}` hard-coded: the explanatory sentence was
 * written, displayed, and yet never announced — in every modal in the product at once,
 * since the default lived in the primitive. These three cases hold the rule: we link when
 * there is a description, we point at nothing when there is none, and a caller that sets
 * its own `aria-describedby` stays in control of its dialog.
 */
describe('description accessible de DialogContent', () => {
  it('announces the written description, even when placed deep inside a DialogHeader', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer la version</DialogTitle>
            <DialogDescription>Les annotations liées seront perdues.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Les annotations liées seront perdues.');
  });

  it('points at nothing when the modal has no description', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Réglages</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    // An identifier pointing into the void is not a description: the attribute disappears.
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('lets the caller point at its own text', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby="quota-hint">
          <DialogTitle>Quota</DialogTitle>
          <p id="quota-hint">Il reste 2 Go.</p>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Il reste 2 Go.');
  });
});
