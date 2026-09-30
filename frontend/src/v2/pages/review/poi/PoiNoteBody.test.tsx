// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { stubLayoutMetrics } from '../../../../test/layoutMetrics';
import { t } from '../../../i18n';
import PoiNoteBody from './PoiNoteBody';

/**
 * Ce que la remarque d'un point doit faire, et que les deux surfaces faisaient mal : revenir à
 * la ligne (jamais de défilement en largeur), n'en montrer que trois, et poser sa miniature À
 * CÔTÉ du texte — une remarque illisible dans une carte de 15 rem n'est pas une remarque.
 *
 * Le repliage se MESURE : ces tests posent donc la largeur de la surface d'accueil, que
 * happy-dom ne fournit pas. Les deux valeurs viennent d'une vérification en navigateur — une
 * quarantaine de caractères par ligne au fil de commentaires, une vingtaine dans la carte
 * ancrée large de 15 rem.
 */

/** Caractères par ligne au fil de commentaires, la surface large. */
const THREAD_CHARS = 40;
/** Caractères par ligne dans la carte ancrée de 15 rem, la surface étroite. */
const CARD_CHARS = 22;

/** Un chemin de plan : pas un espace, et bien plus large qu'une carte de scène. */
const longPath = '/mnt/prod/seq010/sh0420/comp/v012/sh0420_comp_v012_beauty_linear_exr_sequence';
const images = [
  { src: 'blob:defaut', alt: 'defaut.png' },
  { src: 'blob:autre', alt: 'autre.png' },
  { src: 'blob:troisieme', alt: 'troisieme.png' },
];

let restore: (() => void) | null = null;

const layout = (charsPerLine: number) => {
  restore?.();
  restore = stubLayoutMetrics({ charsPerLine });
};

afterEach(() => {
  restore?.();
  restore = null;
});

const expandButton = (text: string) =>
  screen.getByRole('button', { name: t('comments.expandComment', { count: text.length }) });

describe('PoiNoteBody — la remarque se lit sans déborder', () => {
  it('coupe un mot insécable sur l’élément même qui porte le texte', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    const body = container.querySelector('.whitespace-pre-wrap');
    expect(body?.textContent).toBe(longPath);
    // La coupe doit porter l'élément QUI CONTIENT le texte : posée sur un ancêtre, elle laisse
    // l'enfant pousser la rangée hors de la colonne.
    expect(container.querySelector('.break-words')).toBe(body);
    // Et rien, au-dessus, ne rouvre un axe horizontal. Ces classes existent bel et bien dans
    // le dépôt — l'étiquette repliée d'une carte de scène se sert de `truncate` — les employer
    // ici ramènerait le défilement dont l'utilisateur ne veut pas.
    const reopens = /(^|\s)(truncate|whitespace-nowrap|overflow-(x-)?(auto|scroll))(\s|$)/;
    for (const el of Array.from(container.querySelectorAll('*')))
      expect(el.getAttribute('class') ?? '').not.toMatch(reopens);
  });

  it('n’en montre que trois lignes tant qu’on n’a pas déroulé', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
    fireEvent.click(expandButton(longPath));
    expect(container.querySelector('.line-clamp-3')).toBeNull();
    // Et on peut la replier : la carte ne reste pas ouverte en grand sur la scène.
    fireEvent.click(screen.getByRole('button', { name: t('comments.collapseComment') }));
    expect(container.querySelector('.line-clamp-3')).not.toBeNull();
  });

  it('garde la remarque entière dans le document, repliée comme dépliée', () => {
    layout(CARD_CHARS);
    const { container } = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(container.querySelector('.line-clamp-3')?.textContent).toHaveLength(longPath.length);
  });

  it('laisse une remarque courte sans indicateur à cliquer', () => {
    layout(CARD_CHARS);
    render(<PoiNoteBody text="la soudure" images={[]} onImage={vi.fn()} />);
    expect(screen.getByText('la soudure')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /**
   * Le défaut fermé ici : l'indicateur se décidait au nombre de caractères, calibré sur la
   * carte étroite, et s'affichait donc aussi au fil — trois fois plus large — où les trois
   * lignes montraient déjà tout. « Dérouler 77 caractères », un clic, et rien ne se révélait.
   */
  it('ne propose de dérouler que là où la remarque déborde vraiment', () => {
    layout(THREAD_CHARS);
    const thread = render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    thread.unmount();

    layout(CARD_CHARS);
    render(<PoiNoteBody text={longPath} images={[]} onImage={vi.fn()} />);
    expect(expandButton(longPath)).toBeInTheDocument();
  });

  it('pose la miniature À CÔTÉ du texte, dans la même rangée', () => {
    layout(THREAD_CHARS);
    render(<PoiNoteBody text="la soudure" images={images.slice(0, 1)} onImage={vi.fn()} />);
    const strip = screen.getByRole('img').closest('div');
    const row = strip?.parentElement;
    expect(row?.className).toContain('flex');
    // Le texte occupe le premier enfant de la rangée, les vignettes le second : à côté, pas
    // dessous — et `shrink-0` les empêche d'être écrasées par un texte long.
    expect(row?.firstElementChild?.textContent).toContain('la soudure');
    expect(row?.firstElementChild).not.toBe(strip);
    expect(strip?.className).toContain('shrink-0');
  });

  it('ouvre la Lightbox sur la miniature cliquée, sans rejouer la sélection de la carte', () => {
    layout(THREAD_CHARS);
    const onImage = vi.fn();
    const stop = vi.fn();
    render(<PoiNoteBody text="la soudure" images={images.slice(0, 1)} onImage={onImage} stop={stop} />);
    fireEvent.click(screen.getByRole('button', { name: t('comments.openAttachment') }));
    expect(onImage).toHaveBeenCalledWith(0);
    expect(stop).toHaveBeenCalled();
  });

  it('au-delà d’une image, une tuile ouvre la suite sans manger la largeur', () => {
    layout(THREAD_CHARS);
    const onImage = vi.fn();
    render(<PoiNoteBody text="la soudure" images={images} onImage={onImage} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: t('comment.seeAllImages') }));
    expect(onImage).toHaveBeenCalledWith(1);
  });
});
