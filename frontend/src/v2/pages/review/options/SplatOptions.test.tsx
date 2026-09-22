// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SplatOptions from './SplatOptions';
import { toolsFor, type ReviewTool } from '../chrome/tools';
import type { SplatEditorState } from '../splat/editor/useSplatEditor';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import type { PoiDraftState } from '../poi/usePoiDraft';
import { t } from '../../../i18n';

/**
 * La demande de l'utilisateur, mot pour mot : « dans le cas où le projet n'utilise pas les
 * brouillons, lors de l'édition des splats, il ne faut pas qu'il y ait le bouton "Save" qui
 * apparaisse en haut à droite du viewer ».
 *
 * Un média naît publié quand le studio n'utilise pas les brouillons : le bouton d'écriture
 * globale ne doit alors jamais paraître — et ce qui le remplace doit dire où va l'édition,
 * sinon on aurait juste retiré une commande.
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

describe('SplatOptions — l’écriture « pour tout le monde » s’arrête à la publication', () => {
  it('offre « Enregistrer » tant que la version n’est pas publiée', () => {
    const save = vi.fn();
    render(options(true, editorState({ save })));
    const button = screen.getByRole('button', { name: new RegExp(t('common.save')) });
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('review.splat.editAttached'))).not.toBeInTheDocument();
  });

  it('ne l’offre plus une fois publiée : l’édition part dans le commentaire', () => {
    render(options(false));
    expect(screen.queryByRole('button', { name: new RegExp(t('common.save')) })).not.toBeInTheDocument();
    expect(screen.getByText(t('review.splat.editAttached'))).toBeInTheDocument();
  });

  it('garde annuler/rétablir après publication — éditer reste possible, l’écriture globale non', () => {
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
