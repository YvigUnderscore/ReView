// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleText from './CollapsibleText';
import { stubLayoutMetrics } from '../../../test/layoutMetrics';
import { t } from '../../i18n';

/**
 * Un contenu qui ne tient pas dans sa surface s'ouvre replié. Trois exigences pèsent sur ce
 * repliage : il doit dire ce qu'il cache, le texte doit RESTER dans le document — sinon un
 * Ctrl+F et un lecteur d'écran perdent une note qui est pourtant là — et l'indicateur ne doit
 * apparaître QUE s'il y a quelque chose à révéler.
 *
 * Tous ces tests posent une mise en page : happy-dom n'en a aucune, et le composant mesure.
 */

const wall = 'a'.repeat(620);
const short = 'trop sombre';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

/** Largeur de la surface d'accueil, en caractères par ligne. */
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
 * Le défaut que ces deux cas ferment : l'indicateur se décidait au nombre de caractères, et la
 * même note obtenait donc la même réponse partout. Au fil, large, « dérouler 90 caractères »
 * s'affichait alors que les trois lignes montraient déjà tout — un clic pour rien.
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
    // 320 caractères : sous l'ancien plafond de 600, et pourtant coupé par `max-h-32` dès que
    // la colonne se rétrécit. Il n'avait alors aucun moyen d'être ouvert.
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
