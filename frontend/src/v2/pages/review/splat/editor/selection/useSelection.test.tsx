// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditHistory } from '../operations/history';
import { useEditorShortcuts } from '../useEditorShortcuts';
import type { SplatSceneHandle, SplatViewer } from '../../useSplat';
import { useSelection } from './useSelection';

/**
 * Les **sélections de masque** entrent dans l'historique (Phase 50, lot 12) : un lasso, un
 * trait de pinceau ou un « tout désélectionner » se défont au Ctrl+Z comme la suppression
 * qu'ils préparent. Ce fichier vérifie les trois points qui font qu'un historique se laisse
 * utiliser : le cran existe, le trait entier n'en fait qu'un, et un geste qui ne change rien
 * n'en fait aucun.
 *
 * La géométrie est hors sujet ici — la projection écran et la brosse de surface ont leurs
 * propres tests, purs. Elles sont donc remplacées : ce qu'on vérifie est le chaînage.
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

describe('useSelection — la sélection est annulable', () => {
  it('fait un cran d’une forme tracée, et le rend dans les deux sens', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    expect(result.current.selection.selected.size).toBe(0);

    act(() => result.current.history.redo());
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });

  it('fait un cran du « tout désélectionner »', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    act(() => result.current.selection.clear());
    expect(result.current.selection.selected.size).toBe(0);

    act(() => result.current.history.undo());
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });

  it('ne pousse rien quand le geste reprend exactement les mêmes splats', () => {
    const { result } = setup();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));

    // Un seul cran pour deux tracés identiques : le second n'a rien changé.
    act(() => result.current.history.undo());
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.selection.selected.size).toBe(0);
  });
});

describe('useSelection — un trait de pinceau tient en un seul cran', () => {
  const stamp = (result: { current: ReturnType<typeof setup>['result']['current'] }, at: number[]) => {
    stub.brush = new Set(at);
    act(() => result.current.selection.commitBrush({ x: 4, y: 4 }, 40, 'add', VIEWPORT));
  };

  it('n’inscrit rien tant que le trait dure, puis rend le trait entier', () => {
    const { result } = setup();

    stamp(result, [1]);
    stamp(result, [1, 2]);
    stamp(result, [1, 2, 3]);
    // Cent stamps, cent crans : Ctrl+Z deviendrait inutilisable. Le cran attend le lâcher.
    expect(result.current.history.canUndo).toBe(false);
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);

    act(() => result.current.selection.endBrush());
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.undo());
    expect(result.current.selection.selected.size).toBe(0);
    expect(result.current.history.canUndo).toBe(false);
  });

  it('ne laisse pas un trait ouvert avaler le suivant', () => {
    const { result } = setup();

    stamp(result, [1]);
    act(() => result.current.selection.endBrush());
    stamp(result, [1, 2]);
    act(() => result.current.selection.endBrush());

    // Deux traits, deux crans : le premier Ctrl+Z ne rend que le second.
    act(() => result.current.history.undo());
    expect([...result.current.selection.selected]).toEqual([1]);
  });

  it('ignore un lâcher sans trait — rien à inscrire', () => {
    const { result } = setup();

    act(() => result.current.selection.endBrush());
    expect(result.current.history.canUndo).toBe(false);
  });
});

/**
 * La frappe réelle, par le chemin de production : `useEditorShortcuts` inscrit l'historique de
 * l'éditeur au registre partagé (`lib/undoScope`, lot 9), qui porte Ctrl+Z / Ctrl+Y /
 * Ctrl+Maj+Z pour toute l'application. Le lot 12 n'ajoute pas un gestionnaire — c'est
 * précisément ce qu'il ne faut pas faire — il fait entrer la sélection dans la pile que ce
 * registre sert déjà. Ce test vérifie que la touche y arrive.
 */
describe('Ctrl+Z sur une sélection de masque, par le registre partagé', () => {
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

  it('défait puis refait la sélection à la frappe', () => {
    const { result } = armed();

    act(() => result.current.selection.commitShape(RECT, 'replace', VIEWPORT));
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);

    press('z');
    expect(result.current.selection.selected.size).toBe(0);

    // Les deux rétablissements de la review : Ctrl+Y (Windows) et Ctrl+Maj+Z.
    press('y');
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
    press('z');
    press('z', true);
    expect([...result.current.selection.selected]).toEqual([1, 2, 3]);
  });
});
