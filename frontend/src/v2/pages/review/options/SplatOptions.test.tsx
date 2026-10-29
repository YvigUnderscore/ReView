// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SplatOptions from './SplatOptions';
import { toolsFor, type ReviewTool } from '../chrome/tools';
import type { SplatEditorState } from '../splat/editor/useSplatEditor';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import type { PoiDraftState } from '../poi/usePoiDraft';
import { t } from '@/v2/i18n';

/**
 * The user's request, word for word: "when the project does not use drafts, while editing splats,
 * there must not be a "Save" button appearing at the top right of the viewer".
 *
 * A media is born published when the studio does not use drafts: the global write button must then
 * never appear, and what replaces it must say where the edit goes, otherwise we would merely have
 * removed a command.
 */
const navTool = (): ReviewTool => toolsFor('explore', 'SPLAT').find((tool) => tool.id === 'nav')!;

function editorState(over: Partial<SplatEditorState> = {}) {
  return {
    dirty: true,
    busy: false,
    save: vi.fn(),
    history: { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: false },
    selection: { selected: new Set<number>(), clear: vi.fn() },
    deletedCount: 0,
    volumes: { volumes: [], activeId: null },
    ...over,
  } as unknown as SplatEditorState;
}

const paintState = () => ({ color: '#fff', width: 3 }) as unknown as SplatPaintState;
const poiState = () => ({ points: [] }) as unknown as PoiDraftState;

const options = (saveForAll: boolean, editor = editorState()) => (
  <SplatOptions
    tool={navTool()}
    mode="clean"
    editor={editor}
    saveForAll={saveForAll}
    paint={paintState()}
    poi={poiState()}
  />
);

describe('SplatOptions — the "for everyone" write stops at publication', () => {
  it('offers "Save" as long as the version is not published', () => {
    const save = vi.fn();
    render(options(true, editorState({ save })));
    const button = screen.getByRole('button', { name: new RegExp(t('common.save')) });
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('review.splat.editAttached'))).not.toBeInTheDocument();
  });

  it('no longer offers it once published: the edit goes into the comment', () => {
    render(options(false));
    expect(screen.queryByRole('button', { name: new RegExp(t('common.save')) })).not.toBeInTheDocument();
    expect(screen.getByText(t('review.splat.editAttached'))).toBeInTheDocument();
  });

  it('keeps undo/redo after publication: editing stays possible, the global write does not', () => {
    const undo = vi.fn();
    const editor = editorState({
      history: { undo, redo: vi.fn(), canUndo: true, canRedo: false },
    } as unknown as Partial<SplatEditorState>);
    render(options(false, editor));
    fireEvent.click(screen.getByRole('button', { name: t('review.undoShortcut') }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: t('review.redoShortcut') })).toBeDisabled();
  });
});
