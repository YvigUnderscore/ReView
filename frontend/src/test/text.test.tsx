// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { textIncluding } from './text';

/**
 * The case that justifies this matcher: two sentences separated by a `<br/>` form, for
 * Testing Library, **a single** own text of the element. The exact search then fails
 * on a perfectly correct screen: it is exactly the shape of the "media unavailable"
 * message served to a guest.
 */
describe('textIncluding', () => {
  it('finds a fragment where exact search fails', () => {
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

  it('does not go up to ancestors, which do not have this text on their own', () => {
    render(
      <section>
        <p>Une seule phrase.</p>
      </section>,
    );

    // Only one match: otherwise `getByText` would throw "found multiple elements".
    expect(screen.getByText(textIncluding('seule')).tagName).toBe('P');
  });
});
