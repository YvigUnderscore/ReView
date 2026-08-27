// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogContent, DialogTitle } from './dialog';

/**
 * La règle de fermeture d'une modale.
 *
 * Elle a coûté deux fiches et un panneau de réglages : ouvrir le sélecteur de fichiers fait
 * perdre le focus au document, et la modale se refermait en croyant qu'on avait cliqué
 * ailleurs. Le geste le plus banal — « choisir une image » — emportait donc le travail en
 * cours. Un focus qui sort n'est pas un clic dehors, et ce test le maintient.
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
  it('reste ouverte quand le focus part vers une fenêtre du système', () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    // Ce que fait le navigateur en ouvrant le sélecteur de fichiers : le document perd le
    // focus au profit de quelque chose qui n'est pas dans la modale.
    document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('se ferme toujours sur Échap : ce geste-là veut bien dire « je sors »', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
