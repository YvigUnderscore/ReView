// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '../../../i18n';
import PoiDraftRows from './PoiDraftRows';
import type { PoiDraft, PoiDraftState } from './usePoiDraft';

/**
 * Le composeur est le premier endroit où l'on voit une remarque de point : c'est là qu'on la
 * tape. Un champ mono-ligne y défilait en largeur par construction — jamais de retour à la
 * ligne, jamais trois lignes visibles — et ses vignettes partaient DESSOUS.
 *
 * On vérifie donc ce que l'utilisateur a demandé, à l'écriture : un champ qui revient à la
 * ligne, grandit jusqu'à trois lignes puis défile verticalement, et ses images à côté.
 */

/** Hauteur de ligne de repli du primitif quand `line-height` n'est pas calculable. */
const LINE = 20;

const point = (patch: Partial<PoiDraft> = {}): PoiDraft => ({
  key: 'p1',
  position: '0 0 0',
  normal: '0 0 1',
  space: 'object',
  text: '',
  files: [],
  ...patch,
});

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

function draftState(points: PoiDraft[], patch: Partial<PoiDraftState> = {}): PoiDraftState {
  return {
    points,
    activeKey: null,
    setActiveKey: vi.fn(),
    add: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    setText: vi.fn(),
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    clear: vi.fn(),
    ...patch,
  };
}

/** Le champ de la remarque du point de rang `n`. */
const noteField = (n: number) => screen.getByLabelText(t('poi.noteFor', { n }));

/** Hauteur de contenu que le navigateur rendrait : happy-dom ne met rien en page. */
function pretendContent(el: HTMLElement, lines: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: lines * LINE });
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:apercu');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PoiDraftRows — on écrit la remarque comme elle se lira', () => {
  it('ne rend rien tant qu’aucun point n’est posé', () => {
    const { container } = render(<PoiDraftRows poi={draftState([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offre un champ MULTI-LIGNE, pas un champ qui défile en largeur', () => {
    render(<PoiDraftRows poi={draftState([point()])} />);
    const field = noteField(1);
    // Un `input` ne revient jamais à la ligne : le champ doit être une zone de texte.
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveClass('break-words');
  });

  it('grandit jusqu’à trois lignes, puis défile verticalement', () => {
    render(<PoiDraftRows poi={draftState([point({ text: 'la soudure' })])} />);
    const field = noteField(1);

    pretendContent(field, 2);
    fireEvent.input(field);
    expect(field.style.height).toBe(`${2 * LINE}px`);
    expect(field.style.overflowY).toBe('hidden');

    // Quatre lignes de contenu : la rangée ne grandit plus, c'est le champ qui défile.
    pretendContent(field, 4);
    fireEvent.input(field);
    expect(field.style.height).toBe(`${3 * LINE}px`);
    expect(field.style.overflowY).toBe('auto');
  });

  it('rend la remarque tapée au brouillon du point, sauts de ligne compris', () => {
    const setText = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { setText })} />);
    fireEvent.change(noteField(1), { target: { value: 'la soudure\nressort au raccord' } });
    expect(setText).toHaveBeenCalledWith('p1', 'la soudure\nressort au raccord');
  });

  it('met le point en avant dès qu’on écrit dedans', () => {
    const setActiveKey = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { setActiveKey })} />);
    fireEvent.focus(noteField(1));
    expect(setActiveKey).toHaveBeenCalledWith('p1');
  });

  it('pose les vignettes À CÔTÉ du champ, dans la même rangée', () => {
    render(<PoiDraftRows poi={draftState([point({ files: [png('defaut.png')] })])} />);
    const field = noteField(1);
    const strip = screen.getByRole('list', { name: t('comments.attachmentsList') });
    // Même rangée : la bande de vignettes est une sœur du champ, pas un bloc sous la rangée.
    expect(strip.parentElement?.parentElement).toBe(field.parentElement);
    expect(strip.parentElement?.className).toContain('shrink-0');
    expect(screen.getByRole('img', { name: 'defaut.png' })).toHaveAttribute('src', 'blob:apercu');
  });

  it('retire l’image désignée du bon point', () => {
    const removeFile = vi.fn();
    render(
      <PoiDraftRows poi={draftState([point({ files: [png('a.png'), png('b.png')] })], { removeFile })} />,
    );
    const crosses = screen.getAllByRole('button', { name: t('comments.removeAttachment') });
    fireEvent.click(crosses[1]);
    expect(removeFile).toHaveBeenCalledWith('p1', 1);
  });

  it('supprime le point d’une croix', () => {
    const remove = vi.fn();
    render(<PoiDraftRows poi={draftState([point()], { remove })} />);
    fireEvent.click(screen.getByRole('button', { name: t('poi.removePoint') }));
    expect(remove).toHaveBeenCalledWith('p1');
  });

  it('numérote les rangées dans l’ordre de pose', () => {
    render(<PoiDraftRows poi={draftState([point(), point({ key: 'p2' })])} />);
    expect(noteField(1)).toBeInTheDocument();
    expect(noteField(2)).toBeInTheDocument();
  });
});
