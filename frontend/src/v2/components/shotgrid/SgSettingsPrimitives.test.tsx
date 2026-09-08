// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Row, SettingNumber, SettingSelect } from './SgSettingsPrimitives';

/**
 * Le libellé d'une ligne de réglages doit nommer son contrôle.
 *
 * Il vivait dans un `<div>` : la page se lit à l'œil, mais un lecteur d'écran énumérait dix
 * « listes déroulantes » indiscernables. Ces trois cas tiennent l'association — et le fait
 * qu'un champ posé hors d'une ligne garde son dernier recours.
 */
describe('Row', () => {
  it('donne son libellé au sélecteur qu’elle porte', () => {
    render(
      <Row label="Mode de publication">
        <SettingSelect value="link" onChange={() => {}}>
          <option value="link">Lien</option>
        </SettingSelect>
      </Row>,
    );

    expect(screen.getByRole('combobox', { name: 'Mode de publication' })).toBeInTheDocument();
  });

  it('nomme le champ numérique par la ligne, pas par son placeholder', () => {
    // « Sans limite » est un exemple de valeur, pas le nom du réglage.
    render(
      <Row label="Taille maximale">
        <SettingNumber value={12} placeholder="Sans limite" onChange={() => {}} />
      </Row>,
    );

    expect(screen.getByRole('spinbutton', { name: 'Taille maximale' })).toBeInTheDocument();
  });

  it('retombe sur le placeholder quand le champ est posé hors d’une ligne', () => {
    render(<SettingNumber value="" placeholder="Sans limite" onChange={() => {}} />);

    expect(screen.getByRole('spinbutton', { name: 'Sans limite' })).toBeInTheDocument();
  });
});
