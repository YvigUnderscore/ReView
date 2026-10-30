// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Row, SettingNumber, SettingSelect } from './SgSettingsPrimitives';

/**
 * A settings row label must name its control.
 *
 * It lived in a `<div>`: the page reads fine by eye, but a screen reader listed ten
 * indistinguishable "dropdowns". These three cases cover the association, and the fact
 * that a field placed outside a row keeps its last-resort name.
 */
describe('Row', () => {
  it('gives its label to the select it carries', () => {
    render(
      <Row label="Mode de publication">
        <SettingSelect value="link" onChange={() => {}}>
          <option value="link">Lien</option>
        </SettingSelect>
      </Row>,
    );

    expect(screen.getByRole('combobox', { name: 'Mode de publication' })).toBeInTheDocument();
  });

  it('names the numeric field by its row, not by its placeholder', () => {
    // "Sans limite" is an example value, not the name of the setting.
    render(
      <Row label="Taille maximale">
        <SettingNumber value={12} placeholder="Sans limite" onChange={() => {}} />
      </Row>,
    );

    expect(screen.getByRole('spinbutton', { name: 'Taille maximale' })).toBeInTheDocument();
  });

  it('falls back on the placeholder when the field is placed outside a row', () => {
    render(<SettingNumber value="" placeholder="Sans limite" onChange={() => {}} />);

    expect(screen.getByRole('spinbutton', { name: 'Sans limite' })).toBeInTheDocument();
  });
});
