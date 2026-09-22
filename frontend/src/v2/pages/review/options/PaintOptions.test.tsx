// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PaintOptions from './PaintOptions';
import { toolsFor, type ReviewTool } from '../chrome/tools';
import { MAX_STROKE_PX, MIN_STROKE_PX } from '../splat/paint/strokes';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import { t } from '../../../i18n';

/**
 * Réglages de la brosse de surface — les MÊMES dans les deux barres d'options spatiales. Ce qui
 * est vérifié ici est la demande de l'utilisateur, mot pour mot : « je ne peux pas changer la
 * scale ». L'épaisseur doit donc être réglable **dès que la brosse est armée**, dans l'unité
 * qu'on voit (des pixels d'écran), et la gomme — qui n'a rien à régler — dit son geste.
 */

/** L'outil tel que le rail le déclare : on ne réinvente pas un descripteur pour le test. */
const toolById = (id: 'paint' | 'paint-erase'): ReviewTool =>
  toolsFor('annotate', 'MODEL_3D').find((tool) => tool.id === id)!;

function paintState(over: Partial<SplatPaintState> = {}) {
  return {
    color: '#ff4d4d',
    setColor: vi.fn(),
    width: 3,
    setWidth: vi.fn(),
    pendingCount: 0,
    redoCount: 0,
    undoStroke: vi.fn(),
    redoStroke: vi.fn(),
    clearPending: vi.fn(),
    ...over,
  } as unknown as SplatPaintState;
}

describe('PaintOptions — brosse armée', () => {
  it('offre l’épaisseur en pixels d’écran, bornée comme le trait lui-même', () => {
    const setWidth = vi.fn();
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ setWidth })} />);
    const field = screen.getByRole('textbox', { name: t('review.thickness') });
    expect(field).toHaveValue('3');
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(12);
    // Au-delà des bornes, le champ ramène dans la plage du trait — la même des deux côtés.
    fireEvent.change(field, { target: { value: '999' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(MAX_STROKE_PX);
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(MIN_STROKE_PX);
  });

  it('offre les quatre encres, et montre celle qui est choisie', () => {
    const setColor = vi.fn();
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ setColor })} />);
    const inks = screen.getAllByRole('button', { name: /#/ });
    expect(inks).toHaveLength(4);
    expect(inks[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(inks[2]);
    expect(setColor).toHaveBeenCalledTimes(1);
  });

  it('grise annuler, rétablir et tout effacer quand il n’y a aucun trait en préparation', () => {
    render(<PaintOptions tool={toolById('paint')} paint={paintState()} />);
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('review.redoStroke') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('review.splat.clearStrokes') })).toBeDisabled();
    expect(screen.getByText(t('draw.strokesGoWithComment'))).toBeInTheDocument();
  });

  it('les rend quand un trait attend, et annonce ce qui partira avec le commentaire', () => {
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ pendingCount: 2, redoCount: 1 })} />);
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeEnabled();
    expect(screen.getByRole('button', { name: t('review.redoStroke') })).toBeEnabled();
    expect(screen.getByText(t('draw.pendingStrokes', { count: 2 }))).toBeInTheDocument();
  });
});

describe('PaintOptions — gomme armée', () => {
  it('n’offre ni encre ni épaisseur, et dit son geste', () => {
    const tool = toolById('paint-erase');
    render(<PaintOptions tool={tool} paint={paintState({ pendingCount: 1 })} />);
    expect(screen.queryByRole('textbox', { name: t('review.thickness') })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /#/ })).toHaveLength(0);
    expect(screen.getByText(t(tool.hintKey))).toBeInTheDocument();
    // La pile de traits est partagée avec la brosse : les trois boutons restent.
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeEnabled();
  });
});
