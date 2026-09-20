// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleText from './CollapsibleText';
import { COLLAPSE_CHARS } from './collapse';
import { t } from '../../i18n';

const long = 'a'.repeat(COLLAPSE_CHARS + 20);

/**
 * Un commentaire trop grand s'ouvre replié. Deux exigences pèsent sur ce repliage : il doit
 * dire ce qu'il cache, et le texte doit RESTER dans le document — sinon un Ctrl+F et un
 * lecteur d'écran perdent une note qui est pourtant là.
 */
describe('CollapsibleText', () => {
  it('laisse un texte court tel quel, sans indicateur', () => {
    render(
      <CollapsibleText text="trop sombre">
        <p>trop sombre</p>
      </CollapsibleText>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('replie un texte long en annonçant sa taille', () => {
    render(
      <CollapsibleText text={long}>
        <p>{long}</p>
      </CollapsibleText>,
    );
    expect(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    ).toBeInTheDocument();
  });

  it('garde le texte entier dans le document quand il est replié', () => {
    render(
      <CollapsibleText text={long}>
        <p data-testid="corps">{long}</p>
      </CollapsibleText>,
    );
    expect(screen.getByTestId('corps').textContent).toHaveLength(long.length);
  });

  it('déplie puis replie au clic', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleText text={long}>
        <p>{long}</p>
      </CollapsibleText>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: t('comments.collapseComment') })).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    expect(
      screen.getByRole('button', { name: t('comments.expandComment', { count: long.length }) }),
    ).toBeInTheDocument();
  });
});
