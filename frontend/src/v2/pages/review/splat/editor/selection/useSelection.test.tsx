// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditHistory } from '../operations/history';
import { useEditorShortcuts } from '../useEditorShortcuts';
import type { SplatSceneHandle, SplatViewer } from '../../useSplat';
import { useSelection } from './useSelection';

/**
 * **Mask selections** enter the history (Phase 50, lot 12): a lasso, a brush stroke or a
 * "deselect all" is undone with Ctrl+Z like the deletion it prepares. This file checks the three
 * points that make a history usable: the step exists, the whole stroke makes only one, and a
 * gesture that changes nothing makes none.
 *
 * Geometry is out of scope here: screen projection and the surface brush have their own pure
 * tests. They are therefore replaced: what is checked is the chaining.
 */

const stub = vi.hoisted(() => ({
  shape: new Set<number>([1, 2, 3]),
  brush: null as ReadonlySet<number> | null,
}));

vi.mock('./screenSelect', () => ({
  captureCenters: () => new Float32Array(0),
  selectByShape: () => stub.shape,
}));
vi.mock('./surfaceBrush', () => ({ selectByBrush: () => stub.brush }));
vi.mock('./highlight', () => ({
  createSelectionHighlight: () => ({ apply: () => {}, markDirty: () => {}, dispose: () => {} }),
}));
vi.mock('@sparkjsdev/spark', () => ({ RgbaArray: class {} }));

const handle = { mesh: {} } as unknown as SplatSceneHandle;
const splat = { getSceneHandle: () => handle, isFlying: () => false } as unknown as SplatViewer;

const VIEWPORT = { width: 800, height: 450 };
const RECT = { kind: 'rect' as const, rect: { x: 0, y: 0, w: 10, h: 10 } };

function setup() {
  return renderHook(() => {
    const history = useEditHistory();
    return { history, selection: useSelection(splat, () => false, history.push) };
  });
}

describe('useSelection — the selection is undoable', () => {
  it('makes one step of a drawn shape, and restores it in both directions', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    expect(result.current.selection.selected.size).toBe(0);

    act(() => result.current.history.redo());
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });

  it('makes one step of "deselect all"', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    act(() => result.current.selection.clear());
    expect(result.current.selection.selected.size).toBe(0);

    act(() => result.current.history.undo());
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });

  it('pushes nothing when the gesture re-selects exactly the same splats', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));

    // One step for two identical shapes: the second changed nothing.
    act(() => result.current.history.undo());
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.selection.selected.size).toBe(0);
  });
});

describe('useSelection — a brush stroke stays in a single step', () => {
  const stamp = (result: { current: ReturnType<typeof setup>['result']['current'] }, at: number[]) => {
    stub.brush = new Set(at);
    act(() => result.current.selection.commitBrush({ x: 4, y: 4 }, 40, 'add', VIEWPORT));
  };

  it('records nothing while the stroke lasts, then restores the whole stroke', () => {
    const { result } = setup();

    stamp(result, [1]);
    stamp(result, [1, 2]);
    stamp(result, [1, 2, 3]);
    // A hundred stamps, a hundred steps: Ctrl+Z would become unusable. The step waits for the release.
    expect(result.current.history.canUndo).toBe(false);
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);

    act(() => result.current.selection.endBrush());
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    expect(result.current.selection.selected.size).toBe(0);
    expect(result.current.history.canUndo).toBe(false);
  });

  it('does not let an open stroke swallow the next one', () => {
    const { result } = setup();

    stamp(result, [1]);
    act(() => result.current.selection.endBrush());
    stamp(result, [1, 2]);
    act(() => result.current.selection.endBrush());

    // Two strokes, two steps: the first Ctrl+Z only restores the second.
    act(() => result.current.history.undo());
    expect([...result.current.selection.selected]).toEqual([1]);
  });

  it('ignores a release without a stroke: nothing to record', () => {
    const { result } = setup();

    act(() => result.current.selection.endBrush());
    expect(result.current.history.canUndo).toBe(false);
  });
});

/**
 * Real keypresses, through the production path: `useEditorShortcuts` registers the editor's
 * history in the shared registry (`lib/undoScope`, lot 9), which handles Ctrl+Z / Ctrl+Y /
 * Ctrl+Shift+Z for the whole application. Lot 12 adds no handler (which is exactly what must
 * not be done): it makes the selection enter the stack this registry already serves.
 * This test checks that the keystroke reaches it.
 */
describe('Ctrl+Z on a mask selection, through the shared registry', () => {
  const press = (key: string, shiftKey = false) =>
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }),
      );
    });

  function armed() {
    return renderHook(() => {
      const history = useEditHistory();
      const selection = useSelection(splat, () => false, history.push);
      useEditorShortcuts({
        enabled: true,
        splat,
        history,
        deleteSelection: () => {},
        frameSelection: () => {},
        frameHome: () => {},
      });
      return { history, selection };
    });
  }

  it('undoes then redoes the selection on keypress', () => {
    const { result } = armed();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);

    press('z');
    expect(result.current.selection.selected.size).toBe(0);

    // The two redo bindings of the review: Ctrl+Y (Windows) and Ctrl+Shift+Z.
    press('y');
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
    press('z');
    press('z', true);
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });
});
