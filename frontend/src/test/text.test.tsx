// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { textIncluding } from './text';

/**
 * Le cas qui justifie ce matcher : deux phrases séparées par un `<br/>` forment, pour
 * Testing Library, **un seul** texte propre à l'élément. La recherche exacte échoue alors
 * sur un écran parfaitement correct — c'est très exactement la forme du message « média
 * indisponible » servi à un invité.
 */
describe('textIncluding', () => {
  it('trouve un fragment là où la recherche exacte échoue', () => {
    render(
      <p>
        Première phrase.
        <br />
        Seconde phrase.
      </p>,
    );

    expect(() => screen.getByText('Première phrase.')).toThrow();
    expect(screen.getByText(textIncluding('Première phrase.'))).toHaveTextContent('Seconde phrase.');
  });

  it('ne remonte pas jusqu’aux ancêtres, qui n’ont pas ce texte en propre', () => {
    render(
      <section>
        <p>Une seule phrase.</p>
      </section>,
    );

    // Une seule correspondance : sinon `getByText` lèverait « found multiple elements ».
    expect(screen.getByText(textIncluding('seule')).tagName).toBe('P');
  });
});
