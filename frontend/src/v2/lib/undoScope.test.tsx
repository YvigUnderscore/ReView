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
  it('reads the three expected keystrokes', () => {
    expect(undoIntent(key({ ctrlKey: true }))).toBe('undo');
    expect(undoIntent(key({ ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoIntent(key({ ctrlKey: true, key: 'y' }))).toBe('redo');
    expect(undoIntent(key({ metaKey: true, key: 'Z' }))).toBe('undo');
  });

  it('ignores anything that is not a history gesture', () => {
    expect(undoIntent(key({}))).toBeNull();
    expect(undoIntent(key({ ctrlKey: true, altKey: true }))).toBeNull();
    expect(undoIntent(key({ ctrlKey: true, key: 'v' }))).toBeNull();
    // Ctrl+Shift+Y is nobody's shortcut: do not mistake it for a redo.
    expect(undoIntent(key({ ctrlKey: true, shiftKey: true, key: 'y' }))).toBeNull();
  });
});

describe('pickScope', () => {
  it('serves the highest-priority scope', () => {
    const low = scope({ priority: UNDO_PRIORITY.editor });
    const high = scope({ priority: UNDO_PRIORITY.composer });
    expect(pickScope([low, high], 'undo')).toBe(high);
    expect(pickScope([high, low], 'undo')).toBe(high);
  });

  it('skips a scope with nothing to undo — the keystroke falls to the next one', () => {
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

  it('returns null when no scope can act', () => {
    expect(pickScope([scope({ canUndo: false })], 'undo')).toBeNull();
    expect(pickScope([], 'redo')).toBeNull();
  });
});

/** Two scopes mounted at the same time: the keystroke serves only ONE of them. */
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
  it('a keystroke only undoes one history (the highest priority)', () => {
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

  it('a disabled scope leaves the keystroke to the editor', () => {
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

  it('stays silent in an input field — the browser does better there', () => {
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

  it('once unmounted, it listens to nothing', () => {
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
