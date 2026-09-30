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
 * Réagencer une scène USD au clavier (lot 13). Trois promesses sont vérifiées ici :
 *  - `Suppr` **masque** le prim désigné — un override, jamais une suppression de fichier ;
 *  - `Ctrl+Z` le rend, `Ctrl+Y` / `Ctrl+Maj+Z` le remasquent ;
 *  - la frappe ne va qu'à **un** historique : celui du viewer cède au composer d'annotation,
 *    qui est plus prioritaire (registre du lot 9).
 */

afterEach(cleanup);

const CHAIR = '/World/Chair_1';
const SEAT = `${CHAIR}/Geom/seat`;
const TABLE = '/World/Table';

/**
 * Une scène USD réduite à ce que le raccourci lit et écrit (sélection, override, écriture d'un
 * prim). Le reste de `UsdSceneState` — index Three, gizmo, clones, variantes — n'a pas de sens
 * hors d'un viewer monté, et la double assertion dit exactement ce que le hook touche.
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

/** Un composer d'annotation en cours, plus prioritaire — le concurrent réel de la frappe. */
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

describe('planHide — ce que Suppr écrit, et sur quel chemin', () => {
  it('masque exactement les chemins que la sélection porte, sans les promouvoir', () => {
    // Le clic dans le viewer désigne le component (lot 6), Alt+clic la feuille : les deux
    // arrivent ici tels quels. Rien n'est remonté ni descendu à l'écriture.
    const steps = planHide([CHAIR, SEAT], emptyOverride(), emptyOverride());
    expect(steps.map((s) => s.path)).toEqual([CHAIR, SEAT]);
    expect(steps.every((s) => s.before === undefined)).toBe(true);
  });

  it('retient la consigne de visibilité d’avant — c’est elle que l’annulation rend', () => {
    const local = setPrimEdit(emptyOverride(), CHAIR, { visible: true });
    expect(planHide([CHAIR], local, local)).toEqual([{ path: CHAIR, before: true }]);
  });

  it('ne donne pas de cran pour un prim déjà invisible, même par un ancêtre', () => {
    const local = setPrimEdit(emptyOverride(), CHAIR, { visible: false });
    expect(planHide([CHAIR], local, local)).toEqual([]);
    expect(planHide([SEAT], local, local)).toEqual([]);
  });

  it('laisse les clones de mise en scène à leur menu : un clone ne se masque pas', () => {
    // Masquer `/World/Chair_1#c1` écrirait sur le prim SOURCE : la copie et l'original
    // disparaîtraient ensemble. Le clone se retire par son menu contextuel.
    expect(planHide([clonePath(CHAIR, 'c1')], emptyOverride(), emptyOverride())).toEqual([]);
  });
});

describe('Suppr, Ctrl+Z, Ctrl+Y sur la scène USD', () => {
  it('masque la sélection, et l’annulation la rend', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    // L'override est redevenu vide : rien n'est forcé, ni masqué ni montré.
    expect(delta()).toBe('');
  });

  it('rejoue le masquage sur Ctrl+Y comme sur Ctrl+Maj+Z', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    undo();
    redoY();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    redoZ();
    expect(delta()).toBe(`${CHAIR}=false`);
  });

  it('masque toute la multi-sélection en un seul cran', () => {
    render(<Harness selected={[CHAIR, TABLE]} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false ${TABLE}=false`);
    // Un geste, un cran : une seule annulation rend les deux prims.
    undo();
    expect(delta()).toBe('');
  });

  it('rend au prim la consigne qu’il portait, et non « visible » par défaut', () => {
    // Un prim explicitement forcé visible (isolement levé) doit le redevenir, pas retomber
    // dans l'absence de consigne : c'est la différence que `before` conserve.
    render(<Harness selected={[CHAIR]} initial={setPrimEdit(emptyOverride(), CHAIR, { visible: true })} />);
    suppr();
    expect(delta()).toBe(`${CHAIR}=false`);
    undo();
    expect(delta()).toBe(`${CHAIR}=true`);
  });

  it('laisse Suppr à l’éditeur de courbes quand il est ouvert', () => {
    render(<Harness selected={[CHAIR]} deleteEnabled={false} />);
    suppr();
    expect(delta()).toBe('');
  });

  it('ne fait rien sans sélection — la touche reste disponible pour les autres', () => {
    render(<Harness selected={[]} />);
    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('préséance des historiques — une frappe, un seul', () => {
  it('le composer d’annotation passe devant l’historique du viewer', () => {
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
    // Le composer a pris la frappe ; le masquage n'a PAS été défait en même temps.
    expect(composerUndo).toHaveBeenCalledTimes(1);
    expect(delta()).toBe(`${CHAIR}=false`);
  });

  it('sans concurrent, la frappe revient à l’historique du viewer', () => {
    render(<Harness selected={[CHAIR]} />);
    suppr();
    undo();
    expect(delta()).toBe('');
  });
});
