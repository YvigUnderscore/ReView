// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { UNDO_PRIORITY, pickScope, undoIntent, useUndoScope, type UndoScope } from './undoScope';

const key = (over: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'z', ...over }) as KeyboardEvent;

const scope = (over: Partial<UndoScope>): UndoScope => ({
  priority: 0,
  canUndo: true,
  canRedo: true,
  undo: () => undefined,
  redo: () => undefined,
  ...over,
});

describe('undoIntent', () => {
  it('lit les trois frappes attendues', () => {
    expect(undoIntent(key({ ctrlKey: true }))).toBe('undo');
    expect(undoIntent(key({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoIntent(key({ ctrlKey: true, key: 'y' }))).toBe('redo');
    expect(undoIntent(key({ metaKey: true, key: 'Z' }))).toBe('undo');
  });

  it('ignore ce qui n’est pas un geste d’historique', () => {
    expect(undoIntent(key({}))).toBeNull();
    expect(undoIntent(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(undoIntent(key({ ctrlKey: true, key: 'v' }))).toBeNull();
    // Ctrl+Maj+Y n'est le raccourci de personne : ne pas le confondre avec un redo.
    expect(undoIntent(key({ ctrlKey: true, shiftKey: true, key: 'y' }))).toBeNull();
  });
});

describe('pickScope', () => {
  it('sert le périmètre le plus prioritaire', () => {
    const low = scope({ priority: UNDO_PRIORITY.editor });
    const high = scope({ priority: UNDO_PRIORITY.composer });
    expect(pickScope([low, high], 'undo')).toBe(high);
    expect(pickScope([high, low], 'undo')).toBe(high);
  });

  it('saute un périmètre qui n’a rien à défaire — la frappe retombe sur le suivant', () => {
    const empty = scope({ priority: UNDO_PRIORITY.composer, canUndo: false });
    const editor = scope({ priority: UNDO_PRIORITY.editor });
    expect(pickScope([empty, editor], 'undo')).toBe(editor);
  });

  it('distingue undo et redo', () => {
    const noRedo = scope({ priority: UNDO_PRIORITY.composer, canRedo: false });
    const editor = scope({ priority: UNDO_PRIORITY.editor });
    expect(pickScope([noRedo, editor], 'undo')).toBe(noRedo);
    expect(pickScope([noRedo, editor], 'redo')).toBe(editor);
  });

  it('rend null quand aucun périmètre ne peut agir', () => {
    expect(pickScope([scope({ canUndo: false })], 'undo')).toBeNull();
    expect(pickScope([], 'redo')).toBeNull();
  });
});

/** Deux périmètres montés en même temps : la frappe n'en sert qu'UN. */
function TwoScopes(props: { composer: UndoScope & { enabled: boolean }; editor: UndoScope }) {
  useUndoScope(props.composer);
  useUndoScope({ ...props.editor, enabled: true });
  return null;
}

const press = (init: Partial<KeyboardEventInit> = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init }),
  );

describe('useUndoScope', () => {
  it('une frappe ne défait qu’un seul historique (le plus prioritaire)', () => {
    const composerUndo = vi.fn();
    const editorUndo = vi.fn();
    render(
      <TwoScopes
        composer={{
          enabled: true,
          priority: UNDO_PRIORITY.composer,
          canUndo: true,
          canRedo: false,
          undo: composerUndo,
          redo: () => undefined,
        }}
        editor={{
          priority: UNDO_PRIORITY.editor,
          canUndo: true,
          canRedo: false,
          undo: editorUndo,
          redo: () => undefined,
        }}
      />,
    );
    press();
    expect(composerUndo).toHaveBeenCalledTimes(1);
    expect(editorUndo).not.toHaveBeenCalled();
  });

  it('un périmètre désactivé laisse la frappe à l’éditeur', () => {
    const composerUndo = vi.fn();
    const editorUndo = vi.fn();
    render(
      <TwoScopes
        composer={{
          enabled: false,
          priority: UNDO_PRIORITY.composer,
          canUndo: true,
          canRedo: false,
          undo: composerUndo,
          redo: () => undefined,
        }}
        editor={{
          priority: UNDO_PRIORITY.editor,
          canUndo: true,
          canRedo: false,
          undo: editorUndo,
          redo: () => undefined,
        }}
      />,
    );
    press();
    expect(composerUndo).not.toHaveBeenCalled();
    expect(editorUndo).toHaveBeenCalledTimes(1);
  });

  it('se tait dans un champ de saisie — le navigateur y fait mieux', () => {
    const editorUndo = vi.fn();
    render(
      <TwoScopes
        composer={{
          enabled: false,
          priority: UNDO_PRIORITY.composer,
          canUndo: false,
          canRedo: false,
          undo: () => undefined,
          redo: () => undefined,
        }}
        editor={{
          priority: UNDO_PRIORITY.editor,
          canUndo: true,
          canRedo: false,
          undo: editorUndo,
          redo: () => undefined,
        }}
      />,
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(editorUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it('démonté, il n’écoute plus rien', () => {
    const editorUndo = vi.fn();
    const view = render(
      <TwoScopes
        composer={{
          enabled: false,
          priority: UNDO_PRIORITY.composer,
          canUndo: false,
          canRedo: false,
          undo: () => undefined,
          redo: () => undefined,
        }}
        editor={{
          priority: UNDO_PRIORITY.editor,
          canUndo: true,
          canRedo: false,
          undo: editorUndo,
          redo: () => undefined,
        }}
      />,
    );
    view.unmount();
    press();
    expect(editorUndo).not.toHaveBeenCalled();
  });
});
