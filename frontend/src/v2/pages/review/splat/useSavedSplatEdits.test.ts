// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSavedSplatEdits } from './useSavedSplatEdits';
import type { SplatEditProposal } from './splatEditPart';
import type { MediaResp, SplatEdits } from '../reviewTypes';
import type { SplatViewer } from './useSplat';

/**
 * Le rejeu du nuage en lecture : les éditions du MÉDIA par défaut, et la proposition du
 * commentaire sélectionné quand il y en a une (Phase 50, lot 14). C'est ce qui rend la
 * proposition visible à celui qui lit le commentaire — sans quoi elle ne serait qu'un blob
 * dans une colonne.
 *
 * Le cas qui compte le plus est le dernier : **éditeur monté**. Un gestionnaire est la seule
 * personne capable de produire une proposition, et c'était la seule à qui le rejeu était
 * refusé — deux gestionnaires ne pouvaient pas se lire l'un l'autre.
 */
const trs = (x: number) => ({
  position: [x, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
});

const savedEdits: SplatEdits = { transform: trs(1), volumes: [], baseFlip: true };
const proposal: SplatEditProposal = {
  transform: trs(9),
  volumes: [],
  baseFlip: false,
  maskUrl: null,
  subsetUrl: null,
  maskCount: 0,
  subsetCount: 0,
};

function viewer() {
  return {
    applyTransform: vi.fn(),
    setBaseFlip: vi.fn(),
    ready: true,
    // Aucune poignée de scène : l'effet des volumes/masque sort tout de suite, et le test
    // reste sur ce qu'il vérifie — quelle édition pilote le nuage.
    getSceneHandle: () => null,
  } as unknown as SplatViewer;
}

const media = (edits: SplatEdits | null) =>
  ({ splatEdits: edits, splatMaskUrl: null, splatSubsetUrl: null }) as unknown as MediaResp;

describe('useSavedSplatEdits — ce qui pilote le nuage en lecture', () => {
  it('rejoue les éditions du média quand aucun commentaire n’est lu', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), false, null));
    expect(splat.applyTransform).toHaveBeenCalledWith(savedEdits.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(true);
  });

  it('rejoue la proposition du commentaire sélectionné à la place', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), false, proposal));
    expect(splat.applyTransform).toHaveBeenCalledWith(proposal.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(false);
  });

  it('rend le nuage du média dès que la proposition est relâchée', () => {
    const splat = viewer();
    const initialProps: { p: SplatEditProposal | null } = { p: proposal };
    const { rerender } = renderHook(
      ({ p }: { p: SplatEditProposal | null }) => useSavedSplatEdits(splat, media(savedEdits), false, p),
      { initialProps },
    );
    rerender({ p: null });
    expect(splat.applyTransform).toHaveBeenLastCalledWith(savedEdits.transform);
    expect(splat.setBaseFlip).toHaveBeenLastCalledWith(true);
  });

  it('ne touche à rien quand l’éditeur est monté et qu’aucun commentaire ne propose', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), true, null));
    expect(splat.applyTransform).not.toHaveBeenCalled();
    expect(splat.setBaseFlip).not.toHaveBeenCalled();
  });

  /** Le défaut du lot : `showEdit` coupait le rejeu à ceux-là même qui produisent les propositions. */
  it('rejoue la proposition MÊME éditeur monté — un gestionnaire peut lire un gestionnaire', () => {
    const splat = viewer();
    renderHook(() => useSavedSplatEdits(splat, media(savedEdits), true, proposal));
    expect(splat.applyTransform).toHaveBeenCalledWith(proposal.transform);
    expect(splat.setBaseFlip).toHaveBeenCalledWith(false);
  });

  it('éditeur monté : relâcher la proposition ne réapplique PAS le média — l’éditeur reprend', () => {
    const splat = viewer();
    const initialProps: { p: SplatEditProposal | null } = { p: proposal };
    const { rerender } = renderHook(
      ({ p }: { p: SplatEditProposal | null }) => useSavedSplatEdits(splat, media(savedEdits), true, p),
      { initialProps },
    );
    rerender({ p: null });
    // La dernière écriture reste celle de la proposition : c'est `useEditorSuspend` qui rend
    // ensuite la TRS locale, et non les éditions enregistrées du média.
    expect(splat.applyTransform).toHaveBeenLastCalledWith(proposal.transform);
  });
});
