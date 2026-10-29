// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleText from './CollapsibleText';
import { stubLayoutMetrics } from '@/test/layoutMetrics';
import { t } from '../../i18n';

/**
 * Content that does not fit its surface opens collapsed. Three requirements apply to this
 * collapse: it must say what it hides, the text must REMAIN in the document (otherwise Ctrl+F
 * and screen readers lose a note that is actually there), and the indicator must appear ONLY
 * when there is something to reveal.
 *
 * All these tests set up a layout: happy-dom has none, and the component measures.
 */

const wall = 'a'.repeat(620);
const short = 'trop sombre';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

/** Width of the landing surface, in characters per line. */
const layout = (charsPerLine: number) => {
  restore = stubLayoutMetrics({ charsPerLine });
};

const expandName = (text: string) => t('comments.expandComment', { count: text.length });

describe('CollapsibleText', () => {
  it('laisse un texte court tel quel, sans indicateur', () => {
    layout(40);
    render(
      <CollapsibleText text={short}>
        <p>{short}</p>
      </CollapsibleText>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('replie un texte long en annonçant sa taille', () => {
    layout(40);
    render(
      <CollapsibleText text={wall}>
        <p>{wall}</p>
      </CollapsibleText>,
    );
    expect(screen.getByRole('button', { name: expandName(wall) })).toBeInTheDocument();
  });

  it('garde le texte entier dans le document quand il est replié', () => {
    layout(40);
    render(
      <CollapsibleText text={wall}>
        <p data-testid="corps">{wall}</p>
      </CollapsibleText>,
    );
    expect(screen.getByTestId('corps').textContent).toHaveLength(wall.length);
  });

  it('déplie puis replie au clic', async () => {
    layout(40);
    const user = userEvent.setup();
    render(
      <CollapsibleText text={wall}>
        <p>{wall}</p>
      </CollapsibleText>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: t('comments.collapseComment') })).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: expandName(wall) })).toBeInTheDocument();
  });
});

/**
 * The bug these two cases close: the indicator was decided by character count, so the same
 * note got the same answer everywhere. In a wide thread, "expand 90 characters" was shown
 * while the three lines already showed everything, a click for nothing.
 */
describe('CollapsibleText — la surface décide, pas le nombre de caractères', () => {
  const note = 'x'.repeat(90);

  it('ne propose rien quand les trois lignes montrent déjà tout (fil large)', () => {
    layout(40);
    render(
      <CollapsibleText text={note} lines={3}>
        {note}
      </CollapsibleText>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('propose de dérouler la MÊME note dans une carte étroite', () => {
    layout(22);
    render(
      <CollapsibleText text={note} lines={3}>
        {note}
      </CollapsibleText>,
    );
    expect(screen.getByRole('button', { name: expandName(note) })).toBeInTheDocument();
  });

  it('un commentaire réellement coupé garde son bouton, même en dessous des anciens seuils', () => {
    // 320 characters: below the old 600 ceiling, yet clipped by `max-h-32` as soon as
    // the column narrows. It then had no way to be opened.
    const cut = 'y'.repeat(320);
    layout(20);
    render(
      <CollapsibleText text={cut}>
        <p>{cut}</p>
      </CollapsibleText>,
    );
    expect(screen.getByRole('button', { name: expandName(cut) })).toBeInTheDocument();
  });
});
