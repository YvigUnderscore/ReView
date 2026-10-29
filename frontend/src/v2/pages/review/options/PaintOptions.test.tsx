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
 * Settings of the surface brush: the SAME in both spatial options bars. What is checked here is the
 * user's request, word for word: "I cannot change the scale". Thickness must therefore be adjustable
 * **as soon as the brush is armed**, in the unit one sees (screen pixels), and the eraser, which has
 * nothing to set, states its gesture.
 */

/** The tool as the rail declares it: we do not reinvent a descriptor for the test. */
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

describe('PaintOptions — brush armed', () => {
  it('offers thickness in screen pixels, clamped like the stroke itself', () => {
    const setWidth = vi.fn();
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ setWidth })} />);
    const field = screen.getByRole('textbox', { name: t('review.thickness') });
    expect(field).toHaveValue('3');
    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(12);
    // Beyond the bounds, the field brings the value back into the stroke's range: the same on both sides.
    fireEvent.change(field, { target: { value: '999' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(MAX_STROKE_PX);
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(setWidth).toHaveBeenCalledWith(MIN_STROKE_PX);
  });

  it('offers the four inks, and shows the one that is chosen', () => {
    const setColor = vi.fn();
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ setColor })} />);
    const inks = screen.getAllByRole('button', { name: /#/ });
    expect(inks).toHaveLength(4);
    expect(inks[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(inks[2]);
    expect(setColor).toHaveBeenCalledTimes(1);
  });

  it('greys out undo, redo and clear-all when no stroke is pending', () => {
    render(<PaintOptions tool={toolById('paint')} paint={paintState()} />);
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('review.redoStroke') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('review.splat.clearStrokes') })).toBeDisabled();
    expect(screen.getByText(t('draw.strokesGoWithComment'))).toBeInTheDocument();
  });

  it('enables them when a stroke is waiting, and announces what will leave with the comment', () => {
    render(<PaintOptions tool={toolById('paint')} paint={paintState({ pendingCount: 2, redoCount: 1 })} />);
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeEnabled();
    expect(screen.getByRole('button', { name: t('review.redoStroke') })).toBeEnabled();
    expect(screen.getByText(t('draw.pendingStrokes', { count: 2 }))).toBeInTheDocument();
  });
});

describe('PaintOptions — eraser armed', () => {
  it('offers neither ink nor thickness, and states its gesture', () => {
    const tool = toolById('paint-erase');
    render(<PaintOptions tool={tool} paint={paintState({ pendingCount: 1 })} />);
    expect(screen.queryByRole('textbox', { name: t('review.thickness') })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /#/ })).toHaveLength(0);
    expect(screen.getByText(t(tool.hintKey))).toBeInTheDocument();
    // The stroke stack is shared with the brush: the three buttons remain.
    expect(screen.getByRole('button', { name: t('review.undoStroke') })).toBeEnabled();
  });
});
