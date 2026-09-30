// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { t } from '../../i18n';
import NoteEditor from './NoteEditor';

/**
 * L'éditeur de fiche, monté comme l'application le monte.
 *
 * Ce qui compte n'est pas la forme de l'écran mais le contrat de bout en bout : ce qu'on
 * ouvre, ce qu'on y fait, ce qui part au serveur. Le markdown reste le format enregistré,
 * et c'est précisément ce que ces tests surveillent — l'éditeur peut changer d'apparence,
 * il ne peut pas se mettre à écrire autre chose.
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
  it('ouvre une fiche existante en blocs, et la réenregistre telle quelle', async () => {
    const source = '## Brief\n\nAmbiance de nuit.\n\n::progress Animation 60';
    const { onSave, user } = mount(source);

    // Le titre de section est un champ, pas une ligne de syntaxe.
    expect(screen.getByDisplayValue('Brief')).toBeInTheDocument();
    // La jauge se règle au chiffre, et le texte s'affiche rendu.
    expect(screen.getByDisplayValue('Animation')).toBeInTheDocument();
    expect(screen.getByText('Ambiance de nuit.')).toBeInTheDocument();
    // Aucune directive à l'écran : c'est tout l'objet du changement.
    expect(screen.queryByText(/::progress/)).not.toBeInTheDocument();

    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(source);
  });

  it('écrit la directive attendue quand on règle un bloc', async () => {
    const { onSave, user } = mount('::progress Animation 60');

    const label = screen.getByDisplayValue('Animation');
    await user.clear(label);
    await user.type(label, 'Compositing');
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('::progress Compositing 60');
  });

  it('ajoute un bloc par le menu, à l’endroit demandé', async () => {
    const { onSave, user } = mount('Un mot.');

    // Le dernier « + » est celui de la fin de fiche ; les autres vivent entre les blocs.
    const adders = screen.getAllByRole('button', { name: t('note.block.add') });
    await user.click(adders[adders.length - 1]);
    await user.click(await screen.findByRole('button', { name: t('note.block.divider') }));
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('Un mot.\n\n---');
  });

  it('retire un bloc, et la fiche ne le mentionne plus', async () => {
    const { onSave, user } = mount('Un mot.\n\n::small Précision');

    const rows = screen.getAllByRole('button', { name: t('note.block.remove') });
    await user.click(rows[rows.length - 1]);
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith('Un mot.');
  });

  it('bascule en aperçu : la fiche s’y lit comme elle sera lue', async () => {
    const { user } = mount('## Brief\n\n::progress Animation 60');

    await user.click(screen.getByRole('button', { name: t('note.preview') }));

    const gauge = screen.getByRole('progressbar');
    expect(within(gauge).queryByRole('textbox')).not.toBeInTheDocument();
    expect(gauge).toHaveAttribute('aria-valuenow', '60');
  });

  it('ouvre une fiche vide sur un bloc de texte prêt à écrire', () => {
    mount('');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  /**
   * Un fichier lâché à côté d'une zone de dépôt : le navigateur l'ouvrirait à la place de
   * la page, emportant la fiche en cours. Le garde-fou écoute en **capture** — en remontée,
   * il suffisait qu'un gestionnaire intermédiaire arrête la propagation pour qu'il ne voie
   * jamais rien passer, ce que la page faisait bel et bien.
   */
  it('annule le dépôt d’un fichier hors zone, même si la propagation est arrêtée', () => {
    mount('Un mot.');
    document.body.addEventListener('drop', (e) => e.stopPropagation());

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
  });
});
