// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { planHide, useSceneEditShortcuts } from './useSceneEditShortcuts';
import { clonePath, emptyOverride, setPrimEdit, type PrimEdit, type SceneOverride } from './sceneOverride';
import type { UsdSceneState } from './useUsdScene';
import { useEditHistory } from '../splat/editor/operations/history';
import { UNDO_PRIORITY, useUndoScope } from '../../../lib/undoScope';

/**
 * Rearranging a USD scene from the keyboard (batch 13). Three promises are checked here:
 *  - `Delete` **hides** the targeted prim — an override, never a file deletion;
 *  - `Ctrl+Z` restores it, `Ctrl+Y` / `Ctrl+Shift+Z` hide it again;
 *  - the keystroke only goes to **one** history: the viewer's yields to the annotation composer,
 *    which has higher priority (batch 9 registry).
 */

afterEach(cleanup);

const CHAIR = '/World/Chair_1';
const SEAT = `${CHAIR}/Geom/seat`;
const TABLE = '/World/Table';

/**
 * A USD scene reduced to what the shortcut reads and writes (selection, override, writing a prim).
 * The rest of `UsdSceneState` — Three index, gizmo, clones, variants — makes no sense outside a
 * mounted viewer, and the double assertion says exactly what the hook touches.
 */
function Harness({
  selected,
  deleteEnabled = true,
  initial,
}: {
  selected: string[];
  deleteEnabled?: boolean;
  initial?: SceneOverride;
}) {
  const [local, setLocal] = useState<SceneOverride>(() => initial ?? emptyOverride());
  const history = useEditHistory();
  const scene = useMemo(
    () =>
      ({
        selected,
        override: local,
        localDelta: local,
        setPrim: (path: string, patch: PrimEdit | null) =>
          setLocal((current) => setPrimEdit(current, path, patch)),
      }) as unknown as UsdSceneState,
    [selected, local],
  );
  useSceneEditShortcuts({ scene, history, deleteEnabled, isFlying: () => false });
  return (
    <div data-testid="delta">
      {Object.keys(local.prims)
        .map((path) => `${path}=${String(local.prims[path]?.visible)}`)
        .join(' ')}
    </div>
  );
}

/** An ongoing annotation composer, higher priority — the real competitor of the keystroke. */
function ComposerScope({ undo }: { undo: () => void }) {
  useUndoScope({
    enabled: true,
    priority: UNDO_PRIORITY.composer,
    canUndo: true,
    canRedo: false,
    undo,
    redo: () => undefined,
  });
  return null;
}

const delta = () => screen.getByTestId('delta').textContent;
const suppr = () => fireEvent.keyDown(document, { key: 'Delete' });
const undo = () => fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
const redoY = () => fireEvent.keyDown(document, { key: 'y', ctrlKey: true });
const redoZ = () => fireEvent.keyDown(document, { key: 'z', ctrlKey: true, shiftKey: true });

describe('planHide — what Delete writes, and on which path', () => {
  it('hides exactly the paths the selection carries, without promoting them', () => {
    // A click in the viewer designates the component (batch 6), Alt+click the leaf: both arrive
    // here as they are. Nothing is climbed or descended on write.
    const steps = planHide([CHAIR, SEAT], emptyOverride(), emptyOverride());
    expect(steps.map((s) => s.path)).toEqual([CHAIR, SEAT]);
    expect(steps.every((s) => s.before === undefined)).toBe(true);
  });

  it('keeps the previous visibility instruction — that is what undo restores', () => {
    const local = setPrimEdit(emptyOverride(), CHAIR, { visible: true });
    expect(planHide([CHAIR], local, local)).toEqual([{ path: CHAIR, before: true }]);
  });

  it('gives no step for a prim already invisible, even via an ancestor', () => {
    const local = setPrimEdit(emptyOverride(), CHAIR, { visible: false });
    expect(planHide([CHAIR], local, local)).toEqual([]);
    expect(planHide([SEAT], local, local)).toEqual([]);
  });

  it('leaves staging clones to their menu: a clone is not hidden', () => {
    // Hiding `/World/Chair_1#c1` would write to the SOURCE prim: the copy and the original
    // would disappear together. The clone is removed through its context menu.
    expect(planHide([clonePath(CHAIR, 'c1')], emptyOverride(), emptyOverride())).toEqual([]);
  });
});

describe('Delete, Ctrl+Z, Ctrl+Y on the USD scene', () => {
  it('hides the selection, and undo restores it', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    // The override is empty again: nothing is forced, neither hidden nor shown.
    expect(delta()).toBe('');
  });

  it('replays the hide on Ctrl+Y as on Ctrl+Shift+Z', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    undo();
    redoY();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    redoZ();
    expect(delta()).toBe(`${CHAIR}=false`);
  });

  it('hides the whole multi-selection in a single step', () => {
    render(<Harness selected={[CHAIR, TABLE]} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false ${TABLE}=false`);
    // One gesture, one step: a single undo restores both prims.
    undo();
    expect(delta()).toBe('');
  });

  it('gives the prim back the instruction it carried, not "visible" by default', () => {
    // A prim explicitly forced visible (isolation lifted) must become so again, not fall back
    // to no instruction: that is the difference `before` preserves.
    render(<Harness selected={[CHAIR]} initial={setPrimEdit(emptyOverride(), CHAIR, { visible: true })} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    expect(delta()).toBe(`${CHAIR}=true`);
  });

  it('leaves Delete to the curve editor when it is open', () => {
    render(<Harness selected={[CHAIR]} deleteEnabled={false} />);
    suppr();
    expect(delta()).toBe('');
  });

  it('does nothing without a selection — the key remains available for the others', () => {
    render(<Harness selected={[]} />);
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('history precedence — one keystroke, one only', () => {
  it('the annotation composer goes ahead of the viewer history', () => {
    const composerUndo = vi.fn();
    render(
      <>
        <ComposerScope undo={composerUndo} />
        <Harness selected={[CHAIR]} />
      </>,
    );
    suppr();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    // The composer took the keystroke; the hide was NOT undone at the same time.
    expect(composerUndo).toHaveBeenCalledTimes(1);
    expect(delta()).toBe(`${CHAIR}=false`);
  });

  it('without a competitor, the keystroke goes back to the viewer history', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    undo();
    expect(delta()).toBe('');
  });
});
